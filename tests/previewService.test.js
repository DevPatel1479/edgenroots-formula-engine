const test = require('node:test');
const assert = require('node:assert/strict');
const PreviewService = require('../src/services/PreviewService');
const DependencyResolver = require('../src/services/DependencyResolver');
const { RunStatus } = require('../src/constants/formulaStatus');

test('a failed formula is FAILED, its dependent is SKIPPED, and an independent formula succeeds', async () => {
  const formulas = [
    {
      uuid: 'a-id',
      name: 'a',
      version_number: 1,
      formula_text: 'return EXTERNAL_VAR.sourceA;',
      status: 'ACTIVE',
    },
    {
      uuid: 'b-id',
      name: 'b',
      version_number: 1,
      formula_text: 'return EXTERNAL_VAR.sourceB;',
      status: 'ACTIVE',
    },
    {
      uuid: 'c-id',
      name: 'c',
      version_number: 1,
      formula_text: 'return EXTERNAL_VAR.a + 1;',
      status: 'ACTIVE',
    },
  ];
  let savedLogs = [];
  const service = new PreviewService({
    formulaRepository: { listActiveAsOf: async () => formulas },
    runLogRepository: {
      saveMany: async (logs) => {
        savedLogs = logs;
        return logs;
      },
    },
    dependencyResolver: new DependencyResolver(),
    evaluator: {
      evaluate: async (formula) =>
        formula.name === 'a'
          ? {
              status: RunStatus.FAILED,
              result: null,
              error: 'deliberate test failure',
              durationMs: 1,
              calculation: { formula: formula.formula_text },
            }
          : {
              status: RunStatus.SUCCESS,
              result: 7,
              error: null,
              durationMs: 1,
              calculation: { formula: formula.formula_text, result: 7 },
            },
    },
  });
  const response = await service.previewOne({ data: { sourceA: 1, sourceB: 7 } });
  const results = Object.fromEntries(response.results.map((item) => [item.name, item]));
  assert.equal(results.a.status, 'FAILED');
  assert.equal(results.b.status, 'SUCCESS');
  assert.equal(results.c.status, 'SKIPPED');
  assert.match(results.c.error, /dependency "a"/);
  assert.equal(response.record.b, 7);
  assert.equal(Object.hasOwn(response.record, 'c'), false);
  assert.equal(savedLogs.length, 3);
  assert.equal(response.metrics.failures, 1);
  assert.equal(response.metrics.skipped, 1);
});

test('bulk preview refuses more than 500 records before running formulas', async () => {
  let evaluated = false;
  const service = new PreviewService({
    formulaRepository: { listActiveAsOf: async () => [] },
    runLogRepository: { saveMany: async () => [] },
    dependencyResolver: new DependencyResolver(),
    evaluator: {
      evaluate: async () => {
        evaluated = true;
        return { status: 'SUCCESS', result: 1 };
      },
    },
    maxBulkRecords: 500,
  });
  await assert.rejects(
    () => service.previewBulk({ records: Array.from({ length: 501 }, () => ({})) }),
    (error) => error.code === 'TOO_MANY_RECORDS',
  );
  assert.equal(evaluated, false);
});
