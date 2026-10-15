require('dotenv').config();
const env = require('../src/config/env');
const Database = require('../src/config/database');
const FormulaInterpreterAdapter = require('../src/services/FormulaInterpreterAdapter');
const { normalizeEngineResult } = require('../src/services/FormulaEvaluator');

async function main() {
  const database = new Database();
  try {
    await database.ping();
    const [rows] = await database.query(
      'SELECT DATABASE() AS database_name, VERSION() AS mysql_version',
    );
    const [views] = await database.execute(
      "SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'current_formulas'",
      [env.dbName],
    );
    console.log('MySQL connection: OK');
    console.log(`Database: ${rows[0].database_name}; MySQL: ${rows[0].mysql_version}`);
    if (!views.length)
      throw new Error(
        'current_formulas view is missing. Run sql/views_window.sql or sql/views_aggregate.sql.',
      );
    console.log('current_formulas view: OK');

    const adapter = new FormulaInterpreterAdapter({ timeoutMs: env.formulaTimeoutMs });
    const raw = await adapter.evaluate(
      'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
      { amount: 2000, rate: 10 },
      { timeoutMs: env.formulaTimeoutMs },
    );
    console.log('formula-interpreter raw response:');
    console.dir(raw, { depth: 6 });
    const normalized = normalizeEngineResult(raw);
    if (normalized.status !== 'SUCCESS' || Number(normalized.result) !== 200) {
      throw new Error(`formula-interpreter verification failed: ${JSON.stringify(normalized)}`);
    }
    console.log('formula-interpreter smoke formula: OK (expected 200)');
  } finally {
    await database.close();
  }
}
main().catch((error) => {
  console.error('Environment verification failed:', error.message);
  process.exitCode = 1;
});
