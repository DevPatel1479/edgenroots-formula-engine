const { fork } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class FormulaWorkerPool {
  constructor({ size = 8, timeoutMs = 1000 } = {}) {
    this.size = size;
    this.timeoutMs = timeoutMs;
    this.workerPath = path.join(__dirname, 'formulaWorker.js');
    this.slots = [];
    this.queue = [];
    this.closed = false;

    for (let i = 0; i < size; i += 1) {
      const slot = { child: null, ready: false, job: null };
      this.slots.push(slot);
      this.start(slot);
    }
  }

  start(slot) {
    if (this.closed) return;

    const child = fork(this.workerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });

    slot.child = child;
    slot.ready = false;

    child.on('spawn', () => {
      if (slot.child !== child) return;
      slot.ready = true;
      this.dispatch();
    });

    child.on('message', (message) => {
      const job = slot.job;
      if (!job || message?.id !== job.id) return;

      clearTimeout(job.timer);
      slot.job = null;
      job.resolve(message.result);
      this.dispatch();
    });

    child.on('error', (error) => {
      const job = slot.job;
      if (job) {
        clearTimeout(job.timer);
        slot.job = null;
        job.resolve({ status: 0, error: error.message });
      }
      slot.ready = false;
    });

    child.on('exit', () => {
      const job = slot.job;

      if (job) {
        clearTimeout(job.timer);
        slot.job = null;
        job.resolve({
          status: 0,
          error: 'Formula worker exited unexpectedly.',
        });
      }

      slot.ready = false;
      slot.child = null;

      if (!this.closed) {
        setTimeout(() => this.start(slot), 25);
      }
    });
  }

  evaluate(formula, variables, options = {}) {
    if (this.closed) {
      return Promise.resolve({
        status: 0,
        error: 'Formula worker pool is closed.',
      });
    }

    return new Promise((resolve) => {
      this.queue.push({
        id: randomUUID(),
        formula,
        variables,
        libraries: options.libraries || [],
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
        resolve,
      });

      this.dispatch();
    });
  }

  dispatch() {
    if (this.closed) return;

    for (const slot of this.slots) {
      if (!slot.ready || !slot.child || slot.job) continue;

      const job = this.queue.shift();
      if (!job) return;

      slot.job = job;

      // Leave a small margin for IPC delivery; the worker also has its
      // own synchronous VM execution timeout.
      job.timer = setTimeout(() => {
        if (slot.job !== job) return;

        slot.ready = false;
        slot.job = null;
        job.resolve({
          status: 0,
          error: `Timed out after ${job.timeoutMs} ms.`,
        });

        slot.child?.kill();
      }, job.timeoutMs + 50);

      slot.child.send(
        {
          type: 'evaluate',
          id: job.id,
          formula: job.formula,
          variables: job.variables,
          libraries: job.libraries,
          timeoutMs: job.timeoutMs,
        },
        (error) => {
          if (!error || slot.job !== job) return;

          clearTimeout(job.timer);
          slot.job = null;
          slot.ready = false;
          job.resolve({ status: 0, error: error.message });
          slot.child?.kill();
        },
      );
    }
  }

  close() {
    this.closed = true;

    for (const job of this.queue.splice(0)) {
      job.resolve({ status: 0, error: 'Formula worker pool is closed.' });
    }

    for (const slot of this.slots) {
      if (slot.job) {
        clearTimeout(slot.job.timer);
        slot.job.resolve({
          status: 0,
          error: 'Formula worker pool is closed.',
        });
        slot.job = null;
      }

      slot.child?.kill();
    }
  }
}

module.exports = FormulaWorkerPool;
