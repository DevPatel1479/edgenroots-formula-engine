const FormulaWorkerPool = require('./FormulaWorkerPool');
const DEFAULT_LIBRARIES = [];

class FormulaInterpreterAdapter {
  constructor({ engine = null, timeoutMs = 1000, libraries = DEFAULT_LIBRARIES } = {}) {
    this.injectedEngine = engine;
    this.timeoutMs = timeoutMs;
    this.libraries = libraries;
    this.enginePromise = null;
    this.workerPool = null;
  }

  async loadEngine() {
    if (this.injectedEngine) {
      return this.injectedEngine;
    }

    if (!this.enginePromise) {
      this.enginePromise = (async () => {
        try {
          return require('formula-interpreter');
        } catch (error) {
          if (error?.code !== 'ERR_REQUIRE_ESM') {
            throw error;
          }

          return import('formula-interpreter');
        }
      })();
    }

    const loaded = await this.enginePromise;
    return loaded?.default?.interpretor ? loaded.default : loaded;
  }

  async evaluate(formulaText, externalVariables, options = {}) {
    const engine = await this.loadEngine();

    const interpretor = engine?.interpretor || engine?.default?.interpretor;

    if (typeof interpretor !== 'function') {
      const exports =
        engine && typeof engine === 'object' ? Object.keys(engine).join(', ') : typeof engine;

      throw new Error(
        `formula-interpreter does not expose an interpretor function. Available exports: ${exports}`,
      );
    }

    const timeout = options.timeoutMs ?? options.timeout ?? this.timeoutMs;

    const data = externalVariables ?? {};
    const libraries = Array.isArray(options.libraries) ? options.libraries : this.libraries;

    // Work around formula-interpreter's calculation-reporting bug
    // without modifying the installed dependency.
    const declarations = Object.keys(data).map((key, index) => ({
      key,
      localName: `__external_${index}`,
      declaration: `const __external_${index} = EXTERNAL_VAR[${JSON.stringify(key)}];`,
    }));

    let safeFormula = formulaText;

    for (const { key, localName } of declarations) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      safeFormula = safeFormula.replace(
        new RegExp(`EXTERNAL_VAR\\.${escapedKey}\\b`, 'g'),
        localName,
      );
    }

    safeFormula = `${declarations.map(({ declaration }) => declaration).join('\n')}
${safeFormula}`;

    // return interpretor.call(
    //   engine,
    //   safeFormula,
    //   libraries,
    //   data,
    //   {
    //     timeout,
    //     memoryInMB: 10,
    //   }
    // );
    // Keep the injected engine path for unit tests and custom integrations.
    if (this.injectedEngine) {
      return interpretor.call(engine, safeFormula, libraries, data, {
        timeout,
        memoryInMB: 10,
      });
    }

    // Production path: reuse isolated worker processes.
    if (!this.workerPool) {
      this.workerPool = new FormulaWorkerPool({
        size: 8,
        timeoutMs: timeout,
      });
    }

    return this.workerPool.evaluate(safeFormula, data, {
      timeoutMs: timeout,
      libraries,
    });
  }
}

module.exports = FormulaInterpreterAdapter;
