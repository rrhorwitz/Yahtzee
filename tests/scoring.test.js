const assert = require('node:assert/strict');
const S = require('../scoring.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓', name); }
const scoresWith = (o) => Object.assign(S.emptyScores(), o);

test('upper section counts faces', () => {
  assert.equal(S.rawScore('threes', [3, 3, 1, 3, 6]), 9);
  assert.equal(S.rawScore('sixes', [1, 2, 3, 4, 5]), 0);
});
test('kinds', () => {
  assert.equal(S.rawScore('threeKind', [4, 4, 4, 1, 2]), 15);
  assert.equal(S.rawScore('threeKind', [4, 4, 3, 1, 2]), 0);
  assert.equal(S.rawScore('fourKind', [5, 5, 5, 5, 2]), 22);
  assert.equal(S.rawScore('fourKind', [5, 5, 5, 2, 2]), 0);
});
test('full house', () => {
  assert.equal(S.rawScore('fullHouse', [2, 2, 3, 3, 3]), 25);
  assert.equal(S.rawScore('fullHouse', [2, 2, 2, 2, 3]), 0);
  assert.equal(S.rawScore('fullHouse', [6, 6, 6, 6, 6]), 0);
});
test('straights', () => {
  assert.equal(S.rawScore('smallStraight', [1, 2, 3, 4, 6]), 30);
  assert.equal(S.rawScore('smallStraight', [3, 4, 5, 6, 6]), 30);
  assert.equal(S.rawScore('smallStraight', [1, 2, 4, 5, 6]), 0);
  assert.equal(S.rawScore('largeStraight', [2, 3, 4, 5, 6]), 40);
  assert.equal(S.rawScore('largeStraight', [1, 2, 3, 4, 6]), 0);
});
test('yahtzee and chance', () => {
  assert.equal(S.rawScore('yahtzee', [4, 4, 4, 4, 4]), 50);
  assert.equal(S.rawScore('chance', [1, 2, 3, 4, 6]), 16);
});
test('joker not active before Yahtzee box filled', () => {
  const s = S.emptyScores();
  assert.equal(S.jokerActive([3, 3, 3, 3, 3], s), false);
  assert.equal(S.allowedCategories([3, 3, 3, 3, 3], s).length, 13);
});
test('joker forces matching upper box when open', () => {
  const s = scoresWith({ yahtzee: 50 });
  assert.deepEqual(S.allowedCategories([3, 3, 3, 3, 3], s), ['threes']);
  assert.equal(S.earnsYahtzeeBonus([3, 3, 3, 3, 3], s), true);
});
test('joker allows any open lower box at full value when upper filled', () => {
  const s = scoresWith({ yahtzee: 50, threes: 9, chance: 20 });
  const allowed = S.allowedCategories([3, 3, 3, 3, 3], s);
  assert.deepEqual(allowed, ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight']);
  assert.equal(S.scoreFor('fullHouse', [3, 3, 3, 3, 3], s), 25);
  assert.equal(S.scoreFor('largeStraight', [3, 3, 3, 3, 3], s), 40);
  assert.equal(S.scoreFor('fourKind', [3, 3, 3, 3, 3], s), 15);
});
test('joker falls back to any open upper box (scores 0)', () => {
  const s = scoresWith({ yahtzee: 50, threes: 9 });
  S.LOWER.forEach((c) => { s[c] = 10; });
  assert.deepEqual(S.allowedCategories([3, 3, 3, 3, 3], s), ['ones', 'twos', 'fours', 'fives', 'sixes']);
  assert.equal(S.scoreFor('sixes', [3, 3, 3, 3, 3], s), 0);
});
test('scratched Yahtzee: joker applies but no bonus', () => {
  const s = scoresWith({ yahtzee: 0 });
  assert.equal(S.jokerActive([2, 2, 2, 2, 2], s), true);
  assert.equal(S.earnsYahtzeeBonus([2, 2, 2, 2, 2], s), false);
});
test('totals with upper bonus and yahtzee bonus', () => {
  const p = { scores: scoresWith({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18, yahtzee: 50, chance: 22 }), bonusCount: 2 };
  const t = S.totals(p);
  assert.equal(t.upperSum, 63);
  assert.equal(t.upperBonus, 35);
  assert.equal(t.yahtzeeBonus, 200);
  assert.equal(t.grandTotal, 63 + 35 + 72 + 200);
  assert.equal(t.filled, 8);
});
test('manual options', () => {
  assert.deepEqual(S.manualOptions('fours'), [0, 4, 8, 12, 16, 20]);
  assert.deepEqual(S.manualOptions('fullHouse'), [0, 25]);
  assert.equal(S.manualOptions('chance')[0], 5);
  assert.equal(S.manualOptions('threeKind')[0], 0);
});

console.log(`\n${passed} tests passed`);
