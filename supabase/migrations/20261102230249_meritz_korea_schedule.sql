-- Main LTH only. Korea 22:00 = UTC 13:00; Korea 03:00 next day = UTC 18:00.
-- Never copy these schedules into a separate shared deployment.
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname in (
    'lth-meritz-open-dst','lth-meritz-open-standard','lth-meritz-watchdog-dst','lth-meritz-watchdog-standard')
  loop perform cron.unschedule(j.jobid); end loop;
end;
$$;
select cron.schedule('lth-meritz-first-22', '0 13 * * 1-5', $job$
  select net.http_get(url := 'https://lth-six.vercel.app/api/cron/meritz-open',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='lth_meritz_cron_secret')),
    timeout_milliseconds := 300000);
$job$);
select cron.schedule('lth-meritz-first-watchdog', '5 13 * * 1-5', $job$
  select net.http_get(url := 'https://lth-six.vercel.app/api/cron/meritz-open?watchdog=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='lth_meritz_cron_secret')),
    timeout_milliseconds := 300000);
$job$);
select cron.schedule('lth-meritz-reprice-03', '0 18 * * 1-5', $job$
  select net.http_get(url := 'https://lth-six.vercel.app/api/cron/meritz-reprice',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='lth_meritz_cron_secret')),
    timeout_milliseconds := 300000);
$job$);
select cron.schedule('lth-meritz-reprice-watchdog', '5 18 * * 1-5', $job$
  select net.http_get(url := 'https://lth-six.vercel.app/api/cron/meritz-reprice?watchdog=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='lth_meritz_cron_secret')),
    timeout_milliseconds := 300000);
$job$);
