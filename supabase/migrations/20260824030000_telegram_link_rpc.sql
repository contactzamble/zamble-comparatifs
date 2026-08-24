-- Génère un jeton de liaison Telegram éphémère (15 min) pour l'utilisateur
-- connecté. Appelée depuis le tableau de bord avant d'ouvrir le lien profond
-- https://t.me/ZambleAlertesBot?start=<token>.
create or replace function public.request_telegram_link()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_token uuid := gen_random_uuid();
begin
  update public.notification_preferences
  set telegram_link_token = new_token,
      telegram_link_token_expires_at = now() + interval '15 minutes'
  where user_id = auth.uid();

  return new_token;
end;
$$;

grant execute on function public.request_telegram_link() to authenticated;
