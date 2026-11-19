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
    if (!ac) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      ac = new A();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  let noiseBuf = null;
  function knock(a, t, freq, gain) {
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate * 0.05, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 2.5;
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(a.destination);
    src.start(t);
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
    roll(a, t) { for (let i = 0; i < 8; i++) knock(a, t + i * 0.042 + Math.random() * 0.02, 700 + Math.random() * 1600, 0.9 * (1 - i / 10)); },
    hold(a, t) { knock(a, t, 1800, 0.5); },
    score(a, t) { tone(a, t, 784, 0.12, 0.12); tone(a, t + 0.07, 1175, 0.16, 0.1); },
    bonus(a, t) { [523, 659, 784, 1047].forEach((f, i) => tone(a, t + i * 0.08, f, 0.22, 0.12, 'triangle')); },
    win(a, t) { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(a, t + i * 0.09, f, 0.35, 0.11, 'triangle')); },
  };
  function sound(name) {
    try {
      const a = audio();
      if (a && SOUNDS[name]) SOUNDS[name](a, a.currentTime + 0.01);
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
      ctx.fillStyle = '#fff';
      ctx.font = `700 40px ${FONT}`;
      ctx.fillText((p.name.charAt(0) || '?').toUpperCase(), 250, y + rowH / 2 + 14);
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

  window.FX = { confetti, sound, shareResults, drawResults };
})();
