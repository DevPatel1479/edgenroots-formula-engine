const test = require('node:test');
const assert = require('node:assert/strict');
const FormulaService = require('../src/services/FormulaService');
const DependencyResolver = require('../src/services/DependencyResolver');
const AppError = require('../src/errors/AppError');

function createSerializedRepository() {
  let current = {
    id: 1,
    uuid: 'formula-uuid',
    version_number: 1,
    name: 'tax',
    formula_text: 'return EXTERNAL_VAR.amount * 0.18;',
    status: 'ACTIVE',
    created_by: 'admin',
    modified_by: 'admin',
  };
  let nextId = 2;
  let tail = Promise.resolve();
  const repo = {
    async withFormulaWriteLock(callback) {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback({});
      } finally {
        release();
      }
    },
    async getCurrentByUuid() {
      return { ...current };
    },
    async listCurrent() {
      return [{ ...current }];
    },
    async saveRecord(_table, input) {
      current = {
        ...current,
        ...input,
        id: nextId++,
        version_number: current.version_number + 1,
        first_created_at: current.first_created_at || new Date(),
        row_inserted_at: new Date(),
      };
      return [{ ...current }];
    },
    async saveFormulaDependencies() {
      return [];
    },
    async getVersion() {
      return null;
    },
  };
  return repo;
}

test('two edits against the same base version yield one success and one 409 conflict', async () => {
  const formulaRepository = createSerializedRepository();
  const validationService = { validateCandidate: async () => ({ formulaText: 'ok' }) };
  const service = new FormulaService({
    formulaRepository,
    validationService,
    dependencyResolver: new DependencyResolver(),
    defaultCreatedBy: 'test',
  });
  const edit = (formulaText) =>
    service.createOrChange({
      uuid: 'formula-uuid',
      expectedVersion: 1,
      name: 'tax',
      formulaText,
      modifiedBy: 'test',
    });
  const outcomes = await Promise.allSettled([
    edit('return EXTERNAL_VAR.amount * 0.12;'),
    edit('return EXTERNAL_VAR.amount * 0.14;'),
  ]);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(
    outcomes.filter(
      (item) =>
        item.status === 'rejected' &&
        item.reason instanceof AppError &&
        item.reason.statusCode === 409,
    ).length,
    1,
  );
});

test('optimistic version checking reports current version details', () => {
  const service = new FormulaService({
    formulaRepository: {},
    validationService: {},
    dependencyResolver: new DependencyResolver(),
  });
  assert.throws(
    () =>
      service.assertExpectedVersion(
        { uuid: 'u', name: 'tax', version_number: 3, status: 'ACTIVE' },
        2,
      ),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'VERSION_CONFLICT');
      assert.equal(error.details.currentVersion, 3);
      return true;
    },
  );
});
