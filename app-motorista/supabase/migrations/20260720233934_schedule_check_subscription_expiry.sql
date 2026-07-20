create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'check-subscription-expiry-daily',
  '0 12 * * *',
  $$
  select net.http_post(
    url := 'https://ucxkvxqpkknxotbfxgeu.supabase.co/functions/v1/check-subscription-expiry',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_nXG_CAAUPfX__0xhISx5mQ_bfI-Y1EY',
      'apikey', 'sb_publishable_nXG_CAAUPfX__0xhISx5mQ_bfI-Y1EY',
      'Content-Type', 'application/json'
    )
  );
  $$
);
