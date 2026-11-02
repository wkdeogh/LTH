-- Supabase Cron provides minute scheduling on the existing database.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
-- net is not an exposed Data API schema. Its queue briefly contains the
-- authorization header; database login credentials remain administrator-only.
