# Edgenroots Formula Engine Service

A versioned formula engine built with **Node.js, Express, MySQL 8, and the `formula-interpreter` package**. Formula data is append-only: creating, changing, deactivating, or rolling back a formula inserts a new row. Preview results include status, result, calculation details, a final record with computed values, run logs, and timing metrics.

> **Important:** `formula-interpreter` is deliberately called only through `src/services/FormulaInterpreterAdapter.js`. Run `npm run verify:env` after installing dependencies. It prints the installed package's raw response for the assignment's sample formula and confirms that the adapter and this specific installed version agree on argument order and result shape.

## Requirements

- Node.js 20 or newer and npm.
- MySQL 8.0 or newer, running locally.
- The `mysql` command-line client available in PowerShell / your terminal.
- Access to install the npm packages used in `package.json`, including `formula-interpreter`.

## 1. Download, configure, and start on Windows PowerShell

Open PowerShell in the project directory.

```powershell
# 1) Confirm installed tools
node --version
npm --version
mysql --version

# 2) Install Node dependencies
npm install

# 3) Create the database and append-only tables
cmd /c "mysql -u root -p < sql\schema.sql"

# 4) Choose ONE implementation of the current-formula view.
# Recommended for MySQL 8:
cmd /c "mysql -u root -p edgenroots_formula_engine < sql\views_window.sql"
# Alternative (if you want the aggregate-subquery implementation):
# cmd /c "mysql -u root -p edgenroots_formula_engine < sql\views_aggregate.sql"

# 5) Create local environment configuration
Copy-Item .env.example .env
notepad .env

# 6) Run automated unit tests
npm test

# 7) Check MySQL, current_formulas, and the installed formula-interpreter package
npm run verify:env

# 8) Start the API (keep this terminal open)
npm start
```

In `.env`, set `DB_USER`, `DB_PASSWORD`, `DB_HOST`, and `DB_PORT` for your local MySQL installation. Keep `DB_NAME=edgenroots_formula_engine` unless you also change the database name in the SQL files. Do not commit `.env`.

When you see `Edgenroots Formula Engine listening on http://localhost:3000`, open a **second** PowerShell terminal in the project folder and run:

```powershell
npm run smoke
# Optional: benchmark exactly 500 records × 10 formulas
npm run benchmark:bulk
```

The smoke script creates three uniquely named demo formulas and previews them using `amount = 2000` and `rate = 10`. It intentionally **does not delete** these rows because deleting business history violates the assignment's insert-only rule.

## 2. Configuration

| Variable                  |                     Default | Purpose                                                    |
| ------------------------- | --------------------------: | ---------------------------------------------------------- |
| `PORT`                    |                      `3000` | HTTP port                                                  |
| `DB_HOST`                 |                 `127.0.0.1` | MySQL host                                                 |
| `DB_PORT`                 |                      `3306` | MySQL port                                                 |
| `DB_USER`                 |                      `root` | MySQL user                                                 |
| `DB_PASSWORD`             |                       empty | MySQL password; set your local password in `.env`          |
| `DB_NAME`                 | `edgenroots_formula_engine` | Database containing the schema and view                    |
| `FORMULA_TIMEOUT_MS`      |                      `1000` | Per-formula timeout in milliseconds                        |
| `FORMULA_CONCURRENCY`     |                         `8` | Maximum simultaneous formula interpreter calls             |
| `BULK_RECORD_CONCURRENCY` |                         `4` | Maximum records evaluated concurrently during bulk preview |
| `MAX_BULK_RECORDS`        |                       `500` | Maximum records allowed per bulk request                   |
| `DEFAULT_CREATED_BY`      |         `admin@example.com` | Default audit identity                                     |

## 3. Database design and SQL files

- `sql/schema.sql` creates the database and tables: `formula_versions`, `formula_dependencies`, and `formula_run_logs`. It also defines indexes.
- `sql/views_window.sql` creates `current_formulas` using `ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id DESC)`.
- `sql/views_aggregate.sql` creates the same view using a `MAX(id)` aggregate subquery. **Use one view file**; both define the same view name.
- `sql/queries.sql` contains all seven reporting queries required by the assignment. Set `@formula_uuid` before running report 1.

To run the reports:

```powershell
cmd /c "mysql -u root -p edgenroots_formula_engine < sql\queries.sql"
```

### Why the window-function view is the default

Both implementations return exactly one latest row per logical UUID. The window-function version makes the selection rule explicit and is easy to extend with other per-version ranking needs. The aggregate-subquery version is also supplied and is valid when a simple maximum ID join is preferred. In either case, `id` is the ordering authority for current rows, as required by the assignment.

### Index decisions

