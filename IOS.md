# Building the iPhone app

The web app is wrapped in a native iOS shell with [Capacitor](https://capacitorjs.com).
The same code runs on the website and in the app; inside the app it also gets:

- **Real haptics** on rolls, holds, scores and celebrations (`@capacitor/haptics`)
- **Reliable keep-screen-on** during a game (`@capacitor-community/keep-awake`)
- **Game Center leaderboard** (small in-app plugin: `ios/App/App/GameCenterPlugin.swift`)
- Portrait-only on iPhone, any orientation on iPad, fully offline (files are bundled)

## One-time setup (on your Mac)

1. Install **Xcode** from the Mac App Store and open it once to finish setup.
2. Install **Node.js** (LTS) from nodejs.org.
3. Join the **Apple Developer Program** ($99/year) at developer.apple.com.
4. Clone this repo and run:
   ```sh
   npm install
   npm run ios:sync     # copies the web files into the iOS project
   npm run ios:open     # opens Xcode
   ```
5. In Xcode, select the **App** target → **Signing & Capabilities**:
   - Choose your **Team**.
   - Change the **Bundle Identifier** if `com.rrhorwitz.scorecard` is taken.
   - Confirm **Game Center** is listed (it comes from `App/App.entitlements`).

## Run it on your iPhone

Plug in your iPhone (or pick it from the device menu), press **▶ Run**.
The first time, iOS asks you to trust the developer: Settings → General → VPN & Device Management.

> I couldn't compile the Swift code in the cloud environment, so the first build is the real test.
> If Xcode shows an error, copy it back to me and I'll fix it.

## Game Center leaderboard

1. In [App Store Connect](https://appstoreconnect.apple.com) create the app (same bundle ID).
2. Open the app → **Services → Game Center** → add a **Classic leaderboard**:
   - Leaderboard ID: `scorecard.highscore` (must match `native.js`)
   - Score format: Integer, sort: High to Low.
3. Game Center scores only post from builds signed with your team. Because one phone = one
   Game Center account, the results screen asks which player is signed in before posting.

## After changing the web code

```sh
npm run ios:sync
```
then press ▶ Run in Xcode again.

## Submitting to the App Store

1. In Xcode: **Product → Archive**, then **Distribute App → App Store Connect → Upload**.
2. In App Store Connect: add screenshots (6.9" and 6.5" iPhone, 13" iPad), description,
   keywords, support URL, privacy policy URL, and set Data Collection to **None**.
3. Add the build, test it with **TestFlight**, then **Submit for Review**.

**Before submitting:** "Yahtzee" is a Hasbro trademark. Keep it out of the app name, icon,
subtitle, keywords and description, and rename the in-app "Yahtzee" box (e.g. "Five of a Kind"),
or the app is likely to be rejected.
