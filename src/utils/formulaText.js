const AppError = require('../errors/AppError');

const FORMULA_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,99}$/;
const EXTERNAL_REFERENCE = /\bEXTERNAL_VAR\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;

function isValidFormulaName(name) {
  return typeof name === 'string' && FORMULA_NAME.test(name);
}

function normalizeFormulaText(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(400, 'INVALID_FORMULA_TEXT', 'formulaText must be a non-empty string.');
  }
  const text = value.trim();
  if (text.length > 10000) {
    throw new AppError(400, 'FORMULA_TOO_LONG', 'formulaText must be 10,000 characters or fewer.');
  }
  return text;
}

function extractExternalReferences(value) {
  const text = String(value || '');
  const refs = new Set();
  EXTERNAL_REFERENCE.lastIndex = 0;
  let match;
  while ((match = EXTERNAL_REFERENCE.exec(text)) !== null) refs.add(match[1]);
  EXTERNAL_REFERENCE.lastIndex = 0;
  return [...refs];
}

function substituteFormula(formulaText, variables) {
  // Used only to produce an explanation; it never evaluates the formula text.
  return String(formulaText).replace(EXTERNAL_REFERENCE, (_whole, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables || {}, key)) return `EXTERNAL_VAR.${key}`;
    const value = variables[key];
    let shown;
    try {
      shown = JSON.stringify(value);
    } catch {
      shown = String(value);
    }
    return shown === undefined ? String(value) : shown;
  });
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_OBJECT', `${label} must be a JSON object.`);
  }
}

module.exports = {
  isValidFormulaName,
  normalizeFormulaText,
  extractExternalReferences,
  substituteFormula,
  assertPlainObject,
};
