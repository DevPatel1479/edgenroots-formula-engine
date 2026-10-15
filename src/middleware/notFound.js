const AppError = require('../errors/AppError');
module.exports = function notFound(req, _res, next) {
  next(
    new AppError(404, 'ROUTE_NOT_FOUND', `No route exists for ${req.method} ${req.originalUrl}.`),
  );
};
