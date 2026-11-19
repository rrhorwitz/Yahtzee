import UIKit
import Capacitor

/// Registers plugins that live inside the app (not from npm).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
    }
}
