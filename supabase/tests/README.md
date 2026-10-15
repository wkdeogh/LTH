# Database regression tests

Apply `supabase/schema.sql` to an empty, disposable PostgreSQL test database with a `service_role` role, then run:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/main_strategy.sql
```

The test checks first-strategy selection, unique main selection, protected archive/delete, atomic switching, and invalid or archived targets using `service_role`. It refuses a non-empty database and rolls back its fixtures.

Also run `reliable_strategy_workflow.sql` and `strategy_cash_flows.sql` in the same disposable database. Cash-flow regression covers immediate deposits/withdrawals, T recalculation, retries, stale versions, overdrafts, pending application on compound/simple round closure, and restoring pending flows when the closing execution is cancelled. All fixtures roll back.

For an existing deployment, apply only `supabase/migrations/202610150001_strategy_cash_flows.sql` before deploying the cash-flow UI. Do not replay the full schema on a populated production database.
