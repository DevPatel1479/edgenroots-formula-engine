const AppError = require('../errors/AppError');
const { FormulaStatus } = require('../constants/formulaStatus');
const { extractExternalReferences, normalizeFormulaText } = require('../utils/formulaText');

class FormulaService {
  constructor({
    formulaRepository,
    validationService,
    dependencyResolver,
    defaultCreatedBy = 'system',
  }) {
    this.formulaRepository = formulaRepository;
    this.validationService = validationService;
    this.dependencyResolver = dependencyResolver;
    this.defaultCreatedBy = defaultCreatedBy;
  }

  list() {
    return this.formulaRepository.listCurrent();
  }

  async createOrChange(body) {
    return this.formulaRepository.withFormulaWriteLock(async (connection) => {
      const isChange = Boolean(body.uuid);
      const current = isChange
        ? await this.formulaRepository.getCurrentByUuid(body.uuid, connection)
        : null;
      if (isChange && !current)
        throw new AppError(404, 'FORMULA_NOT_FOUND', `Formula ${body.uuid} was not found.`);
      this.assertExpectedVersion(current, body.expectedVersion ?? body.expected_version);

      const currentFormulas = await this.formulaRepository.listCurrent({ connection });
      const formulaTextInput = body.formulaText ?? body.formula_text ?? current?.formula_text;
      const candidate = {
        uuid: current?.uuid,
        name: body.name ?? current?.name,
        formula_text: normalizeFormulaText(formulaTextInput),
        status: FormulaStatus.ACTIVE,
      };
      if (!candidate.name) throw new AppError(400, 'INVALID_FORMULA_NAME', 'name is required.');

      if (
        current &&
        current.status === FormulaStatus.ACTIVE &&
        current.name !== candidate.name &&
        !body.force
      ) {
        const active = currentFormulas.filter((row) => row.status === FormulaStatus.ACTIVE);
        const graph = this.dependencyResolver.resolve(active, {}, { strictInputs: false });
        const impacted = this.dependencyResolver.getTransitiveDependents(current.name, graph);
        if (impacted.length)
          throw new AppError(
            409,
            'DEPENDENTS_EXIST',
            `Renaming "${current.name}" would break active formulas. Set force=true to proceed.`,
            impacted.map(({ uuid, name }) => ({ uuid, name })),
          );
      }

      const duplicate = currentFormulas.find(
        (row) =>
          row.status === FormulaStatus.ACTIVE &&
          row.name === candidate.name &&
          row.uuid !== current?.uuid,
      );
      if (duplicate)
        throw new AppError(
          400,
          'FORMULA_NAME_EXISTS',
          `An active formula named "${candidate.name}" already exists.`,
          { uuid: duplicate.uuid },
        );

      await this.validationService.validateCandidate(
        candidate,
        currentFormulas,
        body.sampleData ?? body.sample_data ?? {},
      );
      const nextGraph = currentFormulas.filter(
        (row) => row.uuid !== current?.uuid && row.status === FormulaStatus.ACTIVE,
      );
      nextGraph.push({
        ...candidate,
        uuid: current?.uuid || 'pending-new-formula',
        status: FormulaStatus.ACTIVE,
      });
      this.dependencyResolver.resolve(nextGraph, {}, { strictInputs: false });

      const createdBy =
        current?.created_by || body.createdBy || body.created_by || this.defaultCreatedBy;
      const modifiedBy =
        body.modifiedBy ||
        body.modified_by ||
        body.createdBy ||
        body.created_by ||
        this.defaultCreatedBy;
      const savedRows = await this.formulaRepository.saveRecord(
        'formula_versions',
        {
          ...(current ? { uuid: current.uuid } : {}),
          name: candidate.name,
          formula_text: candidate.formula_text,
          status: FormulaStatus.ACTIVE,
          created_by: createdBy,
          modified_by: modifiedBy,
        },
        {
          connection,
          uuidColumn: 'uuid',
          ...(current ? { expectedVersion: body.expectedVersion ?? body.expected_version } : {}),
        },
      );
      const saved = savedRows[0];
      const dependencyNames = [...new Set(extractExternalReferences(saved.formula_text))];
      await this.formulaRepository.saveFormulaDependencies(
        saved,
        dependencyNames,
        saved.created_by,
        connection,
      );
      return saved;
    });
  }

