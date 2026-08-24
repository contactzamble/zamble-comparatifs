-- Zamble Comparatifs v2 — comptes, historique de prix, alertes
-- Schéma initial : profils, préférences de notification, catalogue suivable,
-- historique de prix, suivis utilisateur, journal d'alertes.

-- 1. profils : extension 1:1 de auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

-- 2. préférences de notification : canal choisi + liaison Telegram
create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  telegram_enabled boolean not null default false,
  telegram_chat_id text,
  telegram_link_token uuid,
  telegram_link_token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- 3. pendant "machine" d'une fiche produit markdown (source, identifiant stable, dernier prix connu)
create table public.trackable_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  source text not null check (source in ('amazon', 'ebay')),
  external_id text not null,
  first_seen_price numeric(10,2) not null,
  last_price numeric(10,2) not null,
  last_checked_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

-- 4. historique de prix : série temporelle en écriture seule (append-only)
create table public.price_history (
  id bigint generated always as identity primary key,
  trackable_item_id uuid not null references public.trackable_items(id) on delete cascade,
  price numeric(10,2) not null,
  checked_at timestamptz not null default now()
);
create index price_history_item_time_idx on public.price_history (trackable_item_id, checked_at desc);

-- 5. suivi d'un utilisateur sur un trackable_item, avec prix cible optionnel
create table public.tracked_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trackable_item_id uuid not null references public.trackable_items(id) on delete cascade,
  target_price numeric(10,2),
  alert_threshold_pct numeric(5,2) not null default 5.00,
  last_alerted_price numeric(10,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, trackable_item_id)
);

-- 6. journal des alertes réellement envoyées — base du futur "économies réalisées"
create table public.alert_log (
  id bigint generated always as identity primary key,
  tracked_item_id uuid not null references public.tracked_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'telegram')),
  previous_price numeric(10,2) not null,
  price_at_alert numeric(10,2) not null,
  first_seen_price numeric(10,2) not null,
  sent_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent', 'failed'))
);

-- RLS

alter table public.profiles enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.trackable_items enable row level security;
alter table public.price_history enable row level security;
alter table public.tracked_items enable row level security;
alter table public.alert_log enable row level security;

create policy "profiles_select_public" on public.profiles for select using (true);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "notification_prefs_own" on public.notification_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "trackable_items_select_public" on public.trackable_items for select using (true);

create policy "price_history_select_public" on public.price_history for select using (true);

create policy "tracked_items_select_own" on public.tracked_items for select using (auth.uid() = user_id);
create policy "tracked_items_insert_own" on public.tracked_items for insert with check (auth.uid() = user_id);
create policy "tracked_items_update_own" on public.tracked_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tracked_items_delete_own" on public.tracked_items for delete using (auth.uid() = user_id);

create policy "alert_log_select_own" on public.alert_log for select using (auth.uid() = user_id);

-- Création automatique de profile + notification_preferences à l'inscription

create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data->>'display_name')
  on conflict (id) do nothing;
  insert into public.notification_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
