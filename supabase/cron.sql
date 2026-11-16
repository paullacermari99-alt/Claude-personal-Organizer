-- Ejecuta la función de avisos cada minuto. Sustituye PROJECT_REF y CRON_SECRET.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('p-organizer-reminders') where exists (select 1 from cron.job where jobname = 'p-organizer-reminders');
select cron.schedule('p-organizer-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/reminders',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
-- Limpieza semanal de avisos antiguos
select cron.schedule('p-organizer-cleanup', '0 4 * * 1', $$ delete from public.sent_reminders where sent_at < now() - interval '14 days'; $$);
