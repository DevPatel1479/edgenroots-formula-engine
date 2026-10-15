const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const suffix = Date.now().toString().slice(-9);

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload.data;
}

async function main() {
  console.log(`Creating 10 unique formula rules for a 500-record benchmark at ${baseUrl}`);
  const formulaUuids = [];
  for (let index = 1; index <= 10; index += 1) {
    const saved = await post('/formulas', {
      name: `bulk_bench_${suffix}_${index}`,
      formulaText: `return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate * ${index} / 100;`,
      sampleData: { amount: 2000, rate: 10 },
      createdBy: 'bulk-benchmark',
    });
    formulaUuids.push(saved.uuid);
  }

  const records = Array.from({ length: 500 }, (_, index) => ({ amount: 1000 + index, rate: 10 }));
  console.log('Submitting 500 records × 10 formulas (5,000 formula runs)...');
  const result = await post('/formulas/preview/bulk', {
    records,
    formulaUuids,
    createdBy: 'bulk-benchmark',
  });
  console.log(JSON.stringify({ runUuid: result.runUuid, metrics: result.metrics }, null, 2));
  if (result.metrics.recordsProcessed !== 500 || result.metrics.formulaRuns !== 5000) {
    throw new Error(`Unexpected benchmark counts: ${JSON.stringify(result.metrics)}`);
  }
  if (result.metrics.totalTimeMs > 30000) {
    console.error('FAIL: benchmark exceeded the assignment target of 30,000 ms.');
    process.exitCode = 1;
  } else {
    console.log('PASS: benchmark completed within 30,000 ms on this machine.');
  }
  console.log(
    'Benchmark formulas and run logs are intentionally retained in the insert-only tables.',
  );
}
main().catch((error) => {
  console.error('Bulk benchmark failed:', error.message);
  process.exitCode = 1;
});
