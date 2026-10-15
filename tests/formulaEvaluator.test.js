const test = require('node:test');
const assert = require('node:assert/strict');
const { FormulaEvaluator, normalizeEngineResult } = require('../src/services/FormulaEvaluator');

test('interpreter numeric status 0 with data is normalized as success', () => {
  assert.deepEqual(normalizeEngineResult({ status: 0, data: 200 }), {
    status: 'SUCCESS',
    result: 200,
    error: null,
    calculationText: null,
  });
});

test('formula evaluator rounds the numeric result and explains used inputs', async () => {
  const evaluator = new FormulaEvaluator({
    adapter: { evaluate: async () => ({ status: 0, data: 0.1 + 0.2 }) },
    timeoutMs: 100,
  });
  const result = await evaluator.evaluate(
    { formula_text: 'return EXTERNAL_VAR.amount * 0.1;' },
    { amount: 3, other: 9 },
  );
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.result, 0.3);
  assert.deepEqual(result.calculation.inputs, { amount: 3 });
  assert.equal(result.calculation.result, 0.3);
});

test('formula evaluator turns a hung adapter into a FAILED timeout result', async () => {
  const evaluator = new FormulaEvaluator({
    adapter: { evaluate: () => new Promise(() => {}) },
    timeoutMs: 25,
    maxConcurrent: 1,
  });
  const result = await evaluator.evaluate({ formula_text: 'return EXTERNAL_VAR.x;' }, { x: 1 });
  assert.equal(result.status, 'FAILED');
  assert.match(result.error, /timeout/i);
});

test('formula evaluator does not report interpreter failures as success', async () => {
  const evaluator = new FormulaEvaluator({
    adapter: { evaluate: async () => ({ status: 1, error: 'syntax error' }) },
    timeoutMs: 100,
  });
  const result = await evaluator.evaluate({ formula_text: 'bad formula' }, {});
  assert.equal(result.status, 'FAILED');
  assert.match(result.error, /syntax error/);
});
