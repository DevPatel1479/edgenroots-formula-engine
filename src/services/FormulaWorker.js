const vm = require('node:vm');
const path = require('node:path');

const packageDir = path.dirname(require.resolve('formula-interpreter'));
const functionMap = require(path.join(packageDir, 'funcMapping.json'));

function prepareFormula(formula, libraries = []) {
  let source = formula;

  for (const library of libraries) {
    for (const name of Object.keys(functionMap[library] || {})) {
      source = source.replace(new RegExp(`\\b${name}\\b`, 'g'), `${library}.${name}`);
    }
  }

  return source;
}

process.on('message', (job) => {
  if (!job || job.type !== 'evaluate') return;

  try {
    const { id, formula, variables, libraries = [], timeoutMs = 1000 } = job;
    const sandbox = { EXTERNAL_VAR: variables };

    for (const library of libraries) {
      sandbox[library] = require(path.join(packageDir, 'libraries', library, 'index'));
    }

    const prepared = prepareFormula(formula, libraries);
    const script = `(function (EXTERNAL_VAR) {
      ${prepared}
    })(EXTERNAL_VAR)`;

    const result = vm.runInNewContext(script, sandbox, {
      timeout: timeoutMs,
    });

    process.send({
      id,
      result: { status: 1, data: result },
    });
  } catch (error) {
    process.send({
      id: job.id,
      result: { status: 0, error: error.message },
    });
  }
});
