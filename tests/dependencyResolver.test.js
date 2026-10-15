const test = require('node:test');
const assert = require('node:assert/strict');
const DependencyResolver = require('../src/services/DependencyResolver');

test('dependency resolver orders a formula chain independently of creation order', () => {
  const formulas = [
    {
      uuid: 'total-id',
      name: 'total',
      formula_text: 'return EXTERNAL_VAR.commission + EXTERNAL_VAR.tax;',
      status: 'ACTIVE',
    },
    {
      uuid: 'tax-id',
      name: 'tax',
      formula_text: 'return EXTERNAL_VAR.commission * 0.18;',
      status: 'ACTIVE',
    },
    {
      uuid: 'commission-id',
      name: 'commission',
      formula_text: 'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;',
      status: 'ACTIVE',
    },
  ];
  const graph = new DependencyResolver().resolve(formulas, { amount: 2000, rate: 10 });
  assert.deepEqual(
    graph.levels.map((level) => level.map((formula) => formula.name)),
    [['commission'], ['tax'], ['total']],
  );
});

test('dependency resolver reports complete cycle path', () => {
  const formulas = [
    { uuid: 'a', name: 'a', formula_text: 'return EXTERNAL_VAR.b + 1;', status: 'ACTIVE' },
    { uuid: 'b', name: 'b', formula_text: 'return EXTERNAL_VAR.c + 1;', status: 'ACTIVE' },
    { uuid: 'c', name: 'c', formula_text: 'return EXTERNAL_VAR.a + 1;', status: 'ACTIVE' },
  ];
  assert.throws(
    () => new DependencyResolver().resolve(formulas, {}, { strictInputs: false }),
    (error) => {
      assert.equal(error.code, 'DEPENDENCY_CYCLE');
      assert.deepEqual(error.details.path, ['a', 'b', 'c', 'a']);
      return true;
    },
  );
});

test('dependency resolver catches absent input before evaluation', () => {
  const formulas = [
    {
      uuid: 'x',
      name: 'x',
      formula_text: 'return EXTERNAL_VAR.missingField + 1;',
      status: 'ACTIVE',
    },
  ];
  assert.throws(
    () => new DependencyResolver().resolve(formulas, {}, { strictInputs: true }),
    (error) => error.code === 'MISSING_INPUTS',
  );
});

test('selected formula closure includes active dependencies', () => {
  const resolver = new DependencyResolver();
  const formulas = [
    { uuid: 'a-id', name: 'a', formula_text: 'return EXTERNAL_VAR.source + 1;', status: 'ACTIVE' },
    { uuid: 'b-id', name: 'b', formula_text: 'return EXTERNAL_VAR.a + 2;', status: 'ACTIVE' },
    { uuid: 'c-id', name: 'c', formula_text: 'return EXTERNAL_VAR.other + 2;', status: 'ACTIVE' },
  ];
  assert.deepEqual(
    resolver
      .selectDependencyClosure(formulas, ['b-id'])
      .map((f) => f.name)
      .sort(),
    ['a', 'b'],
  );
});
