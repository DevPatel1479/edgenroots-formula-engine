1. Insert-only versioning preserves a complete audit trail of every formula revision.
2. Each logical formula keeps one stable UUID while every revision receives a new row ID.
3. The current-formula view hides historical rows from ordinary reads.
4. Rollback creates a new version copied from an earlier revision instead of rewriting history.
5. This makes it possible to explain which rule produced a past financial result.
6. An as-of preview can select the latest row inserted before a requested timestamp.
7. Run logs retain the formula version, input, result, status, error, and calculation explanation.
8. The main cost is storage: formula text and metadata accumulate with every change.
9. Indexes also consume disk space and make inserts somewhat more expensive.
10. Queries over all historical versions become slower as the tables grow.
11. Keep the current-row view and common history queries supported by targeted indexes.
12. Partition large run-log tables by time if operational retention and query patterns justify it.
13. Archive older run logs to cheaper storage according to an approved retention policy.
14. Do not delete or mutate business formula history; archive it without changing its audit meaning.
15. Monitor query plans, index selectivity, table growth, and slow reports as version counts increase.
