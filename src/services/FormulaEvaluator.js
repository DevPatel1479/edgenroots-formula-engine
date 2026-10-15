const { performance } = require('node:perf_hooks');
const AppError = require('../errors/AppError');
const { roundToTwo } = require('../utils/rounding');
const { extractExternalReferences, substituteFormula } = require('../utils/formulaText');
const ConcurrencyLimiter = require('./ConcurrencyLimiter');

class FormulaEvaluator {
  constructor({ adapter, timeoutMs = 1000, maxConcurrent = 24, limiter = null }) {
    this.adapter = adapter;
    this.timeoutMs = timeoutMs;
    this.limiter = limiter || new ConcurrencyLimiter(maxConcurrent);
  }

  async evaluate(formula, externalVariables, options = {}) {
    const formulaText = formula.formula_text ?? formula.formulaText;
    const startedAt = performance.now();
    const input = externalVariables || {};
    const usedKeys = extractExternalReferences(formulaText);
    const usedInputs = Object.fromEntries(
      usedKeys
        .filter((key) => Object.prototype.hasOwnProperty.call(input, key))
        .map((key) => [key, input[key]]),
    );
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    try {
      const raw = await this.limiter.run(() =>
        this.runWithTimeout(
          () => this.adapter.evaluate(formulaText, input, { timeoutMs }),
          timeoutMs,
        ),
      );
      const normalized = normalizeEngineResult(raw);
      if (normalized.status !== 'SUCCESS') {
        return this.failure(
          normalized.error || 'The formula interpreter reported a failure.',
          formulaText,
          input,
          usedInputs,
          normalized.calculationText,
          startedAt,
        );
      }
      if (
        normalized.result === null ||
        normalized.result === undefined ||
        normalized.result === '' ||
        typeof normalized.result === 'boolean' ||
        typeof normalized.result === 'object'
      ) {
        return this.failure(
          'The formula interpreter did not return a numeric result.',
          formulaText,
          input,
          usedInputs,
          normalized.calculationText,
          startedAt,
        );
      }
      const numeric = Number(normalized.result);
      if (!Number.isFinite(numeric)) {
        return this.failure(
          'The formula must return a finite numeric result.',
          formulaText,
          input,
          usedInputs,
          normalized.calculationText,
          startedAt,
        );
      }
      const result = roundToTwo(numeric);
      // Use our predictable substitution for the step-by-step explanation; preserve the
      // interpreter's own report separately for diagnostics and package-specific details.
      const explanation = substituteFormula(formulaText, input);
      return {
        status: 'SUCCESS',
        result,
        error: null,
        durationMs: performance.now() - startedAt,
        calculation: {
          inputs: usedInputs,
          formula: formulaText,
          substitutedSteps: explanation,
          result,
          engineCalculationText: normalized.calculationText,
        },
      };
    } catch (error) {
      return this.failure(
        error?.message || 'Formula evaluation failed.',
        formulaText,
        input,
        usedInputs,
        null,
        startedAt,
      );
    }
  }

  async runWithTimeout(task, timeoutMs) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(task),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new AppError(
                  504,
                  'FORMULA_TIMEOUT',
                  `Formula exceeded the ${timeoutMs} ms timeout.`,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  failure(message, formulaText, input, usedInputs, calculationText, startedAt) {
    return {
      status: 'FAILED',
      result: null,
      error: message,
      durationMs: performance.now() - startedAt,
      calculation: {
        inputs: usedInputs,
        formula: formulaText,
        substitutedSteps: substituteFormula(formulaText, input),
        result: null,
        engineCalculationText: calculationText,
      },
    };
  }
}

function normalizeEngineResult(raw) {
  if (raw === null || raw === undefined) {
    return {
      status: 'FAILED',
      result: null,
      error: 'Formula interpreter returned an empty response.',
      calculationText: null,
    };
  }

  if (typeof raw !== 'object') {
    return {
      status: 'SUCCESS',
      result: raw,
      error: null,
      calculationText: null,
    };
  }

  const rawStatus = String(raw.status ?? raw.state ?? '').toUpperCase();
  const error = raw.error ?? raw.errorMessage ?? raw.error_message ?? null;
  const calculationValue =
    raw.calculationText ?? raw.calculation_text ?? raw.calculation ?? raw.explanation ?? null;

  const result = raw.result ?? raw.data ?? raw.value ?? raw.output;

  const explicitSuccess =
    raw.success === true || ['SUCCESS', 'SUCCEEDED', 'OK', 'COMPLETED', 'PASS'].includes(rawStatus);

  // Support both numeric status conventions used by different engines.
  const numericStatusSuccess =
    ['0', '1'].includes(rawStatus) && result !== undefined && error == null;

  const implicitSuccess = rawStatus === '' && error == null && result !== undefined;

  const success = (explicitSuccess || numericStatusSuccess || implicitSuccess) && error == null;

  return {
    status: success ? 'SUCCESS' : 'FAILED',
    result: result === undefined ? null : result,
    error: error
      ? String(error)
      : success
        ? null
        : `Formula interpreter reported status ${rawStatus || 'unknown'}.`,
    calculationText:
      typeof calculationValue === 'string'
        ? calculationValue
        : calculationValue
          ? JSON.stringify(calculationValue)
          : null,
  };
}

module.exports = { FormulaEvaluator, normalizeEngineResult };
