const AppError = require('../errors/AppError');
const { FormulaStatus } = require('../constants/formulaStatus');
const {
  isValidFormulaName,
  normalizeFormulaText,
  extractExternalReferences,
} = require('../utils/formulaText');

class FormulaValidationService {
  constructor({ evaluator, dependencyResolver }) {
    this.evaluator = evaluator;
    this.dependencyResolver = dependencyResolver;
  }

  assertValidName(name) {
    if (!isValidFormulaName(name)) {
      throw new AppError(
        400,
        'INVALID_FORMULA_NAME',
        'name must be an identifier beginning with a letter, _ or $, followed by letters, digits, _ or $.',
      );
    }
  }

  async validateCandidate(candidate, currentFormulas, sampleData = {}) {
    this.assertValidName(candidate.name);
    const formulaText = normalizeFormulaText(candidate.formula_text ?? candidate.formulaText);
    const normalizedCandidate = {
      ...candidate,
      formula_text: formulaText,
      status: FormulaStatus.ACTIVE,
    };
    const formulas = currentFormulas.filter((formula) => formula.uuid !== normalizedCandidate.uuid);
    formulas.push(normalizedCandidate);
    this.dependencyResolver.resolve(
      formulas.filter((formula) => formula.status === FormulaStatus.ACTIVE),
      {},
      { strictInputs: false },
    );

    const sample = { ...sampleData };
    for (const reference of extractExternalReferences(formulaText)) {
      if (!Object.prototype.hasOwnProperty.call(sample, reference)) sample[reference] = 1;
    }
    const evaluation = await this.evaluator.evaluate(normalizedCandidate, sample);
    if (evaluation.status !== 'SUCCESS') {
      throw new AppError(
        400,
        'INVALID_FORMULA',
        'Formula failed validation against sample data; nothing was saved.',
        {
          formula: formulaText,
          reason: evaluation.error,
          calculation: evaluation.calculation,
        },
      );
    }
    return { formulaText, sampleData: sample };
  }
}
module.exports = FormulaValidationService;
