const test = require('node:test');
const assert = require('node:assert/strict');
const FormulaService = require('../src/services/FormulaService');
const DependencyResolver = require('../src/services/DependencyResolver');

function makeRepository({ currentRows = [], historyRows = [] } = {}) {
  let current = currentRows.map((row) => ({ ...row }));
  let nextId = Math.max(0, ...current.map((row) => Number(row.id) || 0)) + 1;
  const savedRecords = [];

  const repository = {
    async withFormulaWriteLock(callback) {
      return callback({});
    },

    async getCurrentByUuid(uuid) {
      const row = current.find((item) => item.uuid === uuid);
      return row ? { ...row } : null;
    },

    async listCurrent() {
      return current.map((row) => ({ ...row }));
    },

    async getVersion(uuid, versionNumber) {
      const row = historyRows.find(
        (item) => item.uuid === uuid && Number(item.version_number) === Number(versionNumber),
      );
      return row ? { ...row } : null;
    },

    async saveFormulaDependencies() {
      return [];
    },

    async saveRecord(table, data, options = {}) {
      const previous = data.uuid ? current.find((row) => row.uuid === data.uuid) : null;
      const uuid = data.uuid || `generated-formula-${nextId}`;
      const saved = {
        ...(previous || {}),
        ...data,
        id: nextId++,
        uuid,
        version_number: previous ? Number(previous.version_number) + 1 : 1,
        created_by: previous?.created_by ?? data.created_by,
        first_created_at: previous?.first_created_at ?? new Date('2026-01-01T00:00:00.000Z'),
        row_inserted_at: new Date('2026-10-15T00:00:00.000Z'),
      };

      current = current.filter((row) => row.uuid !== uuid);
      current.push(saved);
      savedRecords.push({ table, data: { ...data }, options, saved: { ...saved } });
      return [{ ...saved }];
    },
  };

  return { repository, savedRecords, getCurrent: () => current.map((row) => ({ ...row })) };
}

function makeService(repository, validationService) {
  return new FormulaService({
    formulaRepository: repository,
    validationService,
    dependencyResolver: new DependencyResolver(),
    defaultCreatedBy: 'test',
  });
}

test('invalid formula is rejected before inserting a formula row', async () => {
  const fake = makeRepository();
  const service = makeService(fake.repository, {
    async validateCandidate() {
      throw new Error('Formula syntax error: Unexpected token');
    },
  });

  await assert.rejects(
    () =>
      service.createOrChange({
        name: 'broken_formula',
        formulaText: 'return (;',
        createdBy: 'test',
        modifiedBy: 'test',
      }),
    /syntax error|unexpected token/i,
  );

  assert.equal(fake.savedRecords.length, 0, 'invalid formula must not be inserted');
});

test('duplicate active formula name is rejected before inserting a row', async () => {
  const fake = makeRepository({
    currentRows: [
      {
        id: 1,
        uuid: 'existing-tax-id',
        version_number: 1,
        name: 'tax',
        formula_text: 'return 1;',
        status: 'ACTIVE',
        created_by: 'admin',
        modified_by: 'admin',
      },
    ],
  });
  const service = makeService(fake.repository, {
    async validateCandidate() {
      return { formulaText: 'return 2;', dependencies: [] };
    },
  });

  await assert.rejects(
    () =>
      service.createOrChange({
        name: 'tax',
        formulaText: 'return 2;',
        createdBy: 'test',
        modifiedBy: 'test',
      }),
    /duplicate|unique|already|active.*name|name/i,
  );

  assert.equal(fake.savedRecords.length, 0, 'duplicate active name must not be inserted');
});

test('deactivating a formula with active dependents is rejected without force', async () => {
  const fake = makeRepository({
    currentRows: [
      {
        id: 1,
        uuid: 'tax-id',
        version_number: 2,
        name: 'tax',
        formula_text: 'return EXTERNAL_VAR.commission * 0.18;',
        status: 'ACTIVE',
        created_by: 'admin',
        modified_by: 'admin',
      },
      {
        id: 2,
        uuid: 'total-id',
        version_number: 1,
        name: 'total',
        formula_text: 'return EXTERNAL_VAR.commission + EXTERNAL_VAR.tax;',
        status: 'ACTIVE',
        created_by: 'admin',
        modified_by: 'admin',
      },
    ],
  });
  const service = makeService(fake.repository, {
    async validateCandidate() {
      return { formulaText: 'return 1;', dependencies: [] };
    },
  });

  await assert.rejects(
    () =>
      service.deactivate('tax-id', {
        expectedVersion: 2,
        force: false,
        modifiedBy: 'test',
      }),
    (error) => error.statusCode === 409 && error.code === 'DEPENDENTS_EXIST',
  );

  assert.equal(fake.savedRecords.length, 0, 'deactivation must not be inserted when blocked');
});

test('successful rollback appends a new version containing the target version values', async () => {
  const current = {
    id: 2,
    uuid: 'tax-id',
    version_number: 2,
    name: 'tax',
    formula_text: 'return EXTERNAL_VAR.amount * 0.12;',
    status: 'ACTIVE',
    created_by: 'admin',
    modified_by: 'editor',
    first_created_at: new Date('2026-01-01T00:00:00.000Z'),
  };
  const target = {
    id: 1,
    uuid: 'tax-id',
    version_number: 1,
    name: 'tax',
    formula_text: 'return EXTERNAL_VAR.amount * 0.18;',
    status: 'ACTIVE',
    created_by: 'admin',
    modified_by: 'admin',
    first_created_at: new Date('2026-01-01T00:00:00.000Z'),
  };
  const fake = makeRepository({ currentRows: [current], historyRows: [target, current] });
  const service = makeService(fake.repository, {
    async validateCandidate() {
      return { formulaText: target.formula_text, dependencies: [] };
    },
  });

  await service.rollback('tax-id', {
    expectedVersion: 2,
    targetVersion: 1,
    force: false,
    modifiedBy: 'admin',
  });

  assert.equal(fake.savedRecords.length, 1);
  const [insert] = fake.savedRecords;
  assert.equal(insert.data.uuid, 'tax-id');
  assert.equal(insert.saved.version_number, 3);
  assert.equal(insert.saved.name, 'tax');
  assert.equal(insert.saved.formula_text, target.formula_text);
  assert.equal(insert.saved.status, 'ACTIVE');
  assert.equal(fake.getCurrent().find((row) => row.uuid === 'tax-id').version_number, 3);
});
