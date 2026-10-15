const express = require('express');
const env = require('./config/env');
const Database = require('./config/database');
const VersionedRepository = require('./repositories/VersionedRepository');
const FormulaRepository = require('./repositories/FormulaRepository');
const RunLogRepository = require('./repositories/RunLogRepository');
const FormulaInterpreterAdapter = require('./services/FormulaInterpreterAdapter');
const { FormulaEvaluator } = require('./services/FormulaEvaluator');
const DependencyResolver = require('./services/DependencyResolver');
const FormulaValidationService = require('./services/FormulaValidationService');
const FormulaService = require('./services/FormulaService');
const PreviewService = require('./services/PreviewService');
const FormulaController = require('./controllers/FormulaController');
const createFormulaRouter = require('./routes/formulaRoutes');
const requestId = require('./middleware/requestId');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

function createApp({ database = new Database(), config = env, adapter = null } = {}) {
  const versionedRepository = new VersionedRepository(database);
  const formulaRepository = new FormulaRepository(database, versionedRepository);
  const runLogRepository = new RunLogRepository(versionedRepository);
  const dependencyResolver = new DependencyResolver();
  const formulaAdapter =
    adapter || new FormulaInterpreterAdapter({ timeoutMs: config.formulaTimeoutMs });
  const evaluator = new FormulaEvaluator({
    adapter: formulaAdapter,
    timeoutMs: config.formulaTimeoutMs,
    maxConcurrent: config.formulaConcurrency,
  });
  const validationService = new FormulaValidationService({ evaluator, dependencyResolver });
  const formulaService = new FormulaService({
    formulaRepository,
    validationService,
    dependencyResolver,
    defaultCreatedBy: config.defaultCreatedBy,
  });
  const previewService = new PreviewService({
    formulaRepository,
    runLogRepository,
    dependencyResolver,
    evaluator,
    maxRecordConcurrency: config.bulkRecordConcurrency,
    maxBulkRecords: config.maxBulkRecords,
  });
  const controller = new FormulaController({ formulaService, previewService });

  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(express.json({ limit: '1mb', strict: true }));
  app.get('/health', async (_req, res, next) => {
    try {
      await database.ping();
      res.json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });
  const router = createFormulaRouter(controller);
  // Assignment paths are exposed at root. /api aliases keep common client conventions compatible.
  app.use('/', router);
  app.use('/api', router);
  app.use(notFound);
  app.use(errorHandler);

  app.locals.database = database;
  app.locals.services = { formulaService, previewService, evaluator, dependencyResolver };
  return app;
}
module.exports = { createApp };