  async deactivate(uuid, body) {
    return this.formulaRepository.withFormulaWriteLock(async (connection) => {
      const current = await this.formulaRepository.getCurrentByUuid(uuid, connection);
      if (!current) throw new AppError(404, 'FORMULA_NOT_FOUND', `Formula ${uuid} was not found.`);
      this.assertExpectedVersion(current, body.expectedVersion ?? body.expected_version);
      if (current.status === FormulaStatus.INACTIVE)
        throw new AppError(
          409,
          'ALREADY_INACTIVE',
          `Formula "${current.name}" is already inactive.`,
        );
      const formulas = await this.formulaRepository.listCurrent({ connection });
      const graph = this.dependencyResolver.resolve(
        formulas.filter((row) => row.status === FormulaStatus.ACTIVE),
        {},
        { strictInputs: false },
      );
      const impacted = this.dependencyResolver.getTransitiveDependents(current.name, graph);
      if (impacted.length && !body.force)
        throw new AppError(
          409,
          'DEPENDENTS_EXIST',
          `Deactivating "${current.name}" would break active formulas. Set force=true to proceed.`,
          impacted.map(({ uuid: itemUuid, name }) => ({ uuid: itemUuid, name })),
        );
      const [saved] = await this.formulaRepository.saveRecord(
        'formula_versions',
        {
          uuid,
          name: current.name,
          formula_text: current.formula_text,
          status: FormulaStatus.INACTIVE,
          created_by: current.created_by,
          modified_by: body.modifiedBy || body.modified_by || this.defaultCreatedBy,
        },
        {
          connection,
          uuidColumn: 'uuid',
          expectedVersion: body.expectedVersion ?? body.expected_version,
        },
      );
      return saved;
    });
  }

  async rollback(uuid, body) {
    return this.formulaRepository.withFormulaWriteLock(async (connection) => {
      const current = await this.formulaRepository.getCurrentByUuid(uuid, connection);
      if (!current) throw new AppError(404, 'FORMULA_NOT_FOUND', `Formula ${uuid} was not found.`);
      this.assertExpectedVersion(current, body.expectedVersion ?? body.expected_version);
      const target = await this.formulaRepository.getVersion(uuid, body.targetVersion, connection);
      if (!target)
        throw new AppError(
          404,
          'VERSION_NOT_FOUND',
          `Version ${body.targetVersion} was not found for formula ${uuid}.`,
        );

      const formulas = await this.formulaRepository.listCurrent({ connection });
      const currentActive = current.status === FormulaStatus.ACTIVE;
      const targetActive = target.status === FormulaStatus.ACTIVE;
      const isRenaming = current.name !== target.name;
      const breaksCurrentDependents = currentActive && (!targetActive || isRenaming);
      if (breaksCurrentDependents && !body.force) {
        const graph = this.dependencyResolver.resolve(
          formulas.filter((row) => row.status === FormulaStatus.ACTIVE),
          {},
          { strictInputs: false },
        );
        const impacted = this.dependencyResolver.getTransitiveDependents(current.name, graph);
        if (impacted.length)
          throw new AppError(
            409,
            'DEPENDENTS_EXIST',
            `Rollback would deactivate or rename "${current.name}" and may break active formulas. Set force=true to proceed.`,
            impacted.map(({ uuid: itemUuid, name }) => ({ uuid: itemUuid, name })),
          );
      }
      if (targetActive) {
        const duplicate = formulas.find(
          (row) =>
            row.status === FormulaStatus.ACTIVE && row.name === target.name && row.uuid !== uuid,
        );
        if (duplicate)
          throw new AppError(
            400,
            'FORMULA_NAME_EXISTS',
            `An active formula named "${target.name}" already exists.`,
            { uuid: duplicate.uuid },
          );
        const candidate = {
          uuid,
          name: target.name,
          formula_text: target.formula_text,
          status: FormulaStatus.ACTIVE,
        };
        await this.validationService.validateCandidate(candidate, formulas, {});
        const candidateGraph = formulas.filter(
          (row) => row.uuid !== uuid && row.status === FormulaStatus.ACTIVE,
        );
        candidateGraph.push(candidate);
        this.dependencyResolver.resolve(candidateGraph, {}, { strictInputs: false });
      }
      const [saved] = await this.formulaRepository.saveRecord(
        'formula_versions',
        {
          uuid,
          name: target.name,
          formula_text: target.formula_text,
          status: target.status,
          created_by: current.created_by,
          modified_by: body.modifiedBy || body.modified_by || this.defaultCreatedBy,
        },
        {
          connection,
          uuidColumn: 'uuid',
          expectedVersion: body.expectedVersion ?? body.expected_version,
        },
      );
      if (saved.status === FormulaStatus.ACTIVE) {
        await this.formulaRepository.saveFormulaDependencies(
          saved,
          [...new Set(extractExternalReferences(saved.formula_text))],
          saved.created_by,
          connection,
        );
      }
      return saved;
    });
  }

  async history(uuid) {
    const current = await this.formulaRepository.getCurrentByUuid(uuid);
    if (!current) throw new AppError(404, 'FORMULA_NOT_FOUND', `Formula ${uuid} was not found.`);
    return this.formulaRepository.getHistory(uuid);
  }

  impact(uuid) {
    return this.formulaRepository.getImpact(uuid);
  }

  assertExpectedVersion(current, expectedVersion) {
    if (!current) return;
    if (!Number.isInteger(expectedVersion))
      throw new AppError(
        400,
        'EXPECTED_VERSION_REQUIRED',
        'expectedVersion is required for changes.',
      );
    if (Number(current.version_number) !== Number(expectedVersion)) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        'The formula has changed since the supplied version was read.',
        {
          expectedVersion,
          currentVersion: current.version_number,
          currentFormula: {
            uuid: current.uuid,
            name: current.name,
            version: current.version_number,
            status: current.status,
            rowInsertedAt: current.row_inserted_at,
          },
        },
      );
    }
  }
}
module.exports = FormulaService;
