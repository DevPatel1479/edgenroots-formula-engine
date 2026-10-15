const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const AppError = require('../errors/AppError');
const RunLogEntry = require('../models/RunLogEntry');
const { RunStatus } = require('../constants/formulaStatus');
const { mapWithConcurrency } = require('../utils/async');

class PreviewService {
  constructor({
    formulaRepository,
    runLogRepository,
    dependencyResolver,
    evaluator,
    maxRecordConcurrency = 12,
    maxBulkRecords = 500,
  }) {
    this.formulaRepository = formulaRepository;
    this.runLogRepository = runLogRepository;
    this.dependencyResolver = dependencyResolver;
    this.evaluator = evaluator;
    this.maxRecordConcurrency = maxRecordConcurrency;
    this.maxBulkRecords = maxBulkRecords;
  }

  async previewOne({ data, formulaUuids, asOf, createdBy = 'system' }) {
    const startedAt = performance.now();
    const runUuid = randomUUID();
    const evaluated = await this.evaluateRecord({ data, formulaUuids, asOf, runUuid, createdBy });
    await this.runLogRepository.saveMany(evaluated.logs);
    const totalMs = performance.now() - startedAt;
    const results = evaluated.response.results;
    return {
      runUuid,
      ...evaluated.response,
      metrics: {
        totalTimeMs: roundMetric(totalMs),
        averageTimePerRecordMs: roundMetric(totalMs),
        failures: results.filter((result) => result.status === RunStatus.FAILED).length,
        skipped: results.filter((result) => result.status === RunStatus.SKIPPED).length,
      },
    };
  }

  async previewBulk({ records, formulaUuids, asOf, createdBy = 'system' }) {
    if (!Array.isArray(records) || records.length < 1)
      throw new AppError(400, 'INVALID_RECORDS', 'records must be a non-empty array.');
    if (records.length > this.maxBulkRecords)
      throw new AppError(
        400,
        'TOO_MANY_RECORDS',
        `A bulk preview can contain at most ${this.maxBulkRecords} records.`,
      );
    const startedAt = performance.now();
    const runUuid = randomUUID();
    const formulasAtTime = await this.formulaRepository.listActiveAsOf(asOf || null);
    const selected =
      formulaUuids == null || formulaUuids.length === 0
        ? formulasAtTime
        : this.dependencyResolver.selectDependencyClosure(formulasAtTime, formulaUuids);

    // Validate every record before the first formula is evaluated or any run log is written.
    for (let index = 0; index < records.length; index += 1) {
      try {
        this.dependencyResolver.resolve(selected, records[index], { strictInputs: true });
      } catch (error) {
        error.details = {
          ...(error.details && !Array.isArray(error.details) ? error.details : {}),
          recordIndex: index,
          validationDetails: error.details,
        };
        throw error;
      }
    }

    const items = await mapWithConcurrency(records, this.maxRecordConcurrency, (data) =>
      this.evaluateRecord({
        data,
        formulaUuids,
        asOf,
        runUuid,
        createdBy,
        formulaSet: selected,
        preselected: true,
      }),
    );
    const logs = items.flatMap((item) => item.logs);
    if (logs.length) await this.runLogRepository.saveMany(logs);

    const totalMs = performance.now() - startedAt;
    const recordResponses = items.map((item) => item.response);
    const everyResult = recordResponses.flatMap((item) => item.results);
    return {
      runUuid,
      records: recordResponses,
      metrics: {
        totalTimeMs: roundMetric(totalMs),
        averageTimePerRecordMs: roundMetric(totalMs / records.length),
        failures: everyResult.filter((result) => result.status === RunStatus.FAILED).length,
        skipped: everyResult.filter((result) => result.status === RunStatus.SKIPPED).length,
        recordsProcessed: records.length,
        formulaRuns: everyResult.length,
      },
    };
  }

  async evaluateRecord({
    data,
    formulaUuids,
    asOf,
    runUuid,
    createdBy,
    formulaSet = null,
    preselected = false,
  }) {
    const formulasAtTime =
      formulaSet ?? (await this.formulaRepository.listActiveAsOf(asOf || null));
    const selected =
      preselected || formulaUuids == null || formulaUuids.length === 0
        ? formulasAtTime
        : this.dependencyResolver.selectDependencyClosure(formulasAtTime, formulaUuids);
    const graph = this.dependencyResolver.resolve(selected, data, { strictInputs: true });
    const recordWithResults = { ...data };
    const outcomes = new Map();
    const resultList = [];
    const logs = [];

    for (const level of graph.levels) {
      const levelOutcomes = await Promise.all(
        level.map(async (formula) => {
          const dependencyNames = [...(graph.dependencies.get(formula.name) || new Set())];
          const blocked = dependencyNames
            .map((name) => ({ name, outcome: outcomes.get(name) }))
            .find(({ outcome }) => !outcome || outcome.status !== RunStatus.SUCCESS);
          if (blocked) {
            return {
              formula,
              outcome: {
                status: RunStatus.SKIPPED,
                result: null,
                error: `Skipped because dependency "${blocked.name}" did not succeed.`,
                durationMs: 0,
                calculation: {
                  inputs: Object.fromEntries(
                    dependencyNames.map((name) => [name, recordWithResults[name] ?? null]),
                  ),
                  formula: formula.formula_text,
                  substitutedSteps: null,
                  result: null,
                  engineCalculationText: null,
                },
              },
            };
          }
          const formulaStarted = performance.now();
          try {
            const outcome = await this.evaluator.evaluate(formula, recordWithResults);
            outcome.durationMs = outcome.durationMs ?? performance.now() - formulaStarted;
            return { formula, outcome };
          } catch (error) {
            return {
              formula,
              outcome: {
                status: RunStatus.FAILED,
                result: null,
                error: error.message || 'Formula evaluation failed.',
                durationMs: performance.now() - formulaStarted,
                calculation: {
                  inputs: {},
                  formula: formula.formula_text,
                  substitutedSteps: null,
                  result: null,
                  engineCalculationText: null,
                },
              },
            };
          }
        }),
      );

      // Apply values only after every formula at the same level has finished.
      for (const { formula, outcome } of levelOutcomes) {
        outcomes.set(formula.name, outcome);
        if (outcome.status === RunStatus.SUCCESS) recordWithResults[formula.name] = outcome.result;
        resultList.push({
          uuid: formula.uuid,
          name: formula.name,
          version: formula.version_number,
          status: outcome.status,
          result: outcome.result,
          calculation: outcome.calculation,
          error: outcome.error ?? null,
          durationMs: roundMetric(outcome.durationMs ?? 0),
        });
        logs.push(
          new RunLogEntry({
            runUuid,
            formula,
            input: data,
            status: outcome.status,
            result: outcome.result,
            calculation: outcome.calculation,
            error: outcome.error ?? null,
            durationMs: outcome.durationMs ?? 0,
            createdBy,
          }).toRecord(),
        );
      }
    }

    resultList.sort(
      (a, b) =>
        (graph.levelByName.get(a.name) ?? 0) - (graph.levelByName.get(b.name) ?? 0) ||
        a.name.localeCompare(b.name),
    );
    return { logs, response: { input: data, results: resultList, record: recordWithResults } };
  }
}

function roundMetric(value) {
  return Math.round(value * 100) / 100;
}
module.exports = PreviewService;
