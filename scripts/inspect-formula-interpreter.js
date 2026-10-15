const pkg = require('formula-interpreter');

console.log('PACKAGE EXPORTS:');
console.dir(pkg, { depth: 3 });

const interpretor = pkg.interpretor || pkg.default?.interpretor;

if (typeof interpretor !== 'function') {
  console.error('No interpretor function found.');
  process.exitCode = 1;
} else {
  console.log('\nFUNCTION SIGNATURE:');
  console.log(interpretor.toString().slice(0, 5000));

  const tests = [
    {
      name: 'Libraries second, variables third',
      args: [
        'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
        [],
        { amount: 2000, rate: 10 },
        { timeout: 1000, timeoutMs: 1000, memoryInMB: 10 },
      ],
    },
    {
      name: 'Variables second, libraries third',
      args: [
        'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
        { amount: 2000, rate: 10 },
        [],
        { timeout: 1000, timeoutMs: 1000, memoryInMB: 10 },
      ],
    },
  ];

  for (const test of tests) {
    console.log(`\nTEST: ${test.name}`);
    try {
      console.dir(interpretor.apply(pkg, test.args), { depth: 5 });
    } catch (error) {
      console.error(error.stack || error.message);
    }
  }
}
