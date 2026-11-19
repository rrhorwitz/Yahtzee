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

  let settings = Object.assign({ theme: 'system', autoRotate: true, dice: false, flip: 0, keepAwake: true, sounds: false, celebrate: true }, store.get(KEYS.settings, {}));
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const haptic = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { /* ignore */ } };

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

  const PIPS = { TL: [28, 28], TR: [72, 28], ML: [28, 50], C: [50, 50], MR: [72, 50], BL: [28, 72], BR: [72, 72] };
  const FACE = { 1: ['C'], 2: ['TR', 'BL'], 3: ['TR', 'C', 'BL'], 4: ['TL', 'TR', 'BL', 'BR'], 5: ['TL', 'TR', 'C', 'BL', 'BR'], 6: ['TL', 'TR', 'ML', 'MR', 'BL', 'BR'] };
  function pips(n, color, r) {
    return FACE[n].map((k) => `<circle cx="${PIPS[k][0]}" cy="${PIPS[k][1]}" r="${r}" fill="${color}"/>`).join('');
  }
  const dieFace = (n) => `<svg viewBox="0 0 100 100">${pips(n, 'var(--pip)', 9)}</svg>`;

  const LOWER_TILE = {
    threeKind: ['#FF9500', '3×'], fourKind: ['#FF3B30', '4×'], fullHouse: ['#34C759', 'FH'],
    smallStraight: ['#5AC8FA', 'SS'], largeStraight: ['#5856D6', 'LS'], yahtzee: ['#FF2D55', 'Y'], chance: ['#8E8E93', '?'],
  };
  function tile(cat) {
    const ui = S.UPPER.indexOf(cat);
    if (ui >= 0) {
      return `<svg viewBox="0 0 100 100" width="28" height="28"><rect width="100" height="100" rx="23" fill="#007AFF"/>${pips(ui + 1, '#fff', 8.5)}</svg>`;
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

  function pushUndo() {
    undoStack.push(JSON.stringify(game));
    if (undoStack.length > 80) undoStack.shift();
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
    const diceLive = settings.dice && !game.finished && turn.rolls > 0;
    const allowed = diceLive ? S.allowedCategories(turn.dice, me.scores) : null;
    const totals = players.map((p) => S.totals(p));
    const isCur = (i) => i === game.current && !game.finished;
    const colStyle = (i) => (isCur(i) ? ` style="--pc:${players[i].color}"` : '');
    const curCls = (i) => (isCur(i) ? ' cur' : '');

    let h = '<div class="c corner"></div>';
    h += players.map((p, i) => `<div class="c head${curCls(i)}"${colStyle(i)} title="${esc(p.name)}" aria-label="${esc(p.name)}">
      <span class="avatar" style="--chip-color:${p.color}">${esc(p.name.charAt(0).toUpperCase() || '?')}</span></div>`).join('');

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
              inner = `<span class="pv${s ? '' : ' z'}">${s}</span>`;
              act = true;
            } else cls.push('locked');
          } else { act = true; cls.push('open'); }
        }
        r += act
          ? `<button class="${cls.join(' ')}"${colStyle(i)} data-action="score" data-cat="${cat}" aria-label="Score ${S.LABELS[cat]}">${inner}</button>`
          : `<div class="${cls.join(' ')}"${colStyle(i)}${v !== null ? ` data-p="${i}" data-cat="${cat}"` : ''}>${inner}</div>`;
      });
      return r;
    };

    S.UPPER.forEach((c) => { h += catRow(c); });

    h += `<button class="c label sum" data-action="info" data-cat="upperBonus" aria-label="How the upper bonus works"><span class="lbl"><span class="lbl-f">Bonus <small>63+</small></span><span class="lbl-s">Bonus</span></span></button>`;
    h += players.map((p, i) => {
      const t = totals[i];
      return `<div class="c val sum${curCls(i)}${t.upperBonus ? ' earned' : ''}"${colStyle(i)}>${t.upperBonus
        ? `+${t.upperBonus}` : `<span class="frac">${t.upperSum}<small>/63</small></span>`}</div>`;
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
    h += players.map((p, i) => `<div class="c val total${curCls(i)}${game.finished && n > 1 && totals[i].grandTotal === best ? ' winner' : ''}"${colStyle(i)}>${totals[i].grandTotal}</div>`).join('');

    main.innerHTML = (settings.dice && !game.finished ? renderTray() : '')
      + `<div class="board" style="--cols:${n}">${h}</div>`;
    infoOpen = null;
    fitBoard();
  }

  const SHORT = { threeKind: '3 Kind', fourKind: '4 Kind', fullHouse: 'F. House', smallStraight: 'Sm. Str.', largeStraight: 'Lg. Str.' };

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
    upperBonus: { title: 'Upper Bonus', rule: 'Score 63 or more across Aces through Sixes. That’s three of each number.', fixed: 35, plus: true },
    yahtzeeBonus: { title: 'Yahtzee Bonus', rule: 'Each extra Yahtzee after scoring 50 in the Yahtzee box. You still fill another box with it (Joker rules).', fixed: 100, plus: true },
  };
  let infoOpen = null;

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

    // Position in the stage's own (unrotated) coordinates so it works when flipped.
    const top = anchor.offsetTop;
    const h = anchor.offsetHeight;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.max(8, Math.min(anchor.offsetLeft + 6, main.clientWidth - pw - 8));
    const below = top + h + ph + 10 <= main.clientHeight;
    pop.style.left = left + 'px';
    pop.style.top = (below ? top + h + 6 : top - ph - 6) + 'px';
    pop.classList.add(below ? 'below' : 'above');
    const arrowX = Math.min(Math.max(anchor.offsetLeft + 28 - left, 18), pw - 18);
    pop.style.setProperty('--ax', arrowX + 'px');
    anchor.classList.add('pressed');
    pop._anchor = anchor;
    requestAnimationFrame(() => pop.classList.add('show'));
    infoOpen = cat;
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
    pushUndo();
    const before = S.totals(p).upperBonus;
    p.scores[cat] = v;
    if (game.finished) {
      const rec = history.find((g) => g.id === game.id);
      if (rec) rec.players = game.players.map((x) => ({ name: x.name, total: S.totals(x).grandTotal, color: x.color }));
    }
    save();
    render();
    toast(`${esc(p.name)}'s ${S.LABELS[cat]} changed to ${v}`);
    if (!before && S.totals(p).upperBonus) celebrate('small');
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
        if (count !== (p.bonusCount || 0)) { pushUndo(); p.bonusCount = count; save(); render(); }
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
          <span class="avatar" style="--chip-color:${COLORS[i % COLORS.length]}">${i + 1}</span>
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
      </div>
      <div class="section-header"><span>Game</span></div>
      <div class="group">
        <button class="row" data-action="new-game"><span class="row-body" style="color:var(--accent)">New Game…</span></button>
        <button class="row" data-action="history"><span class="row-body">Scores &amp; History</span><span class="row-value empty">${history.length || ''}</span>${ICON.chev}</button>
      </div>
      <p class="section-footer">Tap a category name to see how it scores. Press and hold any score to change it.</p>
      <p class="section-footer">Standard rules: 35-point bonus at 63 in the upper section, +100 for each extra Yahtzee, and forced Joker rules when using the dice roller.</p>`;
  }
  function openSettings() { openSheet({ title: 'Settings', body: settingsBody(), name: 'settings' }); }

  /* History */
  function historyBody() {
    if (!history.length) return '<p class="sheet-lede" style="margin-top:30px">No finished games yet.</p>';
    const scores = [];
    history.forEach((g) => g.players.forEach((p) => scores.push({ name: p.name, total: p.total, color: p.color, date: g.date })));
    scores.sort((a, b) => b.total - a.total);
    const fmt = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const medal = (i) => ['gold', 'silver', 'bronze'][i] || '';
    return `
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
    const tie = ranked.length > 1 && ranked[1].total === top.total;
    const medal = (i) => ['gold', 'silver', 'bronze'][i] || '';
    const solo = ranked.length === 1;
    const body = `
      <div class="podium">
        <div class="trophy">${solo ? '🎲' : '🏆'}</div>
        <h2>${solo ? `${top.total} points` : tie ? "It's a tie!" : `${esc(top.p.name)} wins!`}</h2>
        <p>${solo ? (isHighScore(top.total) ? 'A new personal best!' : 'Game complete') : `${top.total} points`}</p>
      </div>
      ${solo ? '' : `<div class="section-header"><span>Standings</span></div>
      <div class="group">${ranked.map((r, k) => { const place = ranked.findIndex((x) => x.total === r.total); return `<button class="row" data-action="view-final" data-p="${r.i}">
        <span class="rank ${medal(place)}">${place + 1}</span>
        <span class="avatar" style="--chip-color:${r.p.color}">${esc(r.p.name.charAt(0).toUpperCase())}</span>
        <span class="row-body">${esc(r.p.name)}</span>
        <span class="row-value">${r.total}</span>${ICON.chev}</button>`; }).join('')}</div>`}
      <div class="actions">
        <button class="btn block" data-action="rematch">Play Again</button>
        <button class="btn tinted block" data-action="share">${ICON.share} Share Results</button>
        <button class="text-btn" data-action="new-game">New Players</button>
      </div>`;
    openSheet({ title: 'Game Over', body });
  }
  function isHighScore(total) {
    let best = 0;
    history.forEach((g) => { if (g.id !== game.id) g.players.forEach((p) => { best = Math.max(best, p.total); }); });
    return total > best;
  }

  /* ---------- Effects ---------- */
  function sfx(name) { if (settings.sounds && window.FX) window.FX.sound(name); }
  function celebrate(kind) {
    if (kind === 'win') sfx('win'); else sfx(kind === 'big' ? 'bonus' : 'score');
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
  async function syncWakeLock() {
    const want = !!(settings.keepAwake && game && !game.finished && document.visibilityState === 'visible');
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
      haptic(15);
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
    pushUndo();
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
    haptic(12);
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
    game.current = (game.current + 1) % game.players.length;
    game.turn = freshTurn();
    save();
    await turnTransition(1);
    busy = false;
    render();
  }

  function finishGame() {
    game.finished = true;
    history = history.filter((g) => g.id !== game.id);
    history.unshift({
      id: game.id,
      date: Date.now(),
      players: game.players.map((p) => ({ name: p.name, total: S.totals(p).grandTotal, color: p.color })),
    });
    history = history.slice(0, 200);
    save();
    turnTransition(1).then(() => { openResults(); celebrate('win'); });
  }

  async function undo() {
    if (busy || !undoStack.length) return;
    busy = true;
    closeSheet();
    const prev = JSON.parse(undoStack.pop());
    if (game.finished && !prev.finished) history = history.filter((g) => g.id !== game.id);
    const changedPlayer = prev.current !== game.current || prev.finished !== game.finished;
    game = prev;
    save();
    if (changedPlayer) await turnTransition(-1); else render();
    busy = false;
    render();
    toast('Undone');
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
    haptic(15);
    sfx('roll');
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
        haptic(5);
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
      case 'bonus': if (!busy && game && !game.finished) openBonus(); break;
      case 'bonus-step': if (sheetState && sheetState.step) sheetState.step(+el.dataset.d); break;
      case 'bonus-save': if (sheetState && sheetState.saveBonus) sheetState.saveBonus(); break;
      case 'view-final': closeSheet(); break;
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
    if (!wakeLock) syncWakeLock();
    const el = e.target.closest('[data-action]');
    if (infoOpen && !(el && el.dataset.action === 'info') && !e.target.closest('.pop')) {
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
