class Semaphore {
  constructor(maxConcurrent = 1) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1)
      throw new TypeError('maxConcurrent must be a positive integer.');
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    // A release transfers its occupied permit directly to the next waiter.
    await new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }

  async run(task) {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
module.exports = { Semaphore, mapWithConcurrency };
