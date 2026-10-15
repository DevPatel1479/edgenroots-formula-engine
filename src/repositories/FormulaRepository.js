const AppError = require('../errors/AppError');
const { extractExternalReferences } = require('../utils/formulaText');
const VersionedRepository = require('./VersionedRepository');

class FormulaRepository {
  constructor(database, versionedRepository = new VersionedRepository(database)) {
    this.database = database;
    this.versionedRepository = versionedRepository;
  }

  async listCurrent({ activeOnly = false, connection } = {}) {
    const runner = connection || this.database;
    const filter = activeOnly ? " WHERE status = 'ACTIVE'" : '';
    const [rows] = await runner.query(`SELECT * FROM current_formulas${filter} ORDER BY name ASC`);
    return rows;
  }

  async getCurrentByUuid(uuid, connection) {
    const runner = connection || this.database;
    const [rows] = await runner.execute('SELECT * FROM current_formulas WHERE uuid = ? LIMIT 1', [
      uuid,
    ]);
    return rows[0] || null;
  }

  async getCurrentByName(name, { activeOnly = false, connection } = {}) {
    const runner = connection || this.database;
    const activeFilter = activeOnly ? " AND status = 'ACTIVE'" : '';
    const [rows] = await runner.execute(
      `SELECT * FROM current_formulas WHERE name = ?${activeFilter} LIMIT 1`,
      [name],
    );
    return rows[0] || null;
  }

  async listActiveAsOf(asOf) {
    if (!asOf) return this.listCurrent({ activeOnly: true });
    const [rows] = await this.database.execute(
      `SELECT fv.*
         FROM formula_versions fv
         JOIN (
           SELECT uuid, MAX(id) AS max_id
             FROM formula_versions
            WHERE row_inserted_at <= ?
            GROUP BY uuid
         ) chosen ON chosen.max_id = fv.id
        WHERE fv.status = 'ACTIVE'
        ORDER BY fv.name ASC`,
      [asOf],
    );
    return rows;
  }

  async getHistory(uuid) {
    const [rows] = await this.database.execute(
      `SELECT id, uuid, version_number, name, formula_text, status, created_by,
              modified_by, first_created_at, row_inserted_at
         FROM formula_versions WHERE uuid = ? ORDER BY id ASC`,
      [uuid],
    );
    return rows;
  }

  async getVersion(uuid, versionNumber, connection) {
    const runner = connection || this.database;
    const [rows] = await runner.execute(
      'SELECT * FROM formula_versions WHERE uuid = ? AND version_number = ? ORDER BY id DESC LIMIT 1',
      [uuid, versionNumber],
    );
    return rows[0] || null;
  }

  async withFormulaWriteLock(callback, { timeoutSeconds = 10 } = {}) {
    const connection = await this.database.getConnection();
    let acquired = false;
    let transactionStarted = false;
    try {
      const [lockRows] = await connection.execute('SELECT GET_LOCK(?, ?) AS acquired', [
        'edgenroots_formula_writes',
        timeoutSeconds,
      ]);
      acquired = Number(lockRows[0]?.acquired) === 1;
      if (!acquired)
        throw new AppError(
          503,
          'WRITE_LOCK_TIMEOUT',
          'Formula changes are busy. Retry the request.',
        );
      await connection.beginTransaction();
      transactionStarted = true;
      const value = await callback(connection);
      await connection.commit();
      transactionStarted = false;
      return value;
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          /* Preserve the original error. */
        }
      }
      throw error;
    } finally {
      if (acquired) {
        try {
          await connection.execute('SELECT RELEASE_LOCK(?)', ['edgenroots_formula_writes']);
        } catch {
          /* Connection release also releases named locks. */
        }
      }
      connection.release();
    }
  }

  saveRecord(tableName, data, options = {}) {
    return this.versionedRepository.saveRecord(tableName, data, options);
  }

  async saveFormulaDependencies(formulaRow, dependencyNames, createdBy, connection) {
    if (!dependencyNames.length) return [];
    const rows = dependencyNames.map((dependsOnName) => ({
      owner_formula_uuid: formulaRow.uuid,
      owner_formula_version_id: formulaRow.id,
      formula_name: formulaRow.name,
      depends_on_name: dependsOnName,
      created_by: createdBy,
    }));
    return this.saveRecord('formula_dependencies', rows, { connection });
  }

  async getImpact(uuid) {
    const target = await this.getCurrentByUuid(uuid);
    if (!target) throw new AppError(404, 'FORMULA_NOT_FOUND', `Formula ${uuid} was not found.`);
    const active = await this.listCurrent({ activeOnly: true });
    const dependents = new Map();
    for (const formula of active) {
      for (const reference of extractExternalReferences(formula.formula_text)) {
        if (!dependents.has(reference)) dependents.set(reference, []);
        dependents.get(reference).push(formula);
      }
    }
    const found = new Map();
    const queue = [target.name];
    while (queue.length) {
      const dependencyName = queue.shift();
      for (const formula of dependents.get(dependencyName) || []) {
        if (formula.uuid === uuid || found.has(formula.uuid)) continue;
        found.set(formula.uuid, {
          uuid: formula.uuid,
          name: formula.name,
          version: formula.version_number,
          direct: extractExternalReferences(formula.formula_text).includes(target.name),
        });
        queue.push(formula.name);
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

module.exports = FormulaRepository;