- `(uuid, id)` / `(uuid, version_number)` support current-version lookup and history.
- `(name, status, id)` supports active-name validation and current formula reads.
- `(status, row_inserted_at)` and `(row_inserted_at)` help as-of selection and recent activity filters.
- `formula_dependencies(owner_formula_version_id)` finds dependencies recorded for a specific formula version; `depends_on_name` supports dependency and impact traversals.
- `formula_run_logs(run_uuid)` retrieves one preview run; `(row_inserted_at, status)` and `(formula_uuid, row_inserted_at)` support recent failure reports.

## 4. API endpoints

All assignment paths are exposed at the root exactly as specified. The same routes are also available under `/api` as an alias. JSON errors use the same shape: `{ "error": { "code": "...", "message": "...", "requestId": "...", "details": ... } }`.

Base URL: `http://localhost:3000`.

### Health check

```powershell
curl.exe http://localhost:3000/health
```

### Create a formula — `POST /formulas`

Formula text is JavaScript text ending in `return`. References to request inputs or other formula results use `EXTERNAL_VAR.name`.

```powershell
curl.exe -X POST http://localhost:3000/formulas `
  -H "Content-Type: application/json" `
  -d '{"name":"commission","formulaText":"return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;","sampleData":{"amount":2000,"rate":10},"createdBy":"admin@example.com"}'
```

Copy the returned `uuid` and `version_number` for the subsequent examples.

### List current formulas — `GET /formulas`

```powershell
curl.exe http://localhost:3000/formulas
```

Returns one latest version per UUID from the `current_formulas` view, including inactive current versions.

### Change a formula — `POST /formulas`

Send the stable UUID and the version last read. A stale `expectedVersion` returns HTTP `409` and current version details.

```powershell
curl.exe -X POST http://localhost:3000/formulas `
  -H "Content-Type: application/json" `
  -d '{"uuid":"PASTE_UUID_HERE","expectedVersion":1,"name":"commission","formulaText":"return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;","modifiedBy":"admin@example.com"}'
```

### Deactivate a formula — `POST /formulas/:uuid/deactivate`

```powershell
curl.exe -X POST http://localhost:3000/formulas/PASTE_UUID_HERE/deactivate `
  -H "Content-Type: application/json" `
  -d '{"expectedVersion":2,"modifiedBy":"admin@example.com"}'
```

If active formulas depend on it, deactivation returns `409 DEPENDENTS_EXIST` and includes those formulas. Use `"force": true` only when the breaking change is intentional.

### Roll back to an old version — `POST /formulas/:uuid/rollback`

Rollback copies the target version's formula/name/status into a **new** row; it never rewrites the old version.

```powershell
curl.exe -X POST http://localhost:3000/formulas/PASTE_UUID_HERE/rollback `
  -H "Content-Type: application/json" `
  -d '{"expectedVersion":3,"targetVersion":1,"modifiedBy":"admin@example.com"}'
```

### History — `GET /formulas/:uuid/history`

```powershell
curl.exe http://localhost:3000/formulas/PASTE_UUID_HERE/history
```

### Impact — `GET /formulas/:uuid/impact`

```powershell
curl.exe http://localhost:3000/formulas/PASTE_UUID_HERE/impact
```

Lists active formulas that directly or transitively depend on the target, with a `direct` flag for direct dependencies.

### Preview one record — `POST /formulas/preview`

```powershell
curl.exe -X POST http://localhost:3000/formulas/preview `
  -H "Content-Type: application/json" `
  -d '{"data":{"amount":2000,"rate":10},"createdBy":"preview-client"}'
```

An optional `formulaUuids` array selects formulas plus their dependencies. When omitted (or empty), all active formulas are evaluated. Optional `asOf` must be an ISO-8601 timestamp, for example `"2026-10-15T10:00:00.000Z"`. The response includes each formula's version, status, result, explanation, error/duration, and a final `record` with successful formula values added.

### Bulk preview — `POST /formulas/preview/bulk`

```powershell
curl.exe -X POST http://localhost:3000/formulas/preview/bulk `
  -H "Content-Type: application/json" `
  -d '{"records":[{"amount":2000,"rate":10},{"amount":500,"rate":8}],"createdBy":"bulk-client"}'
```

The endpoint accepts 1–500 records, uses one consistent formula snapshot for the request, validates all records before evaluation, writes run logs in one multi-row insert, and reports total/average time, failures, skipped results, records processed, and formula run count.

## 5. Acceptance scenario: commission, tax, total

The assignment specifically requires formulas to work if created in the order `total`, `tax`, `commission`. `npm run smoke` runs this scenario with unique demo formula names, so it can be run repeatedly without name collisions:

- `commission = amount * rate / 100` → `200.00`
- `tax = commission * 0.18` → `36.00`
- `total = commission + tax` → `236.00`

The resolver builds the graph from `EXTERNAL_VAR` references; it does not rely on insertion order or a hand-maintained sort.

