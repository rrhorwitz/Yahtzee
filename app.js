/* Yahtzee Score Card — app logic */
(function () {
  'use strict';

  const S = window.Scoring;
  const COLORS = ['#007AFF', '#FF9500', '#34C759', '#FF2D55', '#AF52DE', '#5AC8FA', '#5856D6', '#FFCC00'];
  const KEYS = { settings: 'yahtzee.settings', game: 'yahtzee.game', undo: 'yahtzee.undo', history: 'yahtzee.history', last: 'yahtzee.lastPlayers' };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Storage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  let settings = Object.assign({ theme: 'system', autoRotate: true, dice: false, flip: 0, keepAwake: true, sounds: false, celebrate: true, hint: false }, store.get(KEYS.settings, {}));
  let game = store.get(KEYS.game, null);
  let undoStack = store.get(KEYS.undo, []);
  let history = store.get(KEYS.history, []);

  let justScored = null;  // category to flash
  let busy = false;       // true during turn transitions
  let angle = 0;          // cumulative stage rotation (deg)
  let sheetState = null;

  /* ---------- DOM ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const stage = $('#stage');
  const nav = $('#nav');
  const main = $('#main');
  const layer = $('#sheet-layer');
  const sheet = $('#sheet');
  const toastEl = $('#toast');

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* "Player 2" (the default name) → "P2"; a real name → its first letter. */
  const initialOf = (name) => {
    const m = /^player\s*(\d+)$/i.exec(String(name).trim());
    return m ? `P${m[1]}` : (String(name).trim().charAt(0).toUpperCase() || '?');
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /* Haptics: real taps in the iPhone app (native.js); vibration fallback on Android browsers. */
  const NATIVE = window.Native || { isNative: false, haptic: () => false, keepAwake: () => false, gameCenter: { available: false } };
  const haptic = (kind) => {
    if (NATIVE.haptic(kind)) return;
    const ms = { light: 6, medium: 12, heavy: 18, success: 24 }[kind] || 8;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
  };

  /* ---------- Icons (SF Symbols–style) ---------- */
  const ICON = {
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18.5" cy="12" r="2"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m1 1 6 6-6 6"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12h10" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12h10M12 7v10" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  };

  const PIPS = { TL: [25, 25], TR: [75, 25], ML: [25, 50], C: [50, 50], MR: [75, 50], BL: [25, 75], BR: [75, 75] };
  const FACE = { 1: ['C'], 2: ['TR', 'BL'], 3: ['TR', 'C', 'BL'], 4: ['TL', 'TR', 'BL', 'BR'], 5: ['TL', 'TR', 'C', 'BL', 'BR'], 6: ['TL', 'TR', 'ML', 'MR', 'BL', 'BR'] };
  // spread < 1 pulls pips toward the centre (small icon tiles); 1 = full real-dice layout
  function pips(n, color, r, spread) {
    const s = spread || 1;
    const at = (v) => (50 + (v - 50) * s).toFixed(1);
    return FACE[n].map((k) => `<circle cx="${at(PIPS[k][0])}" cy="${at(PIPS[k][1])}" r="${r}" fill="${color}"/>`).join('');
  }
  const dieFace = (n) => `<svg viewBox="0 0 100 100">${pips(n, 'currentColor', 10.5)}</svg>`;

  const LOWER_TILE = {
    threeKind: ['#FF9500', '3×'], fourKind: ['#FF3B30', '4×'], fullHouse: ['#34C759', 'FH'],
    smallStraight: ['#5AC8FA', 'SS'], largeStraight: ['#5856D6', 'LS'], yahtzee: ['#FF2D55', 'Y'], chance: ['#8E8E93', '?'],
  };
  function tile(cat) {
    const ui = S.UPPER.indexOf(cat);
    if (ui >= 0) {
      return `<svg viewBox="0 0 100 100" width="28" height="28"><rect width="100" height="100" rx="23" fill="#007AFF"/>${pips(ui + 1, '#fff', 8.5, 0.88)}</svg>`;
    }
    const [bg, txt] = LOWER_TILE[cat];
    return `<svg viewBox="0 0 100 100" width="28" height="28"><rect width="100" height="100" rx="23" fill="${bg}"/><text x="50" y="52" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,system-ui,sans-serif" font-weight="700" font-size="${txt.length > 1 ? 40 : 50}">${txt}</text></svg>`;
  }

  /* ---------- Game model ---------- */
  const freshTurn = () => ({ dice: [1, 1, 1, 1, 1], held: [false, false, false, false, false], rolls: 0 });
  const cur = () => game.players[game.current];
  const isDone = (p) => S.totals(p).filled === 13;

  function save() {
    store.set(KEYS.settings, settings);
    if (game) store.set(KEYS.game, game); else store.del(KEYS.game);
    store.set(KEYS.undo, undoStack);
    store.set(KEYS.history, history);
  }

  function createGame(players) {
    game = {
      id: Date.now(),
      startedAt: Date.now(),
      players: players.map((p, i) => ({
        name: p.name.trim() || `Player ${i + 1}`,
        color: COLORS[i % COLORS.length],
        seat: p.seat || 0,
        scores: S.emptyScores(),
        bonusCount: 0,
      })),
      current: 0,
      turn: freshTurn(),
      finished: false,
    };
    undoStack = [];
    store.set(KEYS.last, game.players.map((p) => ({ name: p.name, seat: p.seat })));
    save();
  }

  function historyPlayers() {
    return game.players.map((p) => {
      const t = S.totals(p);
      return {
        name: p.name, total: t.grandTotal, color: p.color,
        yahtzees: (p.scores.yahtzee === 50 ? 1 : 0) + (p.bonusCount || 0),
        upperBonus: t.upperBonus > 0,
      };
    });
  }

  function pushUndo(desc) {
    undoStack.push(JSON.stringify({ g: game, d: desc || '' }));
    if (undoStack.length > 80) undoStack.shift();
  }
  /* Older saves stored the bare game; newer ones wrap it with a description. */
  function readUndo(raw) {
    const o = JSON.parse(raw);
    return o && o.g ? { game: o.g, desc: o.d } : { game: o, desc: '' };
  }

  /* ---------- Theme ---------- */
  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme; else root.dataset.theme = settings.theme;
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && sysDark);
    metas.forEach((m) => { m.setAttribute('content', dark ? '#000000' : '#F2F2F7'); });
  }

  /* ---------- Rotation ---------- */
  function targetAngle() {
    if (!settings.autoRotate) return 0;
    let a = settings.flip || 0;
    if (game && game.players.length > 1 && !game.finished) a += cur().seat || 0;
    return ((a % 360) + 360) % 360;
  }
  const norm = (a) => ((a % 360) + 360) % 360;

  function setAngleImmediately() {
    angle = targetAngle();
    stage.style.transform = `rotate(${angle}deg)`;
  }

  async function turnTransition(direction) {
    const target = targetAngle();
    if (target === norm(angle)) { render(); return; }
    const from = angle;
    const to = angle + (direction === -1 ? -180 : 180);
    angle = to;
    stage.style.transform = `rotate(${to}deg)`;
    if (reducedMotion.matches) { render(); return; }
    stage.classList.add('spinning');
    const mid = (from + to) / 2;
    const anim = stage.animate([
      { transform: `rotate(${from}deg) scale(1)`, borderRadius: '0px' },
      { transform: `rotate(${mid}deg) scale(0.86)`, borderRadius: '40px', offset: 0.5 },
      { transform: `rotate(${to}deg) scale(1)`, borderRadius: '0px' },
    ], { duration: 560, easing: 'cubic-bezier(.6,0,.3,1)' });
    setTimeout(() => { render(); }, 280);
    try { await anim.finished; } catch (e) { /* cancelled */ }
    stage.classList.remove('spinning');
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(html, ms) {
    toastEl.innerHTML = html;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 1600);
  }

  /* ---------- Rendering ---------- */
  function render() {
    if (!game) { renderEmpty(); } else { renderNav(); renderMain(); }
    syncWakeLock();
  }

  function renderEmpty() {
    nav.innerHTML = `<div class="nav-bar"><span></span><div class="nav-actions">
      <button class="icon-btn" data-action="settings" aria-label="Settings">${ICON.more}</button></div></div>`;
    main.innerHTML = `<div class="empty-state">
      <img class="app-icon" src="icons/icon.svg" alt="">
      <h2>Yahtzee</h2>
      <p>Keep score at the table. The card flips to face whoever's turn it is.</p>
      <button class="btn" data-action="new-game">New Game</button>
      ${history.length ? '<button class="text-btn" data-action="history">Scores &amp; History</button>' : ''}
    </div>`;
  }

  function renderNav() {
    const p = cur();
    const round = Math.min(S.totals(p).filled + 1, 13);
    const solo = game.players.length === 1;
    const title = game.finished
      ? '<span class="nav-name">Final Scores</span>'
      : `<span class="dot" style="background:${p.color}"></span><span class="nav-name">${esc(p.name)}${solo ? '' : "'s turn"}</span>`;
    nav.innerHTML = `<div class="nav-bar">
      <div class="nav-title">
        <div class="nav-line">${title}</div>
        <div class="nav-sub">${game.finished ? 'Game over' : `Round ${round} of 13`}</div>
      </div>
      <div class="nav-actions">
        ${game.finished ? `<button class="icon-btn" data-action="results" aria-label="Results">${ICON.trophy}</button>` : ''}
        <button class="icon-btn" data-action="undo" aria-label="Undo" ${undoStack.length ? '' : 'disabled'}>${ICON.undo}</button>
        ${settings.autoRotate ? `<button class="icon-btn" data-action="flip" aria-label="Flip card">${ICON.flip}</button>` : ''}
        <button class="icon-btn" data-action="settings" aria-label="Menu">${ICON.more}</button>
      </div>
    </div>`;
  }

  function renderMain() {
    const players = game.players;
    const n = players.length;
    const turn = game.turn;
    const me = cur();
    const diceLive = settings.dice && !game.finished && turn.rolls > 0 && !justScored;
    const allowed = diceLive ? S.allowedCategories(turn.dice, me.scores) : null;
    const hintCat = diceLive && settings.hint ? suggestBox(allowed, turn.dice, me.scores) : null;
    const totals = players.map((p) => S.totals(p));
    const isCur = (i) => i === game.current && !game.finished;
    const colStyle = (i) => (isCur(i) ? ` style="--pc:${players[i].color}"` : '');
    const curCls = (i) => (isCur(i) ? ' cur' : '');

    let h = '<div class="c corner"></div>';
    h += players.map((p, i) => `<button class="c head${curCls(i)}"${colStyle(i)} data-action="rename" data-p="${i}" title="${esc(p.name)}" aria-label="${esc(p.name)}${isCur(i) ? ', current turn' : ''}. Rename">
      <span class="avatar${initialOf(p.name).length > 1 ? ' wide' : ''}" style="--chip-color:${p.color};color:${textOn(p.color)}">${esc(initialOf(p.name))}</span></button>`).join('');

    const catRow = (cat, extra) => {
      let r = `<button class="c label${extra || ''}" data-action="info" data-cat="${cat}" aria-label="How ${S.LABELS[cat]} scores"><span class="tile">${tile(cat)}</span><span class="lbl"><span class="lbl-f">${S.LABELS[cat]}</span><span class="lbl-s">${SHORT[cat] || S.LABELS[cat]}</span></span></button>`;
      players.forEach((p, i) => {
        const v = p.scores[cat];
        const cls = ['c', 'val' + (extra || '') + curCls(i)];
        let inner = '';
        let act = false;
        if (v !== null) {
          inner = String(v);
          cls.push('filled');
          if (v === 0) cls.push('zero');
          if (justScored === cat && isCur(i)) cls.push('flash');
        } else if (isCur(i)) {
          if (diceLive) {
            if (allowed.includes(cat)) {
              const s = S.scoreFor(cat, turn.dice, p.scores);
              inner = `<span class="pv${s ? '' : ' z'}${cat === hintCat ? ' best' : ''}">${s}</span>`;
              act = true;
            } else cls.push('locked');
          } else { act = true; cls.push('open'); }
        }
        const said = v !== null ? String(v)
          : cls.includes('locked') ? 'not allowed this roll'
          : diceLive && isCur(i) ? `would score ${S.scoreFor(cat, turn.dice, p.scores)}${cat === hintCat ? ', suggested' : ''}`
          : isCur(i) ? 'open, tap to score' : 'open';
        const aria = `${esc(p.name)}, ${S.LABELS[cat]}, ${said}${v !== null ? '. Press and hold to change' : ''}`;
        r += act
          ? `<button class="${cls.join(' ')}"${colStyle(i)} data-action="score" data-cat="${cat}" aria-label="${aria}">${inner}</button>`
          : `<div class="${cls.join(' ')}"${colStyle(i)}${v !== null ? ` data-p="${i}" data-cat="${cat}"` : ''} role="img" aria-label="${aria}">${inner}</div>`;
      });
      return r;
    };

    S.UPPER.forEach((c) => { h += catRow(c); });

    h += `<button class="c label sum" data-action="info" data-cat="upperBonus" aria-label="How the upper bonus works"><span class="lbl"><span class="lbl-f">Bonus <small>63+</small></span><span class="lbl-s">Bonus</span></span></button>`;
    h += players.map((p, i) => {
      const t = totals[i];
      if (t.upperBonus) return `<div class="c val sum${curCls(i)} earned"${colStyle(i)} aria-label="${esc(p.name)}, upper bonus earned">+${t.upperBonus}</div>`;
      const pace = upperPace(p);
      const paceHtml = pace.filled && !pace.missed
        ? `<span class="pace ${pace.diff >= 0 ? 'up' : 'down'}">${pace.diff > 0 ? '+' : pace.diff < 0 ? '−' : '±'}${Math.abs(pace.diff)}</span>` : '';
      const aria = pace.missed ? 'bonus out of reach' : pace.filled ? `${Math.abs(pace.diff)} ${pace.diff >= 0 ? 'ahead of' : 'behind'} bonus pace` : 'no upper scores yet';
      return `<button class="c val sum pacecell${curCls(i)}${pace.missed ? ' missed' : ''}"${colStyle(i)} data-action="pace" data-p="${i}" aria-label="${esc(p.name)}, upper ${t.upperSum} of 63, ${aria}. Tap for details">
        <span class="frac">${t.upperSum}<small>/63</small></span>${paceHtml}</button>`;
    }).join('');

    S.LOWER.forEach((c, k) => { h += catRow(c, k === 0 ? ' sec' : ''); });

    h += `<button class="c label sum" data-action="info" data-cat="yahtzeeBonus" aria-label="How the Yahtzee bonus works"><span class="lbl"><span class="lbl-f">Yahtzee Bonus</span><span class="lbl-s">Y. Bonus</span></span></button>`;
    h += players.map((p, i) => {
      const t = totals[i];
      const txt = p.bonusCount ? `+${t.yahtzeeBonus}` : '';
      if (isCur(i)) return `<button class="c val sum${curCls(i)} bonus" data-action="bonus"${colStyle(i)} aria-label="Yahtzee bonus">${txt || '<span class="plus">+</span>'}</button>`;
      return `<div class="c val sum${curCls(i)}"${colStyle(i)}>${txt}</div>`;
    }).join('');

    h += `<div class="c label total"><span class="lbl">Total</span></div>`;
    const best = Math.max(...totals.map((t) => t.grandTotal));
    h += players.map((p, i) => `<div class="c val total${curCls(i)}${game.finished && n > 1 && totals[i].grandTotal === best ? ' winner' : ''}"${colStyle(i)} aria-label="${esc(p.name)}, total ${totals[i].grandTotal}">${totals[i].grandTotal}</div>`).join('');

    main.innerHTML = (settings.dice && !game.finished ? renderTray() : '')
      + `<div class="board" style="--cols:${n}">${h}</div>`;
    infoOpen = null;
    fitBoard();
    animateTotals();
  }

  /* Totals tick up (or down) to their new value. The animation survives re-renders
     (e.g. mid-flip) because each frame looks up the current cell. */
  let shownTotals = null;
  const totalAnims = {};
  function animateTotals() {
    const now = game.players.map((p) => S.totals(p).grandTotal);
    const prev = shownTotals && shownTotals.id === game.id && shownTotals.v.length === now.length ? shownTotals.v : null;
    shownTotals = { id: game.id, v: now };
    const cells = main.querySelectorAll('.c.val.total');
    now.forEach((v, i) => {
      const a = totalAnims[i];
      if (a && a.to === v) { if (cells[i]) cells[i].textContent = String(a.current); return; } // keep running
      if (!prev || prev[i] === v || reducedMotion.matches) { delete totalAnims[i]; return; }
      const from = a ? a.current : prev[i];
      const anim = { from, to: v, current: from, t0: performance.now(), dur: Math.min(900, 380 + Math.abs(v - from) * 5) };
      totalAnims[i] = anim;
      if (cells[i]) cells[i].textContent = String(from);
      const step = (t) => {
        if (totalAnims[i] !== anim) return;
        const k = Math.min(1, (t - anim.t0) / anim.dur);
        anim.current = Math.round(anim.from + (anim.to - anim.from) * (1 - Math.pow(1 - k, 3)));
        const el = main.querySelectorAll('.c.val.total')[i];
        if (el) { el.textContent = String(anim.current); el.classList.toggle('counting', k < 1); }
        if (k < 1) requestAnimationFrame(step); else delete totalAnims[i];
      };
      requestAnimationFrame(step);
    });
  }

  const SHORT = { threeKind: '3 Kind', fourKind: '4 Kind', fullHouse: 'F. House', smallStraight: 'Sm. Str.', largeStraight: 'Lg. Str.' };

  /* Readable text on a player colour (dark text on light colours like yellow/teal). */
  function textOn(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.45 ? '#1C1C1E' : '#FFFFFF'; // only very light colours (yellow, light blue) get dark text
  }

  /* Best-move hint: compare each legal box's score with what that box typically
     earns over a game, nudged for upper-bonus pace and keeping Chance in reserve. */
  const TYPICAL = { ones: 2.1, twos: 5.3, threes: 8.6, fours: 12.2, fives: 15.7, sixes: 19.2, threeKind: 15.2, fourKind: 5.6, fullHouse: 9.2, smallStraight: 12.2, largeStraight: 10.4, yahtzee: 2.3, chance: 22 };
  function suggestBox(allowed, dice, scores) {
    const filled = S.ALL.filter((c) => scores[c] !== null).length;
    let bestCat = null;
    let bestV = -Infinity;
    allowed.forEach((c) => {
      const s = S.scoreFor(c, dice, scores);
      let v = s - TYPICAL[c];
      const ui = S.UPPER.indexOf(c);
      if (ui >= 0 && s > 0) v += (s - 3 * (ui + 1)) * 0.8 + (s >= 3 * (ui + 1) ? 3 : 0);
      if (c === 'chance' && filled < 10) v -= 4;
      if (c === 'yahtzee' && s === 50) v += 100;
      if (v > bestV) { bestV = v; bestCat = c; }
    });
    return bestCat;
  }

  /* Upper-bonus pace: compare against par (three of each number filled so far). */
  function upperPace(p) {
    let par = 0;
    let sum = 0;
    let maxLeft = 0;
    let filled = 0;
    S.UPPER.forEach((c, k) => {
      const face = k + 1;
      if (p.scores[c] === null) maxLeft += face * 5;
      else { filled++; par += face * 3; sum += p.scores[c]; }
    });
    return { filled, diff: sum - par, missed: sum + maxLeft < S.UPPER_BONUS_THRESHOLD };
  }

  /* Switch to initials / hide icons when columns get tight. */
  function fitBoard() {
    const board = main.querySelector('.board');
    if (!board || !game) return;
    const n = game.players.length;
    const w = board.clientWidth;
    const colW = w / (1.55 + n);
    const fs = parseFloat(getComputedStyle(board).fontSize) || 16;
    const initials = colW < 58; // narrow columns: short labels, wider label column
    board.classList.toggle('initials', initials);
    const labelW = initials ? (w * 2) / (2 + n) : colW * 1.55;
    board.classList.toggle('no-tiles', labelW < fs * (initials ? 7 : 8.6));
  }

  /* ---------- "How to score" popover ---------- */
  const INFO = {
    ones: { dice: [1, 4, 1, 6, 1], on: [1, 0, 1, 0, 1], rule: 'Add up only the aces.', eq: '3' },
    twos: { dice: [2, 5, 2, 2, 3], on: [1, 0, 1, 1, 0], rule: 'Add up only the twos.', eq: '6' },
    threes: { dice: [3, 3, 6, 3, 1], on: [1, 1, 0, 1, 0], rule: 'Add up only the threes.', eq: '9' },
    fours: { dice: [4, 2, 4, 4, 6], on: [1, 0, 1, 1, 0], rule: 'Add up only the fours.', eq: '12' },
    fives: { dice: [5, 1, 5, 3, 5], on: [1, 0, 1, 0, 1], rule: 'Add up only the fives.', eq: '15' },
    sixes: { dice: [6, 6, 2, 6, 6], on: [1, 1, 0, 1, 1], rule: 'Add up only the sixes.', eq: '24' },
    threeKind: { dice: [4, 4, 4, 2, 6], on: [1, 1, 1, 1, 1], rule: 'At least three dice the same. Score the total of all five dice.', eq: '20' },
    fourKind: { dice: [5, 5, 2, 5, 5], on: [1, 1, 1, 1, 1], rule: 'At least four dice the same. Score the total of all five dice.', eq: '22' },
    fullHouse: { dice: [3, 3, 3, 6, 6], on: [1, 1, 1, 1, 1], rule: 'Three of one number and two of another.', eq: '25', fixed: 25 },
    smallStraight: { dice: [1, 2, 3, 4, 6], on: [1, 1, 1, 1, 0], rule: 'Four numbers in a row.', eq: '30', fixed: 30 },
    largeStraight: { dice: [2, 3, 4, 5, 6], on: [1, 1, 1, 1, 1], rule: 'Five numbers in a row.', eq: '40', fixed: 40 },
    yahtzee: { dice: [6, 6, 6, 6, 6], on: [1, 1, 1, 1, 1], rule: 'All five dice the same.', eq: '50', fixed: 50 },
    chance: { dice: [1, 3, 4, 5, 6], on: [1, 1, 1, 1, 1], rule: 'Any roll at all. Score the total of all five dice.', eq: '19' },
    upperBonus: { title: 'Upper Bonus', rule: 'Score 63 or more across Aces through Sixes — that’s three of each number. The green or red number shows how far ahead or behind that pace you are; tap it for details.', fixed: 35, plus: true },
    yahtzeeBonus: { title: 'Yahtzee Bonus', rule: 'Each extra Yahtzee after scoring 50 in the Yahtzee box. You still fill another box with it (Joker rules).', fixed: 100, plus: true },
  };
  let infoOpen = null;

  /* Position in the stage's own (unrotated) coordinates so it works when flipped. */
  function placePop(pop, anchor, pointX) {
    const top = anchor.offsetTop;
    const h = anchor.offsetHeight;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.max(8, Math.min(pointX - 22, main.clientWidth - pw - 8));
    const below = top + h + ph + 10 <= main.clientHeight;
    pop.style.left = left + 'px';
    pop.style.top = (below ? top + h + 6 : top - ph - 6) + 'px';
    pop.classList.add(below ? 'below' : 'above');
    pop.style.setProperty('--ax', Math.min(Math.max(pointX - left, 18), pw - 18) + 'px');
  }

  function closeInfo() {
    const pop = main.querySelector('.pop');
    infoOpen = null;
    if (!pop) return;
    pop.classList.remove('show');
    setTimeout(() => pop.remove(), 160);
  }

  function openInfo(cat, anchor) {
    const wasOpen = infoOpen === cat;
    main.querySelectorAll('.label.pressed').forEach((x) => x.classList.remove('pressed'));
    main.querySelectorAll('.pop').forEach((p) => p.remove());
    infoOpen = null;
    if (wasOpen) return;
    const d = INFO[cat];
    const title = d.title || S.LABELS[cat];
    const dice = d.dice
      ? `<div class="pop-dice">${d.dice.map((v, k) => `<span class="pop-die${d.on[k] ? '' : ' off'}">${dieFace(v)}</span>`).join('')}<span class="pop-eq">= ${d.eq}</span></div>`
      : '';
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'tooltip');
    pop.innerHTML = `<div class="pop-head"><span class="pop-title">${title}</span>${d.fixed ? `<span class="pop-pts">${d.plus ? '+' : ''}${d.fixed} pts</span>` : ''}</div>
      ${dice}<p class="pop-rule">${d.rule}</p><i class="pop-arrow"></i>`;
    main.appendChild(pop);

    placePop(pop, anchor, anchor.offsetLeft + 28);
    anchor.classList.add('pressed');
    pop._anchor = anchor;
    requestAnimationFrame(() => pop.classList.add('show'));
    infoOpen = cat;
  }

  /* Bonus pace popover for one player: what the +/- means, box by box. */
  function openPace(pi, anchor) {
    const key = 'pace:' + pi;
    const wasOpen = infoOpen === key;
    main.querySelectorAll('.label.pressed, .pacecell.pressed').forEach((x) => x.classList.remove('pressed'));
    main.querySelectorAll('.pop').forEach((x) => x.remove());
    infoOpen = null;
    if (wasOpen) return;
    const p = game.players[pi];
    const t = S.totals(p);
    const pace = upperPace(p);
    const name = esc(p.name);
    let pill = '';
    let body = '';
    if (pace.missed) {
      pill = '<span class="pop-pts pace-pill down">Out of reach</span>';
      body = `Even five of each in ${name}’s open boxes can’t reach 63, so the +35 bonus is gone this game.`;
    } else if (!pace.filled) {
      pill = '<span class="pop-pts">Needs 63</span>';
      body = 'Three of each number (three 1s, three 2s … three 6s) adds up to exactly 63, the bonus target. Once boxes are filled, this shows how far ahead or behind that pace you are.';
    } else {
      const d = pace.diff;
      pill = `<span class="pop-pts pace-pill ${d >= 0 ? 'up' : 'down'}">${d > 0 ? `${d} ahead` : d < 0 ? `${-d} behind` : 'On pace'}</span>`;
      const chips = S.UPPER.map((c, k) => {
        if (p.scores[c] === null) return '';
        const face = k + 1;
        const diff = p.scores[c] - face * 3;
        return `<span class="pace-chip ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}"><b>${face}s</b> ${p.scores[c]} <i>${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)}</i></span>`;
      }).join('');
      const need = S.UPPER_BONUS_THRESHOLD - t.upperSum;
      body = `Three of each number adds up to exactly 63. Compared with three of each in the boxes filled so far, ${name} is ${d > 0 ? `<b>${d} ahead</b>` : d < 0 ? `<b>${-d} behind</b>` : '<b>right on pace</b>'}. Needs ${need} more for +35.`;
      body = `<span class="pace-chips">${chips}</span>${body}`;
    }
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'tooltip');
    pop.innerHTML = `<div class="pop-head"><span class="pop-title">Bonus pace</span>${pill}</div><p class="pop-rule">${body}</p><i class="pop-arrow"></i>`;
    main.appendChild(pop);
    placePop(pop, anchor, anchor.offsetLeft + anchor.offsetWidth / 2);
    anchor.classList.add('pressed');
    requestAnimationFrame(() => pop.classList.add('show'));
    infoOpen = key;
  }

  function renderTray() {
    const turn = game.turn;
    const rolled = turn.rolls > 0;
    const dice = turn.dice.map((v, i) => {
      const held = rolled && turn.held[i];
      return `<button class="die ${rolled ? '' : 'blank'} ${held ? 'held' : ''}" data-action="hold" data-i="${i}" aria-label="${rolled ? `Die ${i + 1}: ${v}${held ? ', held' : ''}` : 'Die not rolled'}" ${rolled ? '' : 'disabled'}>${rolled ? dieFace(v) : ''}</button>`;
    }).join('');
    const left = 3 - turn.rolls;
    return `<div class="tray" id="tray">
      <div class="dice">${dice}</div>
      <button class="roll-btn" data-action="roll" ${left <= 0 ? 'disabled' : ''}>
        <span>Roll</span><span class="roll-pips" aria-label="${left} rolls left">${[0, 1, 2].map((k) => `<i class="${k < turn.rolls ? 'used' : ''}"></i>`).join('')}</span>
      </button>
    </div>`;
  }

  /* ---------- Sheets ---------- */
  function openSheet(opts) {
    sheetState = opts;
    sheet.className = 'sheet' + (opts.compact ? ' compact' : '');
    sheet.innerHTML = `<div class="grabber"></div>
      <div class="sheet-head">
        <div class="left">${opts.left || ''}</div>
        <div class="sheet-title">${opts.title || ''}</div>
        <div class="right">${opts.right === undefined ? '<button class="text-btn bold" data-action="close-sheet">Done</button>' : opts.right}</div>
      </div>
      <div class="sheet-body">${opts.body}</div>`;
    layer.classList.add('open');
    layer.setAttribute('aria-hidden', 'false');
  }
  function refreshSheetBody(html) { const b = $('.sheet-body', sheet); if (b) b.innerHTML = html; }
  function closeSheet() {
    if (!layer.classList.contains('open')) return;
    if (sheetState && sheetState.onClose) sheetState.onClose();
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    sheetState = null;
    if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
  }

  // Drag-to-dismiss
  (function enableDrag() {
    let startY = null; let dy = 0;
    sheet.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.grabber, .sheet-head') || e.target.closest('button')) return;
      startY = e.clientY; dy = 0;
      sheet.classList.add('dragging');
      sheet.setPointerCapture(e.pointerId);
    });
    sheet.addEventListener('pointermove', (e) => {
      if (startY === null) return;
      // Account for a rotated stage: screen-down is element-up when flipped 180°.
      const sign = norm(angle) === 180 ? -1 : 1;
      dy = Math.max(0, (e.clientY - startY) * sign);
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (startY === null) return;
      startY = null;
      sheet.classList.remove('dragging');
      sheet.style.transform = '';
      if (dy > 90) closeSheet();
    };
    sheet.addEventListener('pointerup', end);
    sheet.addEventListener('pointercancel', end);
  })();

  /* Manual score picker */
  function openPicker(cat, edit) {
    const opts = S.manualOptions(cat);
    const ui = S.UPPER.indexOf(cat);
    let body = `<p class="sheet-lede">${S.HINTS[cat]}</p>`;
    if (ui >= 0) {
      const face = ui + 1;
      body += `<div class="value-grid">${opts.filter((v) => v > 0).map((v) =>
        `<button class="value-btn" data-action="pick" data-v="${v}"><span>${v}<small>${v / face} × ${face}</small></span></button>`).join('')}
        <button class="value-btn scratch" data-action="pick" data-v="0">Scratch (0)</button></div>`;
    } else if (cat in S.FIXED) {
      body += `<div class="value-grid"><button class="value-btn big" data-action="pick" data-v="${S.FIXED[cat]}">${S.FIXED[cat]}</button>
        <button class="value-btn scratch" data-action="pick" data-v="0">Scratch (0)</button></div>`;
    } else {
      body += `<div class="value-grid dense">${opts.filter((v) => v > 0).map((v) =>
        `<button class="value-btn" data-action="pick" data-v="${v}">${v}</button>`).join('')}
        ${opts.includes(0) ? '<button class="value-btn scratch" data-action="pick" data-v="0">Scratch (0)</button>' : ''}</div>`;
    }
    if (edit) {
      body = body.replace(new RegExp(`data-v="${edit.current}"`), `data-v="${edit.current}" aria-current="true"`);
      body = `<p class="sheet-lede edit-note">Changing ${esc(game.players[edit.pi].name)}'s score from <b>${edit.current}</b></p>` + body;
    }
    openSheet({
      title: edit ? `Edit ${S.LABELS[cat]}` : S.LABELS[cat], compact: false,
      left: '<button class="text-btn" data-action="close-sheet">Cancel</button>', right: '',
      body, cat, edit,
    });
  }

  function openEdit(pi, cat) {
    if (busy || !game) return;
    const p = game.players[pi];
    if (!p || p.scores[cat] === null) return;
    openPicker(cat, { pi, current: p.scores[cat] });
  }

  function applyEdit(pi, cat, v) {
    const p = game.players[pi];
    closeSheet();
    if (p.scores[cat] === v) return;
    pushUndo(`${esc(p.name)}'s ${S.LABELS[cat]} change`);
    const before = S.totals(p).upperBonus;
    p.scores[cat] = v;
    if (game.finished) {
      const rec = history.find((g) => g.id === game.id);
      if (rec) rec.players = historyPlayers();
    }
    save();
    render();
    toast(`${esc(p.name)}'s ${S.LABELS[cat]} changed to ${v}`);
    if (!before && S.totals(p).upperBonus) celebrate('small');
  }

  /* Rename players (any time during a game) */
  function openRename(focusIdx) {
    const body = `<div class="group">${game.players.map((p, i) => `<div class="row player-row">
        <span class="avatar${initialOf(p.name).length > 1 ? ' wide' : ''}" style="--chip-color:${p.color};color:${textOn(p.color)}">${esc(initialOf(p.name))}</span>
        <input data-rn="${i}" value="${/^player\s*\d+$/i.test(p.name) ? '' : esc(p.name)}" placeholder="Player ${i + 1}" maxlength="18" autocomplete="off" enterkeyhint="done" aria-label="Name for player ${i + 1}">
      </div>`).join('')}</div>
      <p class="section-footer">Leave a name blank to use “Player 1”, “Player 2”…</p>`;
    openSheet({
      title: 'Players',
      left: '<button class="text-btn" data-action="close-sheet">Cancel</button>',
      right: '<button class="text-btn bold" data-action="rename-save">Save</button>',
      body,
    });
    if (focusIdx !== null) setTimeout(() => { const el = sheet.querySelector(`input[data-rn="${focusIdx}"]`); if (el) el.focus(); }, 350);
  }
  function saveRename() {
    sheet.querySelectorAll('input[data-rn]').forEach((inp) => {
      const i = +inp.dataset.rn;
      game.players[i].name = inp.value.trim() || `Player ${i + 1}`;
    });
    store.set(KEYS.last, game.players.map((p) => ({ name: p.name, seat: p.seat })));
    save();
    closeSheet();
    render();
  }

  /* One-time tips */
  const tips = Object.assign({ info: false, edit: false }, store.get('yahtzee.tips', {}));
  let tipEl = null;
  function dismissTip() {
    if (!tipEl) return;
    const t = tipEl;
    tipEl = null;
    t.classList.remove('show');
    setTimeout(() => t.remove(), 180);
  }
  function showTip(key, anchor, text) {
    if (tips[key] || !anchor || tipEl || layer.classList.contains('open')) return;
    tips[key] = true;
    store.set('yahtzee.tips', tips);
    const pop = document.createElement('div');
    pop.className = 'pop tip';
    pop.setAttribute('role', 'status');
    pop.innerHTML = `<p class="pop-rule">${text}</p><i class="pop-arrow"></i>`;
    main.appendChild(pop);
    placePop(pop, anchor, anchor.offsetLeft + Math.min(28, anchor.offsetWidth / 2));
    tipEl = pop;
    requestAnimationFrame(() => pop.classList.add('show'));
    setTimeout(() => { if (tipEl === pop) dismissTip(); }, 6000);
  }
  function maybeTips(lastScored) {
    if (!game || game.finished || busy) return;
    if (!tips.info) {
      setTimeout(() => showTip('info', main.querySelector('.c.label[data-cat="fullHouse"]'), 'Tip: tap a category name to see how it scores.'), 600);
    } else if (!tips.edit && lastScored) {
      setTimeout(() => showTip('edit', main.querySelector(`.c.filled[data-p="${lastScored.p}"][data-cat="${lastScored.cat}"]`), 'Tip: press and hold a score to change it.'), 300);
    }
  }

  /* Yahtzee bonus stepper */
  function openBonus() {
    const p = cur();
    let count = p.bonusCount || 0;
    const canAdd = p.scores.yahtzee === 50;
    const draw = () => `<p class="sheet-lede">${canAdd
      ? `Each extra Yahtzee after scoring 50 earns +${S.YAHTZEE_BONUS}.`
      : 'Score 50 in the Yahtzee box first to earn bonus Yahtzees.'}${settings.dice ? '<br>Bonuses from the dice roller are added for you.' : ''}</p>
      <div class="stepper">
        <button data-action="bonus-step" data-d="-1" aria-label="Remove bonus" ${count <= 0 ? 'disabled' : ''}>−</button>
        <output>+${count * S.YAHTZEE_BONUS}</output>
        <button data-action="bonus-step" data-d="1" aria-label="Add bonus" ${canAdd ? '' : 'disabled'}>+</button>
      </div>`;
    openSheet({
      title: 'Yahtzee Bonus',
      left: '<button class="text-btn" data-action="close-sheet">Cancel</button>',
      right: '<button class="text-btn bold" data-action="bonus-save">Save</button>',
      body: draw(),
      step(d) { count = Math.max(0, count + d); if (!canAdd && d > 0) count -= d; refreshSheetBody(draw()); },
      saveBonus() {
        if (count !== (p.bonusCount || 0)) { pushUndo(`${esc(p.name)}'s Yahtzee bonus`); p.bonusCount = count; save(); render(); }
        closeSheet();
      },
    });
  }

  /* New game */
  function openNewGame() {
    const last = store.get(KEYS.last, null);
    const draft = (last && last.length ? last : [{ name: '', seat: 0 }, { name: '', seat: 180 }]).map((p) => ({ name: p.name, seat: p.seat || 0 }));
    const draw = () => `
      <div class="section-header"><span>Players</span><span>${draft.length}</span></div>
      <div class="group">
        ${draft.map((p, i) => `<div class="row player-row">
          ${draft.length > 1 ? `<button class="remove-btn" data-action="np-remove" data-i="${i}" aria-label="Remove player">${ICON.minus}</button>` : ''}
          <span class="avatar" style="--chip-color:${COLORS[i % COLORS.length]};color:${textOn(COLORS[i % COLORS.length])}">${i + 1}</span>
          <input data-np="${i}" value="${esc(p.name)}" placeholder="Player ${i + 1}" maxlength="18" autocomplete="off" enterkeyhint="done">
          <button class="seat-btn ${p.seat ? 'far' : ''}" data-action="np-seat" data-i="${i}" aria-label="Seat side">${ICON.arrowUp}${p.seat ? 'Far side' : 'Near side'}</button>
        </div>`).join('')}
        ${draft.length < 8 ? `<button class="row add-row has-icon" data-action="np-add"><span class="row-icon" style="width:24px;height:24px">${ICON.plus}</span><span class="row-body">Add Player</span></button>` : ''}
      </div>
      <p class="section-footer">Seat side sets which way the card faces on that player's turn. Players across the table should be on the far side.</p>
      <div class="actions"><button class="btn block" data-action="np-start">Start Game</button></div>`;
    openSheet({
      title: 'New Game',
      left: '<button class="text-btn" data-action="close-sheet">Cancel</button>', right: '',
      body: draw(),
      draft,
      redraw() { refreshSheetBody(draw()); },
    });
  }

  /* Settings */
  function settingsBody() {
    const seg = (v, label) => `<button data-action="theme" data-v="${v}" aria-pressed="${settings.theme === v}">${label}</button>`;
    const sw = (key, title, sub) => `<label class="row">
        <span class="row-body"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span>
        <span class="switch"><input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''}><span></span></span>
      </label>`;
    return `
      <div class="section-header"><span>Appearance</span></div>
      <div class="group seg-row"><div class="segmented" role="group" aria-label="Appearance">${seg('light', 'Light')}${seg('dark', 'Dark')}${seg('system', 'System')}</div></div>
      <div class="section-header"><span>Gameplay</span></div>
      <div class="group">
        ${sw('autoRotate', 'Auto-Rotate Card', 'Flip 180° to face the next player')}
        ${sw('dice', 'Dice Roller', 'Roll and hold dice in the app')}
        ${sw('keepAwake', 'Keep Screen On', 'Stop the screen dimming during a game')}
        ${sw('celebrate', 'Celebrations', 'Confetti for Yahtzees, bonuses and wins')}
        ${sw('sounds', 'Sounds', 'Dice rolls and scoring chimes')}
        ${sw('hint', 'Best-Move Hint', 'Star the strongest box for your roll (dice roller)')}
      </div>
      <div class="section-header"><span>Game</span></div>
      <div class="group">
        <button class="row" data-action="new-game"><span class="row-body" style="color:var(--accent)">New Game…</span></button>
        ${game && !game.finished ? '<button class="row" data-action="rename"><span class="row-body">Rename Players…</span>' + ICON.chev + '</button>' : ''}
        ${NATIVE.gameCenter.available ? '<button class="row" data-action="gc-show"><span class="row-body">Game Center Leaderboard</span>' + ICON.chev + '</button>' : ''}
        <button class="row" data-action="history"><span class="row-body">Scores &amp; History</span><span class="row-value empty">${history.length || ''}</span>${ICON.chev}</button>
      </div>
      <p class="section-footer">Tap a category name to see how it scores. Press and hold any score to change it.</p>
      <p class="section-footer">Standard rules: 35-point bonus at 63 in the upper section, +100 for each extra Yahtzee, and forced Joker rules when using the dice roller.</p>`;
  }
  function openSettings() { openSheet({ title: 'Settings', body: settingsBody(), name: 'settings' }); }

  /* History */
  /* Per-player stats across all finished games (real names only; "Player 2" is skipped). */
  function playerStats() {
    const by = new Map();
    history.forEach((g) => {
      const top = Math.max(...g.players.map((p) => p.total));
      const multi = g.players.length > 1;
      g.players.forEach((p) => {
        const name = String(p.name).trim();
        if (!name || /^player\s*\d+$/i.test(name)) return;
        const key = name.toLowerCase();
        const s = by.get(key) || { name, color: p.color, games: 0, wins: 0, multi: 0, sum: 0, best: 0, yahtzees: 0, bonuses: 0, tracked: 0 };
        s.games++;
        s.sum += p.total;
        s.best = Math.max(s.best, p.total);
        if (multi) { s.multi++; if (p.total === top) s.wins++; }
        if (p.yahtzees !== undefined) { s.tracked++; s.yahtzees += p.yahtzees; if (p.upperBonus) s.bonuses++; }
        s.color = p.color;
        by.set(key, s);
      });
    });
    return [...by.values()].sort((a, b) => b.wins - a.wins || b.sum / b.games - a.sum / a.games);
  }
  function statsHtml() {
    const stats = playerStats();
    if (!stats.length) return '';
    return `<div class="section-header"><span>Players</span></div>
      <div class="group">${stats.map((s) => {
        const avg = Math.round(s.sum / s.games);
        const bits = [`${s.games} game${s.games === 1 ? '' : 's'}`];
        if (s.multi) bits.push(`${s.wins} win${s.wins === 1 ? '' : 's'}`);
        bits.push(`best ${s.best}`);
        if (s.tracked) bits.push(`${s.yahtzees} Yahtzee${s.yahtzees === 1 ? '' : 's'}`);
        if (s.tracked) bits.push(`bonus ${Math.round((s.bonuses / s.tracked) * 100)}%`);
        return `<div class="row stat-row" aria-label="${esc(s.name)}: ${bits.join(', ')}, average ${avg}">
          <span class="avatar${initialOf(s.name).length > 1 ? ' wide' : ''}" style="--chip-color:${s.color};color:${textOn(s.color)}">${esc(initialOf(s.name))}</span>
          <span class="row-body"><span class="row-title">${esc(s.name)}</span><span class="row-sub">${bits.join(' · ')}</span></span>
          <span class="row-value"><span class="stat-avg">${avg}</span><small>avg</small></span>
        </div>`;
      }).join('')}</div>
      <p class="section-footer">Stats are grouped by name. Yahtzee and bonus counts start from games played after this update.</p>`;
  }

  function historyBody() {
    if (!history.length) return '<p class="sheet-lede" style="margin-top:30px">No finished games yet.</p>';
    const scores = [];
    history.forEach((g) => g.players.forEach((p) => scores.push({ name: p.name, total: p.total, color: p.color, date: g.date })));
    scores.sort((a, b) => b.total - a.total);
    const fmt = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const medal = (i) => ['gold', 'silver', 'bronze'][i] || '';
    return `${statsHtml()}
      <div class="section-header"><span>High Scores</span></div>
      <div class="group">${scores.slice(0, 10).map((s, i) => `<div class="row">
        <span class="rank ${medal(i)}">${i + 1}</span>
        <span class="row-body"><span class="row-title">${esc(s.name)}</span><span class="row-sub">${fmt(s.date)}</span></span>
        <span class="row-value">${s.total}</span></div>`).join('')}</div>
      <div class="section-header"><span>Recent Games</span></div>
      <div class="group">${history.slice(0, 25).map((g) => {
        const sorted = g.players.slice().sort((a, b) => b.total - a.total);
        return `<div class="row"><span class="row-body"><span class="row-title">${esc(sorted[0].name)} won${sorted.length === 1 ? '' : ''}</span>
          <span class="row-sub">${sorted.map((p) => `${esc(p.name)} ${p.total}`).join(' · ')}</span></span>
          <span class="row-value empty" style="font-size:13px">${fmt(g.date)}</span></div>`;
      }).join('')}</div>
      <div class="actions"><button class="btn destructive block" data-action="clear-history">Clear History</button></div>`;
  }
  function openHistory(fromSettings) {
    openSheet({
      title: 'Scores & History',
      left: fromSettings ? '<button class="text-btn" data-action="settings">‹ Settings</button>' : '',
      body: historyBody(),
    });
  }

  /* Results */
  function openResults() {
    const ranked = game.players.map((p, i) => ({ p, i, total: S.totals(p).grandTotal })).sort((a, b) => b.total - a.total);
    const top = ranked[0];
    const solo = ranked.length === 1;
    const tie = !solo && ranked[1].total === top.total;
    const margin = solo ? 0 : top.total - ranked[1].total;
    const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)] || 'th');
    const sub = solo
      ? (isHighScore(top.total) ? 'A new personal best!' : 'Game complete')
      : tie ? `${top.total} points each` : `${top.total} points · won by ${margin}`;
    const rows = ranked.map((r) => {
      const place = ranked.findIndex((x) => x.total === r.total) + 1;
      const tied = ranked.filter((x) => x.total === r.total).length > 1;
      const behind = top.total - r.total;
      const label = place === 1 ? (tied ? 'Tied for 1st' : 'Winner') : `${tied ? 'Tied ' : ''}${ord(place)} · ${behind} behind`;
      return `<div class="row standing${place === 1 ? ' first' : ''}">
        <span class="avatar${initialOf(r.p.name).length > 1 ? ' wide' : ''}" style="--chip-color:${r.p.color};color:${textOn(r.p.color)}">${esc(initialOf(r.p.name))}</span>
        <span class="row-body"><span class="row-title">${esc(r.p.name)}</span><span class="row-sub">${label}</span></span>
        <span class="row-value">${r.total}</span>
      </div>`;
    }).join('');
    const body = `
      <div class="podium">
        <div class="trophy">${solo ? '🎲' : '🏆'}</div>
        <h2>${solo ? `${top.total} points` : tie ? "It's a tie!" : `${esc(top.p.name)} wins!`}</h2>
        <p>${sub}</p>
      </div>
      ${solo ? '' : `<div class="group standings">${rows}</div>`}
      <div class="actions">
        <button class="btn block" data-action="rematch">Play Again</button>
        <button class="btn tinted block" data-action="share">${ICON.share} Share Results</button>
        ${NATIVE.gameCenter.available ? '<button class="btn tinted block" data-action="gc-post">Post to Game Center</button>' : ''}
        <button class="text-btn" data-action="new-game">New Players</button>
      </div>`;
    openSheet({ title: 'Game Over', body });
  }
  /* Game Center is one account per phone, so ask which player is the phone's owner. */
  function openGameCenterPost() {
    openSheet({
      title: 'Post to Game Center',
      left: '<button class="text-btn" data-action="close-sheet">Cancel</button>', right: '',
      body: `<p class="sheet-lede">Which player is signed in to Game Center on this iPhone?</p>
        <div class="group">${game.players.map((p, i) => `<button class="row stat-row" data-action="gc-pick" data-p="${i}">
          <span class="avatar${initialOf(p.name).length > 1 ? ' wide' : ''}" style="--chip-color:${p.color};color:${textOn(p.color)}">${esc(initialOf(p.name))}</span>
          <span class="row-body">${esc(p.name)}</span><span class="row-value">${S.totals(p).grandTotal}</span></button>`).join('')}</div>`,
    });
  }

  function isHighScore(total) {
    let best = 0;
    history.forEach((g) => { if (g.id !== game.id) g.players.forEach((p) => { best = Math.max(best, p.total); }); });
    return total > best;
  }

  /* ---------- Effects ---------- */
  function sfx(name, arg) { if (settings.sounds && window.FX) window.FX.sound(name, arg); }
  function celebrate(kind) {
    if (kind === 'win') sfx('win'); else sfx(kind === 'big' ? 'bonus' : 'upper');
    haptic('success');
    if (!settings.celebrate || !window.FX) return;
    if (kind === 'big') window.FX.confetti(stage, { count: 160 });
    else if (kind === 'small') window.FX.confetti(stage, { count: 60, duration: 1700 });
    else window.FX.confetti(stage, { count: 220, y: 0.3, duration: 2800 });
  }
  async function shareResults() {
    if (!game || !window.FX) return;
    const players = game.players.map((p) => ({ name: p.name, total: S.totals(p).grandTotal, color: p.color }));
    const date = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const r = await window.FX.shareResults(players, date);
    if (r === 'downloaded') toast('Results image saved');
    else if (r === 'failed') toast('Couldn’t create image');
  }

  /* Keep the screen on while a game is in progress. */
  let wakeLock = null;
  let wakePending = false;
  let nativeAwake = null;
  async function syncWakeLock() {
    const want = !!(settings.keepAwake && game && !game.finished && document.visibilityState === 'visible');
    if (NATIVE.isNative) {
      if (nativeAwake !== want) { nativeAwake = want; NATIVE.keepAwake(want); }
      return;
    }
    if (wakePending) return;
    try {
      if (want && !wakeLock && navigator.wakeLock) {
        wakePending = true;
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!want && wakeLock) {
        const w = wakeLock;
        wakeLock = null;
        await w.release();
      }
    } catch (e) { /* not supported or not allowed right now */ }
    wakePending = false;
  }
  document.addEventListener('visibilitychange', syncWakeLock);

  /* Press and hold a filled score to edit it. */
  let pressTimer = null;
  let pressFired = false;
  let pressAt = null;
  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
    main.querySelectorAll('.holding').forEach((x) => x.classList.remove('holding'));
  }
  main.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.c.filled');
    pressFired = false;
    if (!cell || busy) return;
    pressAt = [e.clientX, e.clientY];
    cell.classList.add('holding');
    pressTimer = setTimeout(() => {
      pressFired = true;
      cancelPress();
      haptic('heavy');
      openEdit(+cell.dataset.p, cell.dataset.cat);
    }, 480);
  });
  main.addEventListener('pointermove', (e) => {
    if (pressTimer && pressAt && Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 10) cancelPress();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => main.addEventListener(t, cancelPress));
  main.addEventListener('contextmenu', (e) => { if (e.target.closest('.c.filled')) e.preventDefault(); });

  /* ---------- Actions ---------- */
  async function commitScore(cat, value) {
    if (busy || !game || game.finished) return;
    const p = cur();
    if (p.scores[cat] !== null) return;
    busy = true;
    closeSheet();
    pushUndo(`${esc(p.name)}'s ${value} in ${S.LABELS[cat]}`);
    let bonus = false;
    if (settings.dice && game.turn.rolls > 0 && S.earnsYahtzeeBonus(game.turn.dice, p.scores)) {
      p.bonusCount = (p.bonusCount || 0) + 1;
      bonus = true;
    }
    const hadUpperBonus = S.totals(p).upperBonus > 0;
    p.scores[cat] = value;
    justScored = cat;
    save();
    render();
    haptic('medium');
    const yahtzee = bonus || (cat === 'yahtzee' && value === 50);
    const upper = !hadUpperBonus && S.totals(p).upperBonus > 0;
    if (yahtzee) { toast(bonus ? '🎉 Yahtzee Bonus +100' : '🎉 Yahtzee! +50', 1500); celebrate('big'); }
    else if (upper) { toast('⭐️ Upper bonus +35', 1500); celebrate('small'); }
    else sfx('score');
    await wait(yahtzee || upper ? 750 : 320);
    justScored = null;

    if (game.players.every(isDone)) {
      finishGame();
      busy = false;
      return;
    }
    const scorer = game.current;
    game.current = (game.current + 1) % game.players.length;
    game.turn = freshTurn();
    save();
    await turnTransition(1);
    busy = false;
    render();
    maybeTips({ p: scorer, cat });
  }

  function finishGame() {
    game.finished = true;
    history = history.filter((g) => g.id !== game.id);
    history.unshift({ id: game.id, date: Date.now(), players: historyPlayers() });
    history = history.slice(0, 200);
    save();
    turnTransition(1).then(() => { openResults(); celebrate('win'); });
  }

  async function undo() {
    if (busy || !undoStack.length) return;
    busy = true;
    closeSheet();
    const { game: prev, desc } = readUndo(undoStack.pop());
    if (game.finished && !prev.finished) history = history.filter((g) => g.id !== game.id);
    const changedPlayer = prev.current !== game.current || prev.finished !== game.finished;
    game = prev;
    save();
    if (changedPlayer) await turnTransition(-1); else render();
    busy = false;
    render();
    toast(desc ? `Undid ${desc}` : 'Undone', 1800);
  }

  function roll() {
    const turn = game.turn;
    if (turn.rolls >= 3 || busy) return;
    const rnd = new Uint32Array(5);
    (window.crypto || window.msCrypto).getRandomValues(rnd);
    const rollingIdx = [];
    turn.dice = turn.dice.map((v, i) => {
      if (turn.rolls > 0 && turn.held[i]) return v;
      rollingIdx.push(i);
      return (rnd[i] % 6) + 1;
    });
    if (turn.rolls === 0) turn.held = [false, false, false, false, false];
    turn.rolls++;
    save();
    render();
    haptic('medium');
    sfx('roll', rollingIdx.length);
    if (S.isYahtzee(turn.dice)) toast(S.earnsYahtzeeBonus(turn.dice, cur().scores) ? '🎲 Yahtzee! +100 bonus' : '🎲 Yahtzee!', 1800);
    if (reducedMotion.matches) return;
    const els = main.querySelectorAll('.die');
    rollingIdx.forEach((i) => els[i] && els[i].classList.add('rolling'));
    let ticks = 0;
    const iv = setInterval(() => {
      ticks++;
      rollingIdx.forEach((i) => { if (els[i]) els[i].innerHTML = dieFace(1 + Math.floor(Math.random() * 6)); });
      if (ticks >= 5) {
        clearInterval(iv);
        rollingIdx.forEach((i) => { if (els[i]) els[i].innerHTML = dieFace(turn.dice[i]); });
      }
    }, 70);
  }

  function onScoreTap(cat) {
    const p = cur();
    if (settings.dice && game.turn.rolls > 0) {
      if (!S.allowedCategories(game.turn.dice, p.scores).includes(cat)) return;
      commitScore(cat, S.scoreFor(cat, game.turn.dice, p.scores));
    } else {
      openPicker(cat);
    }
  }

  async function flip() {
    if (busy) return;
    busy = true;
    settings.flip = norm((settings.flip || 0) + 180);
    save();
    await turnTransition(1);
    busy = false;
    render();
  }

  function onAction(el, e) {
    const a = el.dataset.action;
    switch (a) {
      case 'close-sheet': closeSheet(); break;
      case 'info': openInfo(el.dataset.cat, el); break;
      case 'pace': openPace(+el.dataset.p, el); break;
      case 'rename': if (!busy && game) openRename(el.dataset.p === undefined ? null : +el.dataset.p); break;
      case 'rename-save': saveRename(); break;
      case 'settings': openSettings(); break;
      case 'history': openHistory(sheetState && sheetState.name === 'settings'); break;
      case 'new-game': openNewGame(); break;
      case 'undo': undo(); break;
      case 'flip': flip(); break;
      case 'roll': roll(); break;
      case 'hold': {
        if (busy || game.turn.rolls === 0) return;
        const i = +el.dataset.i;
        game.turn.held[i] = !game.turn.held[i];
        haptic('light');
        sfx('hold');
        save();
        el.classList.toggle('held', game.turn.held[i]);
        break;
      }
      case 'score': if (!busy) onScoreTap(el.dataset.cat); break;
      case 'pick':
        if (sheetState && sheetState.edit) applyEdit(sheetState.edit.pi, sheetState.cat, +el.dataset.v);
        else if (sheetState && sheetState.cat) commitScore(sheetState.cat, +el.dataset.v);
        break;
      case 'share': shareResults(); break;
      case 'gc-show': NATIVE.gameCenter.show().catch((err) => toast(esc(err.message || 'Game Center unavailable'))); break;
      case 'gc-post': openGameCenterPost(); break;
      case 'gc-pick': {
        const p = game.players[+el.dataset.p];
        closeSheet();
        NATIVE.gameCenter.submit(S.totals(p).grandTotal)
          .then(() => toast(`Posted ${esc(p.name)}'s ${S.totals(p).grandTotal} to Game Center`))
          .catch((err) => toast(esc(err.message || 'Couldn’t reach Game Center')));
        break;
      }
      case 'bonus': if (!busy && game && !game.finished) openBonus(); break;
      case 'bonus-step': if (sheetState && sheetState.step) sheetState.step(+el.dataset.d); break;
      case 'bonus-save': if (sheetState && sheetState.saveBonus) sheetState.saveBonus(); break;
      case 'results': openResults(); break;
      case 'rematch': {
        const players = game.players.map((p) => ({ name: p.name, seat: p.seat }));
        closeSheet();
        createGame(players);
        turnTransition(1);
        break;
      }
      case 'theme': {
        settings.theme = el.dataset.v;
        applyTheme();
        save();
        sheet.querySelectorAll('[data-action="theme"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === settings.theme)));
        break;
      }
      case 'clear-history': {
        if (!window.confirm('Clear all game history and high scores?')) return;
        history = [];
        save();
        refreshSheetBody(historyBody());
        break;
      }
      case 'np-add': syncDraft(); sheetState.draft.push({ name: '', seat: sheetState.draft.length % 2 ? 180 : 0 }); sheetState.redraw(); {
        const inputs = sheet.querySelectorAll('input[data-np]');
        if (inputs.length) inputs[inputs.length - 1].focus();
      } break;
      case 'np-remove': syncDraft(); sheetState.draft.splice(+el.dataset.i, 1); sheetState.redraw(); break;
      case 'np-seat': syncDraft(); { const d = sheetState.draft[+el.dataset.i]; d.seat = d.seat ? 0 : 180; } sheetState.redraw(); break;
      case 'np-start': {
        syncDraft();
        const players = sheetState.draft;
        closeSheet();
        createGame(players);
        busy = true;
        turnTransition(1).then(() => {
          busy = false;
          render();
          maybeTips(null);
        });
        break;
      }
      default: return;
    }
    if (e) e.preventDefault();
  }

  function syncDraft() {
    if (!sheetState || !sheetState.draft) return;
    sheet.querySelectorAll('input[data-np]').forEach((inp) => { sheetState.draft[+inp.dataset.np].name = inp.value; });
  }

  /* ---------- Events ---------- */
  stage.addEventListener('click', (e) => {
    if (pressFired) { pressFired = false; e.preventDefault(); return; }
    if (tipEl) dismissTip();
    if (!wakeLock) syncWakeLock();
    const el = e.target.closest('[data-action]');
    if (infoOpen && !(el && (el.dataset.action === 'info' || el.dataset.action === 'pace')) && !e.target.closest('.pop')) {
      main.querySelectorAll('.label.pressed').forEach((x) => x.classList.remove('pressed'));
      closeInfo();
      return; // a tap outside only dismisses the popover
    }
    if (el && stage.contains(el) && !el.disabled) onAction(el, e);
  });
  stage.addEventListener('change', (e) => {
    const key = e.target.dataset && e.target.dataset.setting;
    if (!key) return;
    settings[key] = e.target.checked;
    save();
    if (key === 'autoRotate') {
      if (!settings.autoRotate) settings.flip = 0;
      save();
      if (game) { busy = true; turnTransition(-1).then(() => { busy = false; render(); }); }
    } else if (key === 'keepAwake') { syncWakeLock(); render(); }
    else if (key === 'sounds' && settings.sounds) { sfx('score'); render(); }
    else render();
  });
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[data-np]')) e.target.blur();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeInfo(); closeSheet(); } });
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitBoard, 80); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ---------- Boot ---------- */
  if (game && (!game.players || !game.players.length)) game = null;
  applyTheme();
  setAngleImmediately();
  render();
  if (!game) setTimeout(openNewGame, 350);
  else if (game.finished) setTimeout(openResults, 300);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  // Exposed for automated tests.
  window.__yahtzee = { get game() { return game; }, get settings() { return settings; }, commitScore, render };
})();
