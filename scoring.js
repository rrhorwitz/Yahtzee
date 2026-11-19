/* Yahtzee scoring rules — standard rules incl. Yahtzee bonus and Joker rules.
   Works in the browser (window.Scoring) and in Node (module.exports). */
(function (root) {
  'use strict';

  const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
  const LOWER = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];
  const ALL = UPPER.concat(LOWER);

  const LABELS = {
    ones: 'Aces', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
    threeKind: '3 of a Kind', fourKind: '4 of a Kind', fullHouse: 'Full House',
    smallStraight: 'Sm. Straight', largeStraight: 'Lg. Straight', yahtzee: 'Yahtzee', chance: 'Chance',
  };

  const HINTS = {
    ones: 'Count and add only aces', twos: 'Count and add only twos', threes: 'Count and add only threes',
    fours: 'Count and add only fours', fives: 'Count and add only fives', sixes: 'Count and add only sixes',
    threeKind: 'Add total of all dice', fourKind: 'Add total of all dice', fullHouse: 'Three of one, two of another',
    smallStraight: 'Sequence of four', largeStraight: 'Sequence of five', yahtzee: 'Five of a kind',
    chance: 'Add total of all dice',
  };

  const FIXED = { fullHouse: 25, smallStraight: 30, largeStraight: 40, yahtzee: 50 };
  const UPPER_BONUS_THRESHOLD = 63;
  const UPPER_BONUS = 35;
  const YAHTZEE_BONUS = 100;

  function counts(dice) {
    const c = [0, 0, 0, 0, 0, 0, 0];
    dice.forEach((v) => { c[v]++; });
    return c;
  }
  const sum = (dice) => dice.reduce((a, b) => a + b, 0);
  const isYahtzee = (dice) => dice.length === 5 && dice.every((v) => v === dice[0]);

  function hasRun(c, len) {
    let run = 0;
    for (let f = 1; f <= 6; f++) {
      run = c[f] ? run + 1 : 0;
      if (run >= len) return true;
    }
    return false;
  }

  /** Score for a category from dice, ignoring Joker rules. */
  function rawScore(cat, dice) {
    const c = counts(dice);
    const upperIdx = UPPER.indexOf(cat);
    if (upperIdx >= 0) return c[upperIdx + 1] * (upperIdx + 1);
    switch (cat) {
      case 'threeKind': return c.some((n) => n >= 3) ? sum(dice) : 0;
      case 'fourKind': return c.some((n) => n >= 4) ? sum(dice) : 0;
      case 'fullHouse': return c.includes(3) && c.includes(2) ? 25 : 0;
      case 'smallStraight': return hasRun(c, 4) ? 30 : 0;
      case 'largeStraight': return hasRun(c, 5) ? 40 : 0;
      case 'yahtzee': return isYahtzee(dice) ? 50 : 0;
      case 'chance': return sum(dice);
      default: throw new Error('Unknown category: ' + cat);
    }
  }

  /** Joker rules apply when a Yahtzee is rolled and the Yahtzee box is already filled (50 or 0). */
  function jokerActive(dice, scores) {
    return isYahtzee(dice) && scores.yahtzee !== null && scores.yahtzee !== undefined;
  }

  /** Score for a category from dice, applying Joker rules. */
  function scoreFor(cat, dice, scores) {
    if (jokerActive(dice, scores) && (cat === 'fullHouse' || cat === 'smallStraight' || cat === 'largeStraight')) {
      return FIXED[cat];
    }
    return rawScore(cat, dice);
  }

  /** Categories the player may legally fill with these dice (forced Joker rules). */
  function allowedCategories(dice, scores) {
    const open = ALL.filter((c) => scores[c] === null);
    if (!jokerActive(dice, scores)) return open;
    const upper = UPPER[dice[0] - 1];
    if (scores[upper] === null) return [upper];
    const lowerOpen = LOWER.filter((c) => scores[c] === null);
    if (lowerOpen.length) return lowerOpen;
    return open;
  }

  /** Rolling another Yahtzee after scoring 50 in the Yahtzee box earns +100. */
  function earnsYahtzeeBonus(dice, scores) {
    return isYahtzee(dice) && scores.yahtzee === 50;
  }

  /** Valid values for manual (no dice) entry. 0 means "scratch". */
  function manualOptions(cat) {
    const upperIdx = UPPER.indexOf(cat);
    if (upperIdx >= 0) return [0, 1, 2, 3, 4, 5].map((k) => k * (upperIdx + 1));
    if (cat in FIXED) return [0, FIXED[cat]];
    const range = [];
    for (let v = 5; v <= 30; v++) range.push(v);
    return cat === 'chance' ? range : [0].concat(range);
  }

  function emptyScores() {
    const s = {};
    ALL.forEach((c) => { s[c] = null; });
    return s;
  }

  /** Totals for a player: { scores, bonusCount } */
  function totals(player) {
    const s = player.scores;
    const val = (c) => s[c] || 0;
    const upperSum = UPPER.reduce((a, c) => a + val(c), 0);
    const upperBonus = upperSum >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
    const lowerSum = LOWER.reduce((a, c) => a + val(c), 0);
    const yahtzeeBonus = (player.bonusCount || 0) * YAHTZEE_BONUS;
    const upperTotal = upperSum + upperBonus;
    const lowerTotal = lowerSum + yahtzeeBonus;
    return {
      upperSum, upperBonus, upperTotal, lowerSum, yahtzeeBonus, lowerTotal,
      grandTotal: upperTotal + lowerTotal,
      filled: ALL.filter((c) => s[c] !== null).length,
    };
  }

  const api = {
    UPPER, LOWER, ALL, LABELS, HINTS, FIXED,
    UPPER_BONUS_THRESHOLD, UPPER_BONUS, YAHTZEE_BONUS,
    counts, sum, isYahtzee, rawScore, scoreFor, jokerActive, allowedCategories,
    earnsYahtzeeBonus, manualOptions, emptyScores, totals,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof window !== 'undefined' ? window : globalThis);
