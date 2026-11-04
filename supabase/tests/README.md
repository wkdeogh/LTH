# Database regression tests

Run current single-strategy and broker/cash regressions in isolated PGlite:
npm run test:broker
node --import tsx --test src/lib/trading/*.test.ts

singleStrategy.test.ts preserves the current strategy state and archived history, verifies creation/symbol/split/archive/delete protection, removes obsolete main/sort metadata, and exercises deposits, withdrawals and round-close cash reconciliation under the policy.

The disposable database uses supabase/schema.sql before fixtures and migrations. For existing deployments apply the cash reconciliation migration, deploy and verify the new app, then apply 20261104231407_single_soxl_strategy.sql to remove obsolete columns. Do not replay the base schema on production.

reliable_strategy_workflow.sql and strategy_cash_flows.sql remain isolated regression fixtures for the historical workflow. Their broader fixture setup is not a supported production strategy-creation path.
