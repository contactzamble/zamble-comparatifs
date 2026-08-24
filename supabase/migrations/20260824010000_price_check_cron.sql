-- Planification horaire du job de suivi de prix (check-prices).
-- Extensions et secret Vault (service_role_key) créés hors migration
-- (commande ponctuelle, pour ne jamais committer la clé en clair) — cette
-- migration ne fait que référencer le secret par son nom.

select
  cron.schedule(
    'check-prices-hourly',
    '0 * * * *',
    $$
    select net.http_post(
      url := 'https://zfsjhzvferimtvaegvsg.supabase.co/functions/v1/check-prices',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $$
  );
