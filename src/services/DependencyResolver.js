const AppError = require('../errors/AppError');
const { extractExternalReferences } = require('../utils/formulaText');

class DependencyResolver {
  extract(formula) {
    return extractExternalReferences(formula.formula_text ?? formula.formulaText ?? '');
  }

  resolve(formulas, inputRecord = {}, { strictInputs = true } = {}) {
    const active = formulas.filter((formula) => (formula.status || 'ACTIVE') === 'ACTIVE');
    const byName = new Map();
    for (const formula of active) {
      if (byName.has(formula.name) && byName.get(formula.name).uuid !== formula.uuid) {
        throw new AppError(
          400,
          'DUPLICATE_FORMULA_NAME',
          `More than one active formula is named "${formula.name}".`,
        );
      }
      byName.set(formula.name, formula);
    }

    const dependencies = new Map();
    const missingInputs = [];
    for (const formula of active) {
      const names = new Set();
      for (const reference of this.extract(formula)) {
        if (byName.has(reference)) names.add(reference);
        else if (!Object.prototype.hasOwnProperty.call(inputRecord, reference) && strictInputs) {
          missingInputs.push({ formula: formula.name, input: reference });
        }
      }
      dependencies.set(formula.name, names);
    }
    if (missingInputs.length) {
      throw new AppError(
        400,
        'MISSING_INPUTS',
        'Some formula references are neither active formulas nor fields in the input record.',
        missingInputs,
      );
    }

    const state = new Map();
    const stack = [];
    const levelByName = new Map();
    const visit = (name) => {
      const current = state.get(name) || 0;
      if (current === 2) return levelByName.get(name) || 0;
      if (current === 1) {
        const start = stack.indexOf(name);
        const path = [...stack.slice(start), name];
        throw new AppError(
          400,
          'DEPENDENCY_CYCLE',
          `Dependency loop detected: ${path.join(' -> ')}.`,
          { path },
        );
      }
      state.set(name, 1);
      stack.push(name);
      let level = 0;
      for (const dependency of dependencies.get(name) || [])
        level = Math.max(level, visit(dependency) + 1);
      stack.pop();
      state.set(name, 2);
      levelByName.set(name, level);
      return level;
    };
    for (const formula of active) visit(formula.name);

    const levels = [];
    for (const formula of active) {
      const level = levelByName.get(formula.name) || 0;
      levels[level] ||= [];
      levels[level].push(formula);
    }
    for (const level of levels) level?.sort((a, b) => a.name.localeCompare(b.name));
    return { formulas: active, byName, dependencies, levelByName, levels: levels.filter(Boolean) };
  }

  getTransitiveDependents(targetName, graph) {
    const found = new Map();
    const queue = [targetName];
    while (queue.length) {
      const dependencyName = queue.shift();
      for (const formula of graph.formulas) {
        if (found.has(formula.uuid) || formula.name === targetName) continue;
        if ((graph.dependencies.get(formula.name) || new Set()).has(dependencyName)) {
          found.set(formula.uuid, formula);
          queue.push(formula.name);
        }
      }
    }
    return [...found.values()];
  }

  selectDependencyClosure(formulas, requestedUuids) {
    if (!requestedUuids || requestedUuids.length === 0) return formulas;
    const byUuid = new Map(formulas.map((formula) => [formula.uuid, formula]));
    const requested = requestedUuids.map((uuid) => {
      const formula = byUuid.get(uuid);
      if (!formula)
        throw new AppError(
          400,
          'FORMULA_NOT_ACTIVE',
          `Formula ${uuid} is not active at the requested time.`,
        );
      return formula;
    });
    const byName = new Map(formulas.map((formula) => [formula.name, formula]));
    const included = new Map();
    const visit = (formula) => {
      if (included.has(formula.uuid)) return;
      included.set(formula.uuid, formula);
      for (const name of this.extract(formula)) {
        const dependency = byName.get(name);
        if (dependency) visit(dependency);
      }
    };
    requested.forEach(visit);
    return [...included.values()];
  }
}
module.exports = DependencyResolver;
