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

  let settings = Object.assign({ theme: 'system', autoRotate: true, dice: false, flip: 0 }, store.get(KEYS.settings, {}));
  let game = store.get(KEYS.game, null);
  let undoStack = store.get(KEYS.undo, []);
  let history = store.get(KEYS.history, []);

  let viewing = null;     // index of a player whose card is being peeked at
  let justScored = null;  // category to flash
  let busy = false;       // true during turn transitions
  let angle = 0;          // cumulative stage rotation (deg)
  let sheetState = null;

  /* ---------- DOM ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const stage = $('#stage');
  const scroller = $('#scroller');
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
  const shownIndex = () => (viewing !== null ? viewing : game.current);

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
    viewing = null;
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
    let a = settings.flip || 0;
    if (game && settings.autoRotate && game.players.length > 1 && !game.finished) a += cur().seat || 0;
    return ((a % 360) + 360) % 360;
  }
  const norm = (a) => ((a % 360) + 360) % 360;

  function setAngleImmediately() {
    angle = targetAngle();
    stage.style.transform = `rotate(${angle}deg)`;
  }

  async function turnTransition(direction) {
    const target = targetAngle();
    if (target === norm(angle)) {
      render();
      scroller.scrollTop = 0;
      if (!reducedMotion.matches) {
        main.animate(
          [{ opacity: 0, transform: `translateX(${direction === -1 ? -24 : 24}px)` }, { opacity: 1, transform: 'none' }],
          { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
      }
      return;
    }
    const from = angle;
    const to = angle + (direction === -1 ? -180 : 180);
    angle = to;
    stage.style.transform = `rotate(${to}deg)`;
    if (reducedMotion.matches) { render(); scroller.scrollTop = 0; return; }
    stage.classList.add('spinning');
    const mid = (from + to) / 2;
    const anim = stage.animate([
      { transform: `rotate(${from}deg) scale(1)`, borderRadius: '0px' },
      { transform: `rotate(${mid}deg) scale(0.78)`, borderRadius: '44px', offset: 0.5 },
      { transform: `rotate(${to}deg) scale(1)`, borderRadius: '0px' },
    ], { duration: 900, easing: 'cubic-bezier(.65,0,.35,1)' });
    setTimeout(() => { render(); scroller.scrollTop = 0; }, 450);
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
    if (!game) { renderEmpty(); return; }
    renderNav();
    renderMain();
  }

  function renderEmpty() {
    nav.innerHTML = `<div class="nav-inner"><div class="nav-bar"><span></span><div class="nav-actions">
      <button class="icon-btn" data-action="settings" aria-label="Settings">${ICON.more}</button></div></div></div>`;
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
    const filled = S.totals(p).filled;
    const round = Math.min(filled + 1, 13);
    const titleName = game.finished ? 'Final Scores' : esc(p.name);
    const eyebrow = game.finished ? `${game.players.length === 1 ? 'Solo game' : game.players.length + ' players'}` : `Round ${round} of 13`;
    const chips = game.players.map((pl, i) => {
      const t = S.totals(pl);
      const cls = ['player-chip'];
      if (i === game.current && !game.finished) cls.push('current');
      if (viewing === i) cls.push('viewing');
      return `<button class="${cls.join(' ')}" style="--chip-color:${pl.color}" data-action="view" data-p="${i}" aria-label="${esc(pl.name)}, ${t.grandTotal} points">
        <span class="avatar">${esc(pl.name.charAt(0).toUpperCase() || '?')}</span>
        <span class="chip-text"><span class="chip-name">${esc(pl.name)}</span><span class="chip-score">${t.grandTotal} pts</span></span>
      </button>`;
    }).join('');
    nav.innerHTML = `<div class="nav-inner">
      <div class="nav-bar">
        <button class="text-btn" data-action="new-game">New Game</button>
        <div class="nav-actions">
          <button class="icon-btn" data-action="undo" aria-label="Undo" ${undoStack.length ? '' : 'disabled'}>${ICON.undo}</button>
          <button class="icon-btn" data-action="flip" aria-label="Flip card">${ICON.flip}</button>
          <button class="icon-btn" data-action="settings" aria-label="Settings">${ICON.more}</button>
        </div>
      </div>
      <div class="title-wrap">
        <div class="eyebrow">${eyebrow}</div>
        <h1 class="large-title">${game.finished ? '' : `<span class="dot" style="background:${p.color}"></span>`}${titleName}</h1>
      </div>
      ${game.players.length > 1 || game.finished ? `<div class="players">${chips}</div>` : ''}
    </div>`;
  }

  function renderMain() {
    const idx = shownIndex();
    const p = game.players[idx];
    const peeking = idx !== game.current || game.finished;
    const t = S.totals(p);
    const turn = game.turn;
    const diceLive = settings.dice && !peeking && turn.rolls > 0;
    const allowed = diceLive ? S.allowedCategories(turn.dice, p.scores) : null;
    let html = '';

    if (peeking && !game.finished) {
      html += `<div class="banner"><span>Viewing ${esc(p.name)}'s card</span><button data-action="stop-view">Back to ${esc(cur().name)}</button></div>`;
    } else if (game.finished && game.players.length > 1) {
      html += `<div class="banner"><span>${esc(p.name)}'s card</span><button data-action="results">Results</button></div>`;
    }

    if (settings.dice && !peeking) html += renderTray();

    const row = (cat) => {
      const v = p.scores[cat];
      const cls = ['row', 'has-icon'];
      let value;
      let interactive = !peeking && v === null && !busy;
      if (v !== null) {
        value = v === 0 ? '<span class="row-value scratched">0</span>' : `<span class="row-value">${v}</span>`;
      } else if (diceLive) {
        const ok = allowed.includes(cat);
        const s = S.scoreFor(cat, turn.dice, p.scores);
        if (!ok) { cls.push('locked'); interactive = false; }
        value = `<span class="row-value preview ${s === 0 ? 'zero' : ''}">${s}</span>`;
      } else {
        value = peeking ? '<span class="row-value empty">—</span>' : `<span class="row-value empty"></span>${ICON.chev}`;
      }
      if (justScored === cat && idx === game.current) cls.push('just-scored');
      if (!interactive) cls.push('disabled');
      const tag = interactive ? 'button' : 'div';
      return `<${tag} class="${cls.join(' ')}" ${interactive ? `data-action="score" data-cat="${cat}"` : ''}>
        <span class="row-icon">${tile(cat)}</span>
        <span class="row-body"><span class="row-title">${S.LABELS[cat]}</span>${!peeking && v === null && !diceLive ? `<span class="row-sub">${S.HINTS[cat]}</span>` : ''}</span>
        ${value}
      </${tag}>`;
    };

    // Upper
    const pct = Math.min(100, Math.round((t.upperSum / S.UPPER_BONUS_THRESHOLD) * 100));
    const toGo = S.UPPER_BONUS_THRESHOLD - t.upperSum;
    html += `<div class="section-header"><span>Upper Section</span><span class="tabular">${t.upperSum} / ${S.UPPER_BONUS_THRESHOLD}</span></div>`;
    html += `<div class="group">${S.UPPER.map(row).join('')}
      <div class="row">
        <span class="row-body"><span class="row-title">Bonus</span>
          <span class="row-sub">${t.upperBonus ? 'Earned — nice work' : `${toGo} more for +${S.UPPER_BONUS}`}</span>
          <div class="progress ${t.upperBonus ? 'done' : ''}"><i style="width:${pct}%"></i></div>
        </span>
        <span class="row-value ${t.upperBonus ? '' : 'empty'}">${t.upperBonus ? '+' + t.upperBonus : '+35'}</span>
      </div></div>`;

    // Lower
    html += `<div class="section-header"><span>Lower Section</span><span class="tabular">${t.lowerSum}</span></div>`;
    const bonusTap = !peeking && !busy;
    html += `<div class="group">${S.LOWER.map(row).join('')}
      <${bonusTap ? 'button' : 'div'} class="row ${p.scores.yahtzee === 50 || p.bonusCount ? '' : 'subtle'} ${bonusTap ? '' : 'disabled'}" ${bonusTap ? 'data-action="bonus"' : ''}>
        <span class="row-body"><span class="row-title">Yahtzee Bonus</span><span class="row-sub">+${S.YAHTZEE_BONUS} for each extra Yahtzee</span></span>
        <span class="row-value ${p.bonusCount ? '' : 'empty'}">${p.bonusCount ? '+' + t.yahtzeeBonus : '—'}</span>
        ${bonusTap ? ICON.chev : ''}
      </${bonusTap ? 'button' : 'div'}></div>`;

    // Totals
    html += `<div class="section-header"><span>Totals</span></div>
      <div class="group">
        <div class="row"><span class="row-body">Upper total</span><span class="row-value">${t.upperTotal}</span></div>
        <div class="row"><span class="row-body">Lower total</span><span class="row-value">${t.lowerTotal}</span></div>
      </div>
      <div class="grand"><span class="grand-label">Grand Total</span><span class="grand-value">${t.grandTotal}</span></div>`;

    main.innerHTML = html;
  }

  function renderTray() {
    const turn = game.turn;
    const rolled = turn.rolls > 0;
    const dice = turn.dice.map((v, i) => {
      const held = rolled && turn.held[i];
      return `<button class="die ${rolled ? '' : 'blank'} ${held ? 'held' : ''}" data-action="hold" data-i="${i}" aria-label="${rolled ? `Die ${i + 1}: ${v}${held ? ', held' : ''}` : 'Die not rolled'}" ${rolled ? '' : 'disabled'}>${rolled ? dieFace(v) : ''}</button>`;
    }).join('');
    let hint = 'Roll to start your turn';
    if (turn.rolls === 3) hint = 'Pick a box to score';
    else if (rolled) hint = 'Tap dice to hold';
    if (rolled && S.isYahtzee(turn.dice)) hint = S.earnsYahtzeeBonus(turn.dice, cur().scores) ? 'Yahtzee! +100 bonus' : 'Yahtzee!';
    const left = [0, 1, 2].map((i) => `<i class="${i < turn.rolls ? 'used' : ''}"></i>`).join('');
    return `<div class="tray" id="tray">
      <div class="dice">${dice}</div>
      <div class="tray-foot">
        <div><div class="pips-left" aria-hidden="true">${left}</div><div class="tray-hint" style="margin-top:6px">${hint}</div></div>
        <button class="btn small" data-action="roll" ${turn.rolls >= 3 || busy ? 'disabled' : ''}>${turn.rolls === 0 ? 'Roll' : 'Roll Again'}</button>
      </div>
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
  function openPicker(cat) {
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
    openSheet({
      title: S.LABELS[cat], compact: false,
      left: '<button class="text-btn" data-action="close-sheet">Cancel</button>', right: '',
      body, cat,
    });
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
      </div>
      <div class="section-header"><span>Game</span></div>
      <div class="group">
        <button class="row" data-action="new-game"><span class="row-body" style="color:var(--accent)">New Game…</span></button>
        <button class="row" data-action="history"><span class="row-body">Scores &amp; History</span><span class="row-value empty">${history.length || ''}</span>${ICON.chev}</button>
      </div>
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
        <button class="btn tinted block" data-action="new-game">New Players</button>
      </div>`;
    openSheet({ title: 'Game Over', body });
  }
  function isHighScore(total) {
    let best = 0;
    history.forEach((g) => { if (g.id !== game.id) g.players.forEach((p) => { best = Math.max(best, p.total); }); });
    return total > best;
  }

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
    p.scores[cat] = value;
    viewing = null;
    justScored = cat;
    save();
    render();
    haptic(12);
    if (bonus) toast('🎉 Yahtzee Bonus +100', 1400);
    await wait(bonus ? 900 : 560);
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
    if (game.players.length > 1) {
      toast(`<span class="dot" style="background:${cur().color}"></span>${esc(cur().name)}'s turn`);
    }
  }

  function finishGame() {
    game.finished = true;
    viewing = null;
    history = history.filter((g) => g.id !== game.id);
    history.unshift({
      id: game.id,
      date: Date.now(),
      players: game.players.map((p) => ({ name: p.name, total: S.totals(p).grandTotal, color: p.color })),
    });
    history = history.slice(0, 200);
    save();
    turnTransition(1).then(() => openResults());
  }

  async function undo() {
    if (busy || !undoStack.length) return;
    busy = true;
    closeSheet();
    const prev = JSON.parse(undoStack.pop());
    if (game.finished && !prev.finished) history = history.filter((g) => g.id !== game.id);
    const changedPlayer = prev.current !== game.current || prev.finished !== game.finished;
    game = prev;
    viewing = null;
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
        save();
        el.classList.toggle('held', game.turn.held[i]);
        break;
      }
      case 'score': if (!busy) onScoreTap(el.dataset.cat); break;
      case 'pick': if (sheetState && sheetState.cat) commitScore(sheetState.cat, +el.dataset.v); break;
      case 'bonus': if (!busy && game && !game.finished) openBonus(); break;
      case 'bonus-step': if (sheetState && sheetState.step) sheetState.step(+el.dataset.d); break;
      case 'bonus-save': if (sheetState && sheetState.saveBonus) sheetState.saveBonus(); break;
      case 'view': {
        if (busy) return;
        const i = +el.dataset.p;
        viewing = (game.finished ? i : (i === game.current || viewing === i ? null : i));
        render();
        break;
      }
      case 'view-final': viewing = +el.dataset.p; closeSheet(); render(); scroller.scrollTop = 0; break;
      case 'stop-view': viewing = null; render(); break;
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
          if (game.players.length > 1) toast(`<span class="dot" style="background:${cur().color}"></span>${esc(cur().name)} goes first`);
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
    const el = e.target.closest('[data-action]');
    if (el && stage.contains(el) && !el.disabled) onAction(el, e);
  });
  stage.addEventListener('change', (e) => {
    const key = e.target.dataset && e.target.dataset.setting;
    if (!key) return;
    settings[key] = e.target.checked;
    save();
    if (key === 'autoRotate' && game) { busy = true; turnTransition(1).then(() => { busy = false; render(); }); } else render();
  });
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[data-np]')) e.target.blur();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  scroller.addEventListener('scroll', () => {
    const y = scroller.scrollTop;
    nav.classList.toggle('scrolled', y > 4);
    if (y > 80) nav.classList.add('compact'); else if (y < 12) nav.classList.remove('compact');
  }, { passive: true });
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