## 6. Tests and verification

Run all automated tests:

```powershell
npm test
```

### Automated test report

Generate a plain-text TAP report for the complete automated test suite using the Node.js built-in test runner. The report contains individual test results, the final pass/fail counts, and the execution duration.

The generated report is saved at [`reports/npm-test-report.txt`](reports/npm-test-report.txt). Regenerate it after code or test changes so it reflects the latest test execution.

The Node built-in test suite covers:

- Two-decimal rounding and floating-point noise.
- Dependency ordering, missing inputs, selected dependency closure, and full cycle path.
- Normalization of numeric status `0`, successful result explanations, interpreter failures, and timeout handling.
- Failed formula / skipped dependent / independent formula still succeeds.
- Bulk record limit.
- Generic insert-only save: create version 1, change to version 2 while preserving original creation metadata, batch arrays with one INSERT, and stale-version conflict.
- Two simultaneous changes against the same expected version: one success and one `409`.

Then run the real local integration checks in order:

```powershell
npm run verify:env
# With the server running in another terminal:
npm run smoke
```

`npm run verify:env` must show a successful MySQL connection, the `current_formulas` view, the full raw interpreter response, and a calculated result of `200`. If it fails, do not assume the API works: inspect the displayed package response and verify its installed `interpretor()` signature in `src/services/FormulaInterpreterAdapter.js`.

The assignment's performance target is 500 records × 10 formulas within 30 seconds. Run `npm run benchmark:bulk` to create 10 unique formula rules and submit exactly 500 records (5,000 formula runs). It prints `metrics.totalTimeMs`, verifies the record/run counts, and exits with failure if the 30,000 ms target is exceeded on your local machine. The target cannot be guaranteed without running it on the target laptop with the actual interpreter package and MySQL setup.

## 7. Implementation and design decisions

### Insert-only write gateway

`VersionedRepository.saveRecord(tableName, data, options)` is the only application code path that executes `INSERT`. It checks SQL identifiers, discovers a table's columns, makes values parameterized, generates UUIDs for new logical records, merges the current row when a UUID is supplied, preserves `first_created_at` and `created_by`, increments `version_number` where that column exists, supports arrays using one multi-row insert, and returns inserted IDs/UUIDs. SQL identifiers are validated because parameter placeholders cannot bind table or column identifiers.

### Concurrency

All formula writes run inside `FormulaRepository.withFormulaWriteLock()`. MySQL's connection-scoped `GET_LOCK()` serializes writes across service instances. Inside the lock, the service reads the current version and checks `expectedVersion`; a request based on an old version returns `409 VERSION_CONFLICT`. The new version is appended before releasing the lock. This closes the race where both requests read the same version and both append updates.

### Dependency and failure handling

Formula dependencies are extracted from `EXTERNAL_VAR.name` references. References that match active formula names become graph edges; remaining references must exist in the input record at preview time. DFS detects cycles and produces a complete path. Independent formulas in each level run concurrently. A failed result is recorded as `FAILED`; its dependents become `SKIPPED`, but formulas on independent branches still run.

### As-of behavior

The preview service loads the most recent row per UUID whose `row_inserted_at` is at or before the supplied timestamp and filters that snapshot to active formulas. Every record in a bulk request uses the same loaded snapshot.

### Known environmental boundary

The source project and unit tests can be prepared here, but actual `formula-interpreter` behavior and the 500×10 performance target depend on the exact package version, local Node installation, and local MySQL runtime. The included `verify:env` and `smoke` scripts are intended to prove those integration points on your machine instead of treating them as already verified.

## 8. Insert-only storage: benefits, costs, and scale

See [`docs/insert-only-answer.md`](docs/insert-only-answer.md) for the requested 15-line written answer about append-only versioning.

## 9. Testing Checklist

See [`docs/TESTING.md`](docs/TESTING.md) for manual verification steps for the API, concurrency, dependencies, as-of previews, and bulk performance.

## 10. Postman Collection

The exported Postman collection contains API requests for testing the Edgenroots Formula Engine, including formula creation, updates, deactivation, rollback, history, dependency impact, single-record preview, and bulk preview.

[`View Collection`](postman/Edgenroots_Updated_Api.postman_collection.json)

### Import and run

1. Download or clone this project repository.
2. Open Postman and select **Import**.
3. Select `postman/Edgenroots_Updated_Api.postman_collection.json`.
4. Start the API locally using `npm start`.
5. Configure the collection's base URL as `http://localhost:3000`.
6. Run the requests against the local API.

The collection is provided as a JSON file so reviewers can import and execute the requests without requiring access to the author's Postman workspace.

**Note:** Requests that create or modify formulas and previews may append records to the configured MySQL database. Use the project's local database when testing.
