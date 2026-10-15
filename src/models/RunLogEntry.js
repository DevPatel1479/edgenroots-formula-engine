class RunLogEntry {
  constructor({
    runUuid,
    formula,
    input,
    status,
    result,
    calculation,
    error,
    durationMs,
    createdBy = 'system',
  }) {
    this.run_uuid = runUuid;
    this.formula_uuid = formula.uuid;
    this.formula_version = formula.version_number;
    this.formula_name = formula.name;
    this.status = status;
    this.input_json = JSON.stringify(input ?? {});
    this.result_json = result === undefined ? null : JSON.stringify(result);
    this.calculation_json = JSON.stringify(calculation ?? {});
    this.error_text = error ?? null;
    this.duration_ms = Number(durationMs || 0);
    this.created_by = createdBy;
    this.first_created_at = new Date();
    this.row_inserted_at = new Date();
  }
  toRecord() {
    return {
      run_uuid: this.run_uuid,
      formula_uuid: this.formula_uuid,
      formula_version: this.formula_version,
      formula_name: this.formula_name,
      status: this.status,
      input_json: this.input_json,
      result_json: this.result_json,
      calculation_json: this.calculation_json,
      error_message: this.error_text,
      duration_ms: this.duration_ms,
      created_by: this.created_by,
      first_created_at: this.first_created_at,
      row_inserted_at: this.row_inserted_at,
    };
  }
}
module.exports = RunLogEntry;
