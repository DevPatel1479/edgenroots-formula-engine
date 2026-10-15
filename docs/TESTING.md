# Quick test plan

1. Run `npm test`. This is a local unit-test suite and does not require MySQL.
2. Run `npm run verify:env`. This requires `.env`, the MySQL schema, one of the current-formula views, and the installed `formula-interpreter` package.
3. Start the API with `npm start` in terminal 1.
4. Run `npm run smoke` in terminal 2. It verifies forward references and the `200 / 36 / 236` acceptance scenario.
5. Test stale writes: create a formula, then send two `POST /formulas` changes with the same `uuid` and `expectedVersion`; expect one `200` and one `409`.
6. Test deactivation guard: create `commission`, create `total` referencing it, then deactivate `commission` without `force`; expect `409 DEPENDENTS_EXIST` listing `total`.
7. Test cycle guard: create `a` reading `b`, create `b` reading `c`, then attempt `c` reading `a`; expect `400 DEPENDENCY_CYCLE` with path `a -> b -> c -> a`.
8. Test as-of: change a formula, then preview with an ISO timestamp earlier than the change row's `row_inserted_at`; confirm the old version is used.
9. Test 500 records and 10 formulas using `POST /formulas/preview/bulk`; confirm `metrics.totalTimeMs` is below 30000 on the target laptop.
10. Do not remove test rows from business tables; use a separate disposable database for destructive database experiments.
