const test = require('node:test');
const assert = require('node:assert/strict');
const PreviewService = require('../src/services/PreviewService');
const DependencyResolver = require('../src/services/DependencyResolver');
const { RunStatus } = require('../src/constants/formulaStatus');

const CHANGE_AT = new Date('2026-10-01T00:00:00.000Z');

function buildFormulaSet(taxVersion) {
  return [
    {
      uuid: 'commission-id',
      name: 'commission',
      version_number: 1,
      formula_text: 'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
      status: 'ACTIVE',
    },
    {
      uuid: 'tax-id',
      name: 'tax',
      version_number: taxVersion,
      formula_text:
        taxVersion === 1
          ? 'return EXTERNAL_VAR.commission * 0.18;'
          : 'return EXTERNAL_VAR.commission * 0.12;',
      status: 'ACTIVE',
    },
    {
      uuid: 'total-id',
      name: 'total',
      version_number: 1,
      formula_text: 'return EXTERNAL_VAR.commission + EXTERNAL_VAR.tax;',
      status: 'ACTIVE',
    },
  ];
}

function createService() {
  const batches = [];
  const formulaRepository = {
    async listActiveAsOf(asOf) {
      const timestamp = new Date(asOf);
      assert.equal(
        Number.isNaN(timestamp.getTime()),
        false,
        'preview should pass a valid as-of timestamp',
      );
      return buildFormulaSet(timestamp < CHANGE_AT ? 1 : 2);
    },
  };

  const evaluator = {
    async evaluate(formula, data) {
      let result;
      switch (formula.name) {
        case 'commission':
          result = (data.amount * data.rate) / 100;
          break;
        case 'tax':
          result = data.commission * (formula.version_number === 1 ? 0.18 : 0.12);
          break;
        case 'total':
          result = data.commission + data.tax;
          break;
        default:
          throw new Error(`Unexpected formula: ${formula.name}`);
      }
      return {
        status: RunStatus.SUCCESS,
        result,
        error: null,
        durationMs: 1,
        calculation: {
          inputs: { ...data },
          formula: formula.formula_text,
          substitutedSteps: null,
          result,
        },
      };
    },
  };

  const service = new PreviewService({
    formulaRepository,
    runLogRepository: {
      async saveMany(logs) {
        batches.push(logs.map((log) => ({ ...log })));
        return logs;
      },
    },
    dependencyResolver: new DependencyResolver(),
    evaluator,
  });

  return { service, batches };
}

test('as-of preview uses the formula versions that were current at that timestamp', async () => {
  const { service, batches } = createService();
  const input = { amount: 2000, rate: 10 };

  const beforeChange = await service.previewOne({
    data: input,
    asOf: '2026-09-30T23:59:59.000Z',
  });
  const afterChange = await service.previewOne({
    data: input,
    asOf: '2026-10-02T00:00:00.000Z',
  });

  const oldResults = Object.fromEntries(beforeChange.results.map((item) => [item.name, item]));
  const newResults = Object.fromEntries(afterChange.results.map((item) => [item.name, item]));

  assert.equal(oldResults.commission.status, 'SUCCESS');
  assert.equal(oldResults.commission.result, 200);
  assert.equal(oldResults.tax.version, 1);
  assert.equal(oldResults.tax.result, 36);
  assert.equal(oldResults.total.result, 236);

  assert.equal(newResults.commission.result, 200);
  assert.equal(newResults.tax.version, 2);
  assert.equal(newResults.tax.result, 24);
  assert.equal(newResults.total.result, 224);

  assert.equal(batches.length, 2, 'each preview should persist one batch of logs');
  assert.equal(batches[0].length, 3);
  assert.equal(batches[1].length, 3);
  assert.ok(batches[0].every((log) => log.run_uuid === beforeChange.runUuid));
  assert.ok(batches[1].every((log) => log.run_uuid === afterChange.runUuid));
});
