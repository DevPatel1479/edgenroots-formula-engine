const test = require('node:test');
const assert = require('node:assert/strict');
const VersionedRepository = require('../src/repositories/VersionedRepository');

function createFakeDatabase() {
  const tables = { formula_versions: [], formula_run_logs: [] };
  const inserts = [];
  const tableColumns = {
    formula_versions: [
      'id',
      'uuid',
      'version_number',
      'name',
      'formula_text',
      'status',
      'created_by',
      'modified_by',
      'first_created_at',
      'row_inserted_at',
    ],
    formula_run_logs: [
      'id',
      'uuid',
      'run_uuid',
      'status',
      'created_by',
      'first_created_at',
      'row_inserted_at',
    ],
  };
  let nextId = 1;
  function performInsert(sql, params = []) {
    const insert = sql.match(/^INSERT INTO `([A-Za-z0-9_]+)` \((.*?)\) VALUES /i);
    if (!insert) return null;
    const tableName = insert[1];
    const columnNames = [...insert[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const rows = [];
    for (let offset = 0; offset < params.length; offset += columnNames.length) {
      const row = { id: nextId++ };
      columnNames.forEach((column, index) => {
        row[column] = params[offset + index];
      });
      tables[tableName].push(row);
      rows.push(row);
    }
    inserts.push({ tableName, count: rows.length, sql });
    return [{ insertId: rows[0]?.id || 0, affectedRows: rows.length }, []];
  }
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      const match = sql.match(/^SHOW COLUMNS FROM `([A-Za-z0-9_]+)`/i);
      if (match) return [tableColumns[match[1]].map((Field) => ({ Field })), []];
      const insertResult = performInsert(sql, params);
      if (insertResult) return insertResult;
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params = []) {
      const select = sql.match(/^SELECT \* FROM `([A-Za-z0-9_]+)` WHERE `([A-Za-z0-9_]+)` = \?/i);
      if (select) {
        const [, tableName, column] = select;
        const rows = tables[tableName]
          .filter((row) => row[column] === params[0])
          .sort((a, b) => b.id - a.id);
        return [rows.slice(0, 1), []];
      }
      const insertResult = performInsert(sql, params);
      if (insertResult) return insertResult;
      throw new Error(`Unexpected execute: ${sql}`);
    },
  };
  return { tables, inserts, database: { getConnection: async () => connection }, tableColumns };
}

test('generic saveRecord creates version 1, then appends version 2 preserving creation metadata', async () => {
  const fake = createFakeDatabase();
  let uuids = 0;
  const repository = new VersionedRepository(fake.database, {
    uuidFactory: () => `uuid-${++uuids}`,
    clock: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  const [first] = await repository.saveRecord('formula_versions', {
    name: 'tax',
    formula_text: 'return EXTERNAL_VAR.amount * 0.18;',
    status: 'ACTIVE',
    created_by: 'admin',
    modified_by: 'admin',
  });
  assert.equal(first.uuid, 'uuid-1');
  assert.equal(first.version_number, 1);
  assert.ok(first.id);
  const [second] = await repository.saveRecord(
    'formula_versions',
    {
      uuid: first.uuid,
      name: 'tax',
      formula_text: 'return EXTERNAL_VAR.amount * 0.12;',
      status: 'ACTIVE',
      modified_by: 'editor',
    },
    { expectedVersion: 1 },
  );
  assert.equal(second.uuid, first.uuid);
  assert.equal(second.version_number, 2);
  assert.equal(second.created_by, 'admin');
  assert.equal(second.first_created_at.getTime(), first.first_created_at.getTime());
  assert.equal(second.modified_by, 'editor');
  assert.equal(fake.tables.formula_versions.length, 2);
  assert.equal(fake.inserts.filter((insert) => insert.tableName === 'formula_versions').length, 2);
});

test('generic saveRecord inserts an array with one multi-row INSERT statement', async () => {
  const fake = createFakeDatabase();
  let uuid = 0;
  const repository = new VersionedRepository(fake.database, { uuidFactory: () => `log-${++uuid}` });
  const rows = await repository.saveRecord('formula_run_logs', [
    { run_uuid: 'run-1', status: 'SUCCESS', created_by: 'system' },
    { run_uuid: 'run-1', status: 'FAILED', created_by: 'system' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].uuid, 'log-1');
  assert.equal(rows[1].uuid, 'log-2');
  assert.equal(fake.inserts.length, 1);
  assert.equal(fake.inserts[0].count, 2);
});

test('generic saveRecord rejects stale expected versions with 409', async () => {
  const fake = createFakeDatabase();
  const repository = new VersionedRepository(fake.database, { uuidFactory: () => 'one-uuid' });
  const [first] = await repository.saveRecord('formula_versions', {
    name: 'x',
    formula_text: 'return 1;',
    status: 'ACTIVE',
    created_by: 'a',
    modified_by: 'a',
  });
  await repository.saveRecord(
    'formula_versions',
    { uuid: first.uuid, formula_text: 'return 2;' },
    { expectedVersion: 1 },
  );
  await assert.rejects(
    () =>
      repository.saveRecord(
        'formula_versions',
        { uuid: first.uuid, formula_text: 'return 3;' },
        { expectedVersion: 1 },
      ),
    (error) => error.statusCode === 409 && error.code === 'VERSION_CONFLICT',
  );
});
