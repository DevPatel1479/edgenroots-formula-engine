function roundToTwo(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('A formula result must be a finite number.');
  // toFixed produces a two-decimal decimal representation before converting back to Number.
  return Number(number.toFixed(2));
}
module.exports = { roundToTwo };
