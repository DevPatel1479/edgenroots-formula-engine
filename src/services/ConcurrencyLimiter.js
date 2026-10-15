const { Semaphore } = require('../utils/async');
class ConcurrencyLimiter {
  constructor(maxConcurrent = 24) {
    this.semaphore = new Semaphore(maxConcurrent);
  }
  run(task) {
    return this.semaphore.run(task);
  }
}
module.exports = ConcurrencyLimiter;
