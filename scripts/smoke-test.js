const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const stamp = Date.now().toString().slice(-9);
const commissionName = `commission_demo_${stamp}`;
const taxName = `tax_demo_${stamp}`;
const totalName = `total_demo_${stamp}`;

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload.data;
}

async function main() {
  console.log(`Testing API at ${baseUrl}`);
  // Create total first to exercise forward references and automatic dependency ordering.
  const total = await request('/formulas', {
    name: totalName,
    formulaText: `return EXTERNAL_VAR.${commissionName} + EXTERNAL_VAR.${taxName};`,
    createdBy: 'smoke-test',
  });
  const tax = await request('/formulas', {
    name: taxName,
    formulaText: `return EXTERNAL_VAR.${commissionName} * 0.18;`,
    createdBy: 'smoke-test',
  });
  const commission = await request('/formulas', {
    name: commissionName,
    formulaText: 'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
    createdBy: 'smoke-test',
  });
  const preview = await request('/formulas/preview', {
    data: { amount: 2000, rate: 10 },
    formulaUuids: [total.uuid, tax.uuid, commission.uuid],
    createdBy: 'smoke-test',
  });
  const byName = Object.fromEntries(preview.results.map((result) => [result.name, result]));
  const expected = [
    [commissionName, 200],
    [taxName, 36],
    [totalName, 236],
  ];
  for (const [name, value] of expected) {
    if (byName[name]?.status !== 'SUCCESS' || byName[name]?.result !== value) {
      throw new Error(
        `Unexpected ${name} result; expected SUCCESS ${value}, got ${JSON.stringify(byName[name])}`,
      );
    }
  }
  console.log('PASS: create total -> tax -> commission; engine executed dependencies correctly.');
  console.table(
    expected.map(([name, expectedResult]) => ({
      name,
      expected: expectedResult,
      actual: byName[name].result,
      status: byName[name].status,
    })),
  );
  console.log(`Run UUID: ${preview.runUuid}`);
  console.log(
    'The smoke test intentionally leaves rows in the insert-only tables; it does not delete test data.',
  );
}
main().catch((error) => {
  console.error('Smoke test failed:', error.message);
  process.exitCode = 1;
});
