const express = require('express');
const validateBody = require('../middleware/validateBody');
const {
  formulaBody,
  deactivateBody,
  rollbackBody,
  previewBody,
  bulkPreviewBody,
} = require('../validation/schemas');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createFormulaRouter(controller) {
  const router = express.Router();
  router.get('/formulas', asyncHandler(controller.list));
  router.post('/formulas', validateBody(formulaBody), asyncHandler(controller.createOrChange));
  router.post(
    '/formulas/:uuid/deactivate',
    validateBody(deactivateBody),
    asyncHandler(controller.deactivate),
  );
  router.post(
    '/formulas/:uuid/rollback',
    validateBody(rollbackBody),
    asyncHandler(controller.rollback),
  );
  router.get('/formulas/:uuid/history', asyncHandler(controller.history));
  router.get('/formulas/:uuid/impact', asyncHandler(controller.impact));
  router.post('/formulas/preview', validateBody(previewBody), asyncHandler(controller.preview));
  router.post(
    '/formulas/preview/bulk',
    validateBody(bulkPreviewBody),
    asyncHandler(controller.previewBulk),
  );
  return router;
}
module.exports = createFormulaRouter;
