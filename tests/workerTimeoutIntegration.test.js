const test = require('node:test');
const assert = require('node:assert/strict');

const FormulaWorkerPool = require('../src/services/FormulaWorkerPool');
const { FormulaEvaluator } = require('../src/services/FormulaEvaluator');
const PreviewService = require('../src/services/PreviewService');
const DependencyResolver = require('../src/services/DependencyResolver');

test('real worker timeout fails one formula, skips its dependent, and runs independent formulas', async () => {
  const timeoutMs = 250;
  const pool = new FormulaWorkerPool({ size: 3, timeoutMs });

  const formulas = [
    {
      uuid: 'loop-id',
      name: 'loop_formula',
      version_number: 1,
      status: 'ACTIVE',
      formula_text: 'if (EXTERNAL_VAR.shouldHang) { while (true) {} } return 1;',
    },
    {
      uuid: 'dependent-id',
      name: 'dependent_formula',
      version_number: 1,
      status: 'ACTIVE',
      formula_text: 'return EXTERNAL_VAR.loop_formula + 1;',
    },
    {
      uuid: 'independent-id',
      name: 'independent_formula',
      version_number: 1,
      status: 'ACTIVE',
      formula_text: 'return EXTERNAL_VAR.amount * 2;',
    },
  ];

  const savedLogs = [];

  const evaluator = new FormulaEvaluator({
    adapter: pool,
    timeoutMs,
    maxConcurrent: 3,
  });

  const previewService = new PreviewService({
    formulaRepository: {
      listActiveAsOf: async () => formulas,
    },
    runLogRepository: {
      saveMany: async (logs) => {
        savedLogs.push(...logs);
        return logs;
      },
    },
    dependencyResolver: new DependencyResolver(),
    evaluator,
  });

  try {
    const response = await previewService.previewOne({
      data: {
        amount: 10,
        shouldHang: true,
      },
    });

    const results = Object.fromEntries(response.results.map((item) => [item.name, item]));

    // The actual worker must stop the infinite loop.
    assert.equal(results.loop_formula.status, 'FAILED');
    assert.match(results.loop_formula.error, /timeout/i);

    // The dependent formula must not execute.
    assert.equal(results.dependent_formula.status, 'SKIPPED');
    assert.match(results.dependent_formula.error, /dependency.*loop_formula/i);

    // Independent work must still succeed.
    assert.equal(results.independent_formula.status, 'SUCCESS');
    assert.equal(results.independent_formula.result, 20);

    // Each formula should be represented in the preview logs.
    assert.equal(savedLogs.length, 3);
    assert.equal(response.metrics.failures, 1);
    assert.equal(response.metrics.skipped, 1);
    assert.equal(response.record.independent_formula, 20);
    assert.equal(Object.hasOwn(response.record, 'dependent_formula'), false);
  } finally {
    pool.close();
  }
});
