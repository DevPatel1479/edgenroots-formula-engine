const AppError = require('../errors/AppError');

module.exports = function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  let normalized = error;
  if (error?.type === 'entity.parse.failed') {
    normalized = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  } else if (error?.type === 'entity.too.large') {
    normalized = new AppError(413, 'BODY_TOO_LARGE', 'Request body exceeds the 1 MB limit.');
  } else if (!(error instanceof AppError)) {
    console.error(`[${req.id || 'no-request-id'}]`, error);
    normalized = new AppError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected server error occurred.');
  }
  const body = {
    error: {
      code: normalized.code || 'INTERNAL_SERVER_ERROR',
      message: normalized.message || 'An unexpected server error occurred.',
      requestId: req.id || null,
    },
  };
  if (normalized.details !== undefined) body.error.details = normalized.details;
  res.status(normalized.statusCode || 500).json(body);
};
