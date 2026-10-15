const test = require('node:test');
const assert = require('node:assert/strict');
const FormulaService = require('../src/services/FormulaService');
const DependencyResolver = require('../src/services/DependencyResolver');

function formula(uuid, name, formulaText, status, version) {
  return {
    id: version,
    uuid,
    name,
    formula_text: formulaText,
    status,
    version_number: version,
    created_by: 'admin',
    modified_by: 'admin',
  };
}

test('rollback to an inactive version is rejected when it would break active dependents', async () => {
  const current = formula('tax-id', 'tax', 'return EXTERNAL_VAR.commission * 0.18;', 'ACTIVE', 2);
  const dependent = formula('total-id', 'total', 'return EXTERNAL_VAR.tax + 1;', 'ACTIVE', 1);
  const target = formula('tax-id', 'tax', 'return EXTERNAL_VAR.commission * 0.18;', 'INACTIVE', 1);
  let didSave = false;
  const formulaRepository = {
    withFormulaWriteLock: async (callback) => callback({}),
    getCurrentByUuid: async () => current,
    getVersion: async () => target,
    listCurrent: async () => [current, dependent],
    saveRecord: async () => {
      didSave = true;
      return [current];
    },
  };
  const service = new FormulaService({
    formulaRepository,
    validationService: { validateCandidate: async () => ({}) },
    dependencyResolver: new DependencyResolver(),
    defaultCreatedBy: 'test',
  });
  await assert.rejects(
    () => service.rollback('tax-id', { expectedVersion: 2, targetVersion: 1, force: false }),
    (error) => error.statusCode === 409 && error.code === 'DEPENDENTS_EXIST',
  );
  assert.equal(didSave, false);
});
