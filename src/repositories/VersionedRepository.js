const { randomUUID } = require('node:crypto');
const AppError = require('../errors/AppError');

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
const SYSTEM_COLUMNS = new Set(['id']);

class VersionedRepository {
  constructor(database, { clock = () => new Date(), uuidFactory = randomUUID } = {}) {
    this.database = database;
    this.clock = clock;
    this.uuidFactory = uuidFactory;
    this.columnCache = new Map();
  }

  assertIdentifier(value, label) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
      throw new AppError(400, 'INVALID_IDENTIFIER', `Invalid ${label}.`);
    }
  }

  async getTableColumns(tableName, connection) {
    this.assertIdentifier(tableName, 'table name');
    if (this.columnCache.has(tableName)) return this.columnCache.get(tableName);
    const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
    if (!rows?.length)
      throw new AppError(
        500,
        'UNKNOWN_TABLE',
        `Table ${tableName} does not exist or has no columns.`,
      );
    const columns = rows.map((row) => row.Field);
    this.columnCache.set(tableName, columns);
    return columns;
  }

  async getCurrentRow(tableName, uuid, uuidColumn, connection) {
    this.assertIdentifier(tableName, 'table name');
    this.assertIdentifier(uuidColumn, 'UUID column');
    const [rows] = await connection.execute(
      `SELECT * FROM \`${tableName}\` WHERE \`${uuidColumn}\` = ? ORDER BY id DESC LIMIT 1`,
      [uuid],
    );
    return rows[0] || null;
  }

  async saveRecord(tableName, input, options = {}) {
    this.assertIdentifier(tableName, 'table name');
    const records = Array.isArray(input) ? input : [input];
    if (!records.length) return [];
    if (records.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) {
      throw new AppError(
        400,
        'INVALID_RECORD',
        'saveRecord expects an object or an array of objects.',
      );
    }

    const uuidColumn = options.uuidColumn || 'uuid';
    this.assertIdentifier(uuidColumn, 'UUID column');
    const ownsConnection = !options.connection;
    const connection = options.connection || (await this.database.getConnection());
    let transactionStarted = false;
    try {
      if (ownsConnection) {
        await connection.beginTransaction();
        transactionStarted = true;
      }
      const columns = await this.getTableColumns(tableName, connection);
      if (!columns.includes(uuidColumn) || !columns.includes('id')) {
        throw new AppError(
          400,
          'INVALID_SAVE_TABLE',
          `Table ${tableName} must contain id and ${uuidColumn}.`,
        );
      }
      const hasVersionNumber = columns.includes('version_number');
      const prepared = [];
      const seenUuids = new Set();

      for (const record of records) {
        const data = { ...record };
        delete data.id;
        const suppliedUuid = data[uuidColumn];
        const uuid = suppliedUuid || this.uuidFactory();
        if (seenUuids.has(uuid))
          throw new AppError(
            400,
            'DUPLICATE_UUID_IN_BATCH',
            'A batch cannot append two rows for the same UUID.',
          );
        seenUuids.add(uuid);

        const current = suppliedUuid
          ? await this.getCurrentRow(tableName, uuid, uuidColumn, connection)
          : null;
        if (suppliedUuid && !current) {
          throw new AppError(
            404,
            'RECORD_NOT_FOUND',
            `No current ${tableName} record exists for UUID ${uuid}.`,
          );
        }
        if (
          options.expectedVersion !== undefined &&
          current &&
          hasVersionNumber &&
          Number(current.version_number) !== Number(options.expectedVersion)
        ) {
          throw new AppError(
            409,
            'VERSION_CONFLICT',
            'The record has changed since the supplied version was read.',
            {
              expectedVersion: options.expectedVersion,
              currentVersion: current.version_number,
              currentRecord: current,
            },
          );
        }

        const merged = current ? { ...current, ...data } : { ...data };
        merged[uuidColumn] = uuid;
        if (current) {
          if (Object.prototype.hasOwnProperty.call(merged, 'first_created_at'))
            merged.first_created_at = current.first_created_at;
          if (columns.includes('created_by')) merged.created_by = current.created_by;
        } else if (columns.includes('first_created_at') && !merged.first_created_at) {
          merged.first_created_at = this.clock();
        }
        if (hasVersionNumber)
          merged.version_number = current ? Number(current.version_number) + 1 : 1;
        if (columns.includes('row_inserted_at')) merged.row_inserted_at = this.clock();

        const output = {};
        for (const [key, value] of Object.entries(merged)) {
          this.assertIdentifier(key, 'column name');
          if (columns.includes(key) && (!SYSTEM_COLUMNS.has(key) || key === 'first_created_at')) {
            output[key] = value === undefined ? null : value;
          }
        }
        prepared.push(output);
      }

      // Multi-row input is saved with exactly one INSERT statement.
      const insertColumns = [...new Set(prepared.flatMap((row) => Object.keys(row)))];
      for (const row of prepared) {
        for (const column of insertColumns) {
          if (!Object.prototype.hasOwnProperty.call(row, column)) row[column] = null;
        }
      }
      const rowPlaceholders = `(${insertColumns.map(() => '?').join(', ')})`;
      const valuesSql = prepared.map(() => rowPlaceholders).join(', ');
      const sql = `INSERT INTO \`${tableName}\` (${insertColumns.map((c) => `\`${c}\``).join(', ')}) VALUES ${valuesSql}`;
      const parameters = prepared.flatMap((row) =>
        insertColumns.map((column) => row[column] ?? null),
      );
      // Large bulk previews can exceed MySQL's 65,535 server-prepared-statement parameter limit.
      // mysql2 query(sql, values) still escapes/binds supplied values safely and keeps this one INSERT.
      const [result] =
        parameters.length > 60000
          ? await connection.query(sql, parameters)
          : await connection.execute(sql, parameters);
      const firstId = Number(result.insertId);
      const saved = prepared.map((row, index) => ({ ...row, id: firstId + index }));
      if (ownsConnection && transactionStarted) await connection.commit();
      return saved;
    } catch (error) {
      if (ownsConnection && transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          /* Preserve the original error. */
        }
      }
      throw error;
    } finally {
      if (ownsConnection) connection.release();
    }
  }
}

module.exports = VersionedRepository;
