const test = require('node:test');
const assert = require('node:assert/strict');
const FormulaInterpreterAdapter = require('../src/services/FormulaInterpreterAdapter');

test('interpreter adapter transforms external variables and passes the correct arguments', async () => {
  let args;

  const engine = {
    interpretor: (...received) => {
      args = received;
      return { status: 1, data: 200 };
    },
  };

  const adapter = new FormulaInterpreterAdapter({
    engine,
    timeoutMs: 100,
  });

  const data = { amount: 2000, rate: 10 };

  const result = await adapter.evaluate(
    'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
    data,
    { timeoutMs: 250 },
  );

  assert.match(args[0], /const __external_0 = EXTERNAL_VAR\["amount"\];/);
  assert.match(args[0], /const __external_1 = EXTERNAL_VAR\["rate"\];/);
  assert.match(args[0], /return __external_0 \* __external_1 \/ 100;/);

  assert.deepEqual(args[1], []);
  assert.equal(args[2], data);
  assert.equal(args[3].timeout, 250);
  assert.equal(args[3].memoryInMB, 10);

  assert.deepEqual(result, { status: 1, data: 200 });
});
