-- Provision lth_meritz_cron_secret through Vault before applying this file.
-- It must match the main lth project's CRON_SECRET; never put its value here.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'lth_meritz_cron_secret') then
    raise exception 'Configure lth_meritz_cron_secret in Supabase Vault first';
  end if;
end;
$$;

-- Candidate UTC times cover both US DST and standard time. The application
-- checks New York time, holidays, broker market status and each strategy toggle.
select cron.schedule('lth-meritz-open-dst', '30 13 * * 1-5', $job$
  select net.http_get(
    url := 'https://lth-six.vercel.app/api/cron/meritz-open',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'lth_meritz_cron_secret')),
    timeout_milliseconds := 300000);
$job$);
select cron.schedule('lth-meritz-open-standard', '30 14 * * 1-5', $job$
  select net.http_get(
    url := 'https://lth-six.vercel.app/api/cron/meritz-open',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'lth_meritz_cron_secret')),
    timeout_milliseconds := 300000);
$job$);
select cron.schedule('lth-meritz-watchdog-dst', '35 13 * * 1-5', $job$
  select net.http_get(
    url := 'https://lth-six.vercel.app/api/cron/meritz-open?watchdog=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'lth_meritz_cron_secret')),
    timeout_milliseconds := 300000);
$job$);
select cron.schedule('lth-meritz-watchdog-standard', '35 14 * * 1-5', $job$
  select net.http_get(
    url := 'https://lth-six.vercel.app/api/cron/meritz-open?watchdog=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'lth_meritz_cron_secret')),
    timeout_milliseconds := 300000);
$job$);
