require('dotenv').config();

function integerFromEnv(name, fallback, minimum = 1) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return parsed;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: integerFromEnv('PORT', 3000),
  defaultCreatedBy: process.env.DEFAULT_CREATED_BY || 'system',
  dbHost: process.env.DB_HOST || '127.0.0.1',
  dbPort: integerFromEnv('DB_PORT', 3306),
  dbUser: process.env.DB_USER || 'root',
  dbPassword: process.env.DB_PASSWORD || '',
  dbName: process.env.DB_NAME || 'edgenroots_formula_engine',
  dbConnectionLimit: integerFromEnv('DB_CONNECTION_LIMIT', 12),
  dbQueueLimit: integerFromEnv('DB_QUEUE_LIMIT', 0, 0),
  formulaTimeoutMs: integerFromEnv('FORMULA_TIMEOUT_MS', 1000),
  formulaConcurrency: integerFromEnv('FORMULA_CONCURRENCY', 24),
  bulkRecordConcurrency: integerFromEnv('BULK_RECORD_CONCURRENCY', 12),
  maxBulkRecords: integerFromEnv('MAX_BULK_RECORDS', 500),
};

module.exports = env;
