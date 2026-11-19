/* Native extras when running as the iPhone app (Capacitor). On the web every call is a no-op,
   so the same code runs as the website and inside the App Store app. */
(function () {
  'use strict';
  const C = window.Capacitor;
  const isNative = !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  // npm plugins appear on Capacitor.Plugins; the in-app GameCenter plugin is looked up with registerPlugin.
  const plugin = (name) => {
    if (!isNative || (C.isPluginAvailable && !C.isPluginAvailable(name))) return null;
    return (C.Plugins && C.Plugins[name]) || (C.registerPlugin ? C.registerPlugin(name) : null);
  };
  const P = { Haptics: plugin('Haptics'), KeepAwake: plugin('KeepAwake'), GameCenter: plugin('GameCenter') };

  // Must match the leaderboard ID you create in App Store Connect → Game Center.
  const LEADERBOARD_ID = 'scorecard.highscore';

  const quiet = (p) => (p && typeof p.catch === 'function' ? p.catch(() => {}) : p);

  const Native = {
    isNative,

    /** kind: 'light' | 'medium' | 'heavy' | 'success'. Returns true if a native haptic fired. */
    haptic(kind) {
      if (!P.Haptics) return false;
      try {
        if (kind === 'success') quiet(P.Haptics.notification({ type: 'SUCCESS' }));
        else quiet(P.Haptics.impact({ style: kind === 'heavy' ? 'HEAVY' : kind === 'medium' ? 'MEDIUM' : 'LIGHT' }));
        return true;
      } catch (e) { return false; }
    },

    /** Returns true when the native keep-awake plugin handled it. */
    keepAwake(on) {
      if (!P.KeepAwake) return false;
      try { quiet(on ? P.KeepAwake.keepAwake() : P.KeepAwake.allowSleep()); return true; } catch (e) { return false; }
    },

    gameCenter: {
      available: !!P.GameCenter,
      leaderboardId: LEADERBOARD_ID,
      signIn() {
        return P.GameCenter ? P.GameCenter.signIn() : Promise.reject(new Error('Game Center is only in the iPhone app'));
      },
      async submit(score) {
        const me = await this.signIn();
        if (!me || !me.authenticated) throw new Error('Not signed in to Game Center');
        await P.GameCenter.submitScore({ leaderboardId: LEADERBOARD_ID, score: Math.round(score) });
        return me;
      },
      async show() {
        await this.signIn();
        await P.GameCenter.showLeaderboard({ leaderboardId: LEADERBOARD_ID });
      },
    },
  };

  window.Native = Native;
})();
