import Foundation
import Capacitor
import GameKit

/// Minimal Game Center bridge: sign in, submit a score to a leaderboard, and show the leaderboard.
/// JS name: "GameCenter" (see native.js).
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise)
    ]

    private var pendingSignIns: [CAPPluginCall] = []
    private var handlerInstalled = false

    private func playerInfo() -> [String: Any] {
        let p = GKLocalPlayer.local
        return ["authenticated": p.isAuthenticated, "name": p.isAuthenticated ? p.displayName : ""]
    }

    @objc func signIn(_ call: CAPPluginCall) {
        if GKLocalPlayer.local.isAuthenticated { call.resolve(playerInfo()); return }
        pendingSignIns.append(call)
        if handlerInstalled { return }
        handlerInstalled = true
        // Game Center may call this handler more than once (e.g. after the sign-in sheet closes).
        GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, error in
            guard let self = self else { return }
            if let vc = viewController {
                DispatchQueue.main.async { self.bridge?.viewController?.present(vc, animated: true) }
                return
            }
            let calls = self.pendingSignIns
            self.pendingSignIns.removeAll()
            for c in calls {
                if let error = error, !GKLocalPlayer.local.isAuthenticated { c.reject(error.localizedDescription) }
                else { c.resolve(self.playerInfo()) }
            }
        }
    }

    @objc func submitScore(_ call: CAPPluginCall) {
        guard let leaderboardId = call.getString("leaderboardId"), let score = call.getInt("score") else {
            call.reject("leaderboardId and score are required"); return
        }
        guard GKLocalPlayer.local.isAuthenticated else { call.reject("Not signed in to Game Center"); return }
        GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local, leaderboardIDs: [leaderboardId]) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }

    @objc func showLeaderboard(_ call: CAPPluginCall) {
        let leaderboardId = call.getString("leaderboardId")
        DispatchQueue.main.async {
            let vc: GKGameCenterViewController
            if let id = leaderboardId {
                vc = GKGameCenterViewController(leaderboardID: id, playerScope: .global, timeScope: .allTime)
            } else {
                vc = GKGameCenterViewController(state: .leaderboards)
            }
            vc.gameCenterDelegate = self
            self.bridge?.viewController?.present(vc, animated: true)
            call.resolve()
        }
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}
