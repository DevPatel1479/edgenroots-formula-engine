const AppError = require('../errors/AppError');
const { assertPlainObject } = require('../utils/formulaText');

function optionalString(value, field, max = 255) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new AppError(
      400,
      'INVALID_REQUEST',
      `${field} must be a non-empty string of at most ${max} characters.`,
    );
  }
  return value.trim();
}
function optionalBoolean(value, field) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean')
    throw new AppError(400, 'INVALID_REQUEST', `${field} must be a boolean.`);
  return value;
}
function expectedVersionFrom(body, required = false) {
  const raw = body.expectedVersion ?? body.expected_version;
  if (raw === undefined && !required) return undefined;
  if (!Number.isInteger(raw) || raw < 1) {
    throw new AppError(
      400,
      'EXPECTED_VERSION_REQUIRED',
      'expectedVersion must be a positive integer.',
    );
  }
  return raw;
}
function validateUuidList(value) {
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((uuid) => typeof uuid !== 'string' || !uuid.trim())
  ) {
    throw new AppError(
      400,
      'INVALID_FORMULA_UUIDS',
      'formulaUuids must be an array of at most 100 non-empty UUID strings.',
    );
  }
  return [...new Set(value.map((uuid) => uuid.trim()))];
}
function validateAsOf(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new AppError(400, 'INVALID_AS_OF', 'asOf must be a valid ISO-8601 date/time string.');
  }
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ');
}
function formulaBody(body) {
  assertPlainObject(body, 'Request body');
  const uuid = optionalString(body.uuid, 'uuid', 36);
  const name = optionalString(body.name, 'name', 100);
  const formulaText = body.formulaText ?? body.formula_text;
  if (
    formulaText !== undefined &&
    (typeof formulaText !== 'string' ||
      formulaText.trim().length === 0 ||
      formulaText.length > 10000)
  ) {
    throw new AppError(
      400,
      'INVALID_FORMULA_TEXT',
      'formulaText must be a non-empty string of at most 10,000 characters.',
    );
  }
  if (!uuid && !name)
    throw new AppError(400, 'INVALID_REQUEST', 'name is required when creating a formula.');
  if (!uuid && formulaText === undefined)
    throw new AppError(400, 'INVALID_REQUEST', 'formulaText is required when creating a formula.');
  const expectedVersion = expectedVersionFrom(body, Boolean(uuid));
  const sampleData = body.sampleData ?? body.sample_data ?? {};
  assertPlainObject(sampleData, 'sampleData');
  return {
    uuid,
    name,
    formulaText,
    expectedVersion,
    force: optionalBoolean(body.force, 'force'),
    createdBy: optionalString(body.createdBy ?? body.created_by, 'createdBy', 255),
    modifiedBy: optionalString(body.modifiedBy ?? body.modified_by, 'modifiedBy', 255),
    sampleData,
  };
}
function deactivateBody(body) {
  assertPlainObject(body, 'Request body');
  return {
    expectedVersion: expectedVersionFrom(body, true),
    force: optionalBoolean(body.force, 'force'),
    modifiedBy: optionalString(body.modifiedBy ?? body.modified_by, 'modifiedBy', 255),
  };
}
function rollbackBody(body) {
  assertPlainObject(body, 'Request body');
  if (!Number.isInteger(body.targetVersion) || body.targetVersion < 1) {
    throw new AppError(400, 'INVALID_TARGET_VERSION', 'targetVersion must be a positive integer.');
  }
  return {
    targetVersion: body.targetVersion,
    expectedVersion: expectedVersionFrom(body, true),
    force: optionalBoolean(body.force, 'force'),
    modifiedBy: optionalString(body.modifiedBy ?? body.modified_by, 'modifiedBy', 255),
  };
}
function previewBody(body) {
  assertPlainObject(body, 'Request body');
  assertPlainObject(body.data, 'data');
  return {
    data: body.data,
    formulaUuids: validateUuidList(body.formulaUuids ?? body.formula_uuids),
    asOf: validateAsOf(body.asOf ?? body.as_of),
    createdBy: optionalString(body.createdBy ?? body.created_by, 'createdBy', 255),
  };
}
function bulkPreviewBody(body) {
  assertPlainObject(body, 'Request body');
  if (!Array.isArray(body.records) || body.records.length < 1 || body.records.length > 500) {
    throw new AppError(
      400,
      'INVALID_RECORDS',
      'records must be an array containing between 1 and 500 objects.',
    );
  }
  body.records.forEach((record, index) => assertPlainObject(record, `records[${index}]`));
  return {
    records: body.records,
    formulaUuids: validateUuidList(body.formulaUuids ?? body.formula_uuids),
    asOf: validateAsOf(body.asOf ?? body.as_of),
    createdBy: optionalString(body.createdBy ?? body.created_by, 'createdBy', 255),
  };
}
module.exports = { formulaBody, deactivateBody, rollbackBody, previewBody, bulkPreviewBody };
