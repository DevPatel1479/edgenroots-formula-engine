const { randomUUID } = require('node:crypto');

function requestId(req, res, next) {
  const requested = req.headers['x-request-id'];
  const id =
    typeof requested === 'string' && requested.trim()
      ? requested.trim().slice(0, 128)
      : randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}
module.exports = requestId;
