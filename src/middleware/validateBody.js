const AppError = require('../errors/AppError');

function validateBody(validator) {
  return (req, _res, next) => {
    try {
      req.validatedBody = validator(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}
module.exports = validateBody;
