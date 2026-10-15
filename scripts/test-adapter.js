const FormulaInterpreterAdapter = require('../src/services/FormulaInterpreterAdapter');

async function main() {
  const adapter = new FormulaInterpreterAdapter();

  const tests = [
    ['constant', 'return 200;', {}],
    ['single variable', 'return EXTERNAL_VAR.amount;', { amount: 2000 }],
    [
      'arithmetic',
      'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
      { amount: 2000, rate: 10 },
    ],
  ];

  for (const [name, formula, variables] of tests) {
    console.log('\nTEST:', name);

    try {
      const result = await adapter.evaluate(formula, variables);
      console.dir(result, { depth: 5 });
    } catch (error) {
      console.error(error.stack || error.message);
    }
  }
}

main().catch(console.error);
