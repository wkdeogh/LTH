# Database regression tests

Apply `supabase/schema.sql` to an empty, disposable PostgreSQL test database with a `service_role` role, then run:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/main_strategy.sql
```

The test checks first-strategy selection, unique main selection, protected archive/delete, atomic switching, and invalid or archived targets using `service_role`. It refuses a non-empty database and rolls back its fixtures.
