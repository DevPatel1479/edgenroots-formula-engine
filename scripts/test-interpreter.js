const FormulaInterpreterAdapter = require('../src/services/FormulaInterpreterAdapter');
const engine = require('formula-interpreter');

async function main() {
  const adapter = new FormulaInterpreterAdapter({ engine });

  const tests = [
    ['constant', 'return 200;', {}, 200],
    ['single variable', 'return EXTERNAL_VAR.amount;', { amount: 2000 }, 2000],
    [
      'arithmetic',
      'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
      { amount: 2000, rate: 10 },
      200,
    ],
  ];

  let failures = 0;

  for (const [name, formula, variables, expected] of tests) {
    console.log(`\nTEST: ${name}`);

    try {
      const result = await adapter.evaluate(formula, variables, {
        timeoutMs: 1000,
      });

      console.dir(result, { depth: 5 });

      if (result.status !== 1 || result.data !== expected) {
        failures++;
        console.error(`FAIL: expected ${expected}, received ${result.data}`);
      } else {
        console.log(`PASS: expected ${expected}, received ${result.data}`);
      }
    } catch (error) {
      failures++;
      console.error('FAIL:', error.stack || error.message);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nPASS: all interpreter compatibility tests passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
