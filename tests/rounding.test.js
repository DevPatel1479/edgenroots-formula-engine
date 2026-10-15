const test = require('node:test');
const assert = require('node:assert/strict');
const { roundToTwo } = require('../src/utils/rounding');

test('roundToTwo removes floating point representation noise', () => {
  assert.equal(roundToTwo(0.1 + 0.2), 0.3);
  assert.equal(roundToTwo((2000 * 10) / 100), 200);
  assert.equal(roundToTwo(36.005), 36.01); // Node's Number#toFixed rounds this represented binary value up.
  assert.equal(roundToTwo(-12.345), -12.35);
});

test('roundToTwo refuses non-finite numbers', () => {
  assert.throws(() => roundToTwo(Number.NaN), /finite number/);
  assert.throws(() => roundToTwo(Infinity), /finite number/);
});
