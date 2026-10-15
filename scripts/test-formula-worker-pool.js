const assert = require('node:assert/strict');
const FormulaWorkerPool = require('../src/services/FormulaWorkerPool');

async function main() {
  const pool = new FormulaWorkerPool({
    size: 2,
    timeoutMs: 1000,
  });

  try {
    // Test 1: normal formula
    const normal = await pool.evaluate(
      'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
      { amount: 2000, rate: 10 },
      { timeoutMs: 1000 },
    );

    console.log('Normal formula:', normal);
    assert.equal(normal.status, 1);
    assert.equal(normal.data, 200);

    // Test 2: infinite loop must fail within the timeout
    const startedAt = Date.now();

    const timedOut = await pool.evaluate('while (true) {}', {}, { timeoutMs: 200 });

    console.log('Infinite-loop formula:', timedOut);
    console.log('Timeout elapsed:', Date.now() - startedAt, 'ms');

    assert.equal(timedOut.status, 0);
    assert.match(timedOut.error, /timed out/i);

    // Test 3: pool must still process another formula
    const afterTimeout = await pool.evaluate(
      'return EXTERNAL_VAR.amount + 1;',
      { amount: 41 },
      { timeoutMs: 1000 },
    );

    console.log('Formula after timeout:', afterTimeout);
    assert.equal(afterTimeout.status, 1);
    assert.equal(afterTimeout.data, 42);

    console.log('PASS: normal execution, timeout, and recovery.');
  } finally {
    pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
