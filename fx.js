/* Effects: confetti, sounds, and the shareable results image. */
(function () {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#0A84FF', '#AF52DE', '#FF2D55'];

  /* ---------- Confetti ---------- */
  function confetti(host, opts) {
    opts = opts || {};
    if (reduced.matches || !host) return;
    const c = document.createElement('canvas');
    c.className = 'confetti';
    host.appendChild(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = host.clientWidth;
    const H = host.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const n = opts.count || 140;
    const originY = H * (opts.y === undefined ? 0.38 : opts.y);
    const parts = [];
    for (let i = 0; i < n; i++) {
      parts.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.35,
        y: originY + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 15,
        vy: -Math.random() * 15 - 5,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        w: 6 + Math.random() * 6,
        h: 9 + Math.random() * 8,
        col: COLORS[i % COLORS.length],
        round: Math.random() < 0.28,
      });
    }
    const dur = opts.duration || 2300;
    const start = performance.now();
    let last = start;
    function frame(t) {
      const k = Math.min(3, (t - last) / 16.67);
      last = t;
      const e = t - start;
      const fade = Math.max(0, 1 - Math.max(0, e - dur * 0.6) / (dur * 0.4));
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = fade;
      for (const p of parts) {
        p.vy += 0.42 * k;
        p.vx *= Math.pow(0.985, k);
        p.vy *= Math.pow(0.985, k);
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.r += p.vr * k;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.col;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.scale(1, Math.cos(p.r * 2.5));
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (e < dur) requestAnimationFrame(frame); else c.remove();
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Sounds (synthesized, no files) ---------- */
  let ac = null;
  function audio() {
    if (!ac || ac.state === 'closed') {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      ac = new A();
    }
    // iOS home-screen apps come back from the background "interrupted", not "suspended"
    if (ac.state !== 'running') ac.resume().catch(() => {});
    return ac;
  }
  /* iOS only lets audio start inside a tap. Unlock on the first touch (and again after the
     app returns from the background) by playing one silent sample. */
  function unlock() {
    const a = audio();
    if (!a) return;
    try {
      const b = a.createBuffer(1, 1, a.sampleRate);
      const s = a.createBufferSource();
      s.buffer = b;
      s.connect(a.destination);
      s.start(0);
    } catch (e) { /* ignore */ }
  }
  let unlocked = false;
  const arm = () => { if (unlocked) return; unlocked = true; unlock(); };
  ['pointerdown', 'touchend', 'keydown'].forEach((t) => document.addEventListener(t, arm, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') unlocked = false; // re-unlock on the next tap
  });
  /* Silent switch: 'ambient' respects it (default); 'playback' plays anyway (iOS 17+). */
  function setIgnoreSilent(on) {
    try { if (navigator.audioSession) navigator.audioSession.type = on ? 'playback' : 'ambient'; } catch (e) { /* unsupported */ }
  }
  /* Wooden dice: each impact is a few fast-decaying resonant modes (the hard die)
     plus a short click and, for harder hits, a low "bowl" body resonance. */
  let clickBuf = null;
  function clickNoise(a) {
    if (!clickBuf) {
      clickBuf = a.createBuffer(1, Math.floor(a.sampleRate * 0.012), a.sampleRate);
      const d = clickBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
    }
    return clickBuf;
  }
  function mode(a, out, t, freq, decay, gain) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.01);
  }
  function woodHit(a, out, t, gain, pitch, body) {
    // die: bright, short, slightly inharmonic wooden "tock"
    const f = pitch;
    mode(a, out, t, f, 0.045, gain * 0.55);
    mode(a, out, t, f * 2.41, 0.028, gain * 0.32);
    mode(a, out, t, f * 3.93, 0.016, gain * 0.18);
    // contact click
    const src = a.createBufferSource();
    src.buffer = clickNoise(a);
    const hp = a.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 3200 + Math.random() * 1800;
    hp.Q.value = 0.9;
    const g = a.createGain();
    g.gain.value = gain * 0.9;
    src.connect(hp).connect(g).connect(out);
    src.start(t);
    // bowl: warm low resonance that rings a little longer
    if (body > 0) {
      mode(a, out, t, 190 + Math.random() * 40, 0.16, gain * body * 0.5);
      mode(a, out, t, 430 + Math.random() * 60, 0.09, gain * body * 0.28);
    }
  }
  function master(a) {
    const comp = a.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    const g = a.createGain();
    g.gain.value = 0.9;
    comp.connect(g).connect(a.destination);
    return comp;
  }
  function bell(a, out, t, freq, dur, gain) {
    mode(a, out, t, freq, dur, gain);
    mode(a, out, t, freq * 2.76, dur * 0.45, gain * 0.28);
    mode(a, out, t, freq * 5.4, dur * 0.2, gain * 0.1);
  }
  function tone(a, t, freq, dur, gain, type) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const SOUNDS = {
    roll(a, t, n) {
      const out = master(a);
      const dice = Math.max(1, Math.min(5, n || 5));
      // low "rolling around the bowl" rumble under the clacks
      const len = 0.75;
      const nb = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) {
        const x = i / nd.length;
        const wobble = 0.55 + 0.45 * Math.sin(x * Math.PI * 2 * 7 + Math.random() * 0.3); // dice rolling round
        nd[i] = (Math.random() * 2 - 1) * wobble * Math.pow(1 - x, 1.6) * Math.min(1, x * 30);
      }
      const rs = a.createBufferSource();
      rs.buffer = nb;
      const lp = a.createBiquadFilter();
      lp.type = 'bandpass';
      lp.frequency.value = 340;
      lp.Q.value = 0.8;
      const rg = a.createGain();
      rg.gain.value = 0.22 * (0.6 + dice / 12);
      rs.connect(lp).connect(rg).connect(out);
      rs.start(t);
      for (let d = 0; d < dice; d++) {
        const pitch = 1150 + Math.random() * 1000;       // each die rings slightly differently
        let at = t + Math.random() * 0.16;               // dice land at slightly different moments
        let gain = 0.7 + Math.random() * 0.3;
        let gap = 0.1 + Math.random() * 0.05;
        const bounces = 4 + Math.floor(Math.random() * 3);
        for (let k = 0; k < bounces; k++) {
          woodHit(a, out, at, gain, pitch * (1 + (Math.random() - 0.5) * 0.06), k < 2 ? 1 : 0.5);
          at += gap;
          gap *= 0.7 + Math.random() * 0.12;             // bounces get quicker as the die settles
          gain *= 0.58 + Math.random() * 0.12;
        }
        // die-on-die clacks
        if (Math.random() < 0.7) woodHit(a, out, t + 0.06 + Math.random() * 0.3, 0.32, 2600 + Math.random() * 900, 0);
      }
      // final settle rattle as the last die rocks to a stop
      for (let k = 0; k < 5; k++) woodHit(a, out, t + 0.5 + k * 0.035 * (1 - k * 0.12) + Math.random() * 0.015, 0.14 * Math.pow(0.7, k), 1500 + Math.random() * 900, 0.25);
    },
    hold(a, t) { woodHit(a, master(a), t, 0.45, 1700, 0.25); },
    score(a, t) { const out = master(a); bell(a, out, t, 1046.5, 0.35, 0.16); bell(a, out, t + 0.06, 1568, 0.4, 0.12); },
    upper(a, t) {
      // bright rising chime + sparkle: "you earned the bonus"
      const out = master(a);
      [784, 988, 1175, 1568].forEach((f, i) => bell(a, out, t + i * 0.075, f, 0.6, 0.15));
      [3136, 3951, 4699].forEach((f, i) => bell(a, out, t + 0.33 + i * 0.05, f, 0.35, 0.05));
    },
    bonus(a, t) { [523, 659, 784, 1047].forEach((f, i) => tone(a, t + i * 0.08, f, 0.22, 0.12, 'triangle')); },
    win(a, t) { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(a, t + i * 0.09, f, 0.35, 0.11, 'triangle')); },
  };
  function sound(name, arg) {
    try {
      const a = audio();
      if (a && SOUNDS[name]) SOUNDS[name](a, a.currentTime + 0.01, arg);
    } catch (e) { /* audio unavailable */ }
  }

  /* ---------- Shareable results image ---------- */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

  function drawResults(players, date) {
    const ranked = players.slice().sort((a, b) => b.total - a.total);
    const W = 1080;
    const rowH = 132;
    const H = Math.max(1080, 470 + ranked.length * (rowH + 18) + 130);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1C1C1E');
    bg.addColorStop(1, '#000000');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, 120, 0, W / 2, 120, 700);
    glow.addColorStop(0, 'rgba(10,132,255,0.35)');
    glow.addColorStop(1, 'rgba(10,132,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `120px ${FONT}`;
    ctx.fillText(ranked.length > 1 ? '🏆' : '🎲', W / 2, 200);
    ctx.font = `800 76px ${FONT}`;
    const top = ranked[0];
    const tie = ranked.length > 1 && ranked[1].total === top.total;
    ctx.fillText(ranked.length === 1 ? `${top.total} points` : tie ? "It's a tie!" : `${top.name} wins!`, W / 2, 320);
    ctx.fillStyle = 'rgba(235,235,245,0.6)';
    ctx.font = `500 36px ${FONT}`;
    ctx.fillText(`Yahtzee · ${date}`, W / 2, 380);

    let y = 450;
    ranked.forEach((p, i) => {
      const place = ranked.findIndex((x) => x.total === p.total);
      ctx.fillStyle = place === 0 ? 'rgba(255,214,10,0.14)' : 'rgba(255,255,255,0.07)';
      rr(ctx, 80, y, W - 160, rowH, 32);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = ['#FFD60A', '#D1D1D6', '#E0A26A'][place] || 'rgba(235,235,245,0.5)';
      ctx.font = `800 44px ${FONT}`;
      ctx.fillText(String(place + 1), 150, y + rowH / 2 + 16);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(250, y + rowH / 2, 40, 0, Math.PI * 2);
      ctx.fill();
      { const n = parseInt(p.color.slice(1), 16); const y = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)); ctx.fillStyle = y > 170 ? '#1C1C1E' : '#fff'; }
      ctx.font = `700 40px ${FONT}`;
      const m = /^player\s*(\d+)$/i.exec(String(p.name).trim());
      const ini = m ? `P${m[1]}` : (String(p.name).trim().charAt(0).toUpperCase() || '?');
      ctx.font = `700 ${ini.length > 1 ? 32 : 40}px ${FONT}`;
      ctx.fillText(ini, 250, y + rowH / 2 + (ini.length > 1 ? 11 : 14));
      ctx.textAlign = 'left';
      ctx.font = `600 48px ${FONT}`;
      let name = p.name;
      while (ctx.measureText(name).width > 520 && name.length > 1) name = name.slice(0, -1);
      ctx.fillText(name === p.name ? name : name + '…', 320, y + rowH / 2 + 17);
      ctx.textAlign = 'right';
      ctx.font = `800 64px ${FONT}`;
      ctx.fillText(String(p.total), W - 130, y + rowH / 2 + 22);
      y += rowH + 18;
    });
    return c;
  }

  async function shareResults(players, date) {
    const c = drawResults(players, date);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!blob) return 'failed';
    const file = new File([blob], 'yahtzee-results.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Yahtzee results' });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'yahtzee-results.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  }

  window.FX = { confetti, sound, shareResults, drawResults, SOUNDS, setIgnoreSilent, unlock };
})();
