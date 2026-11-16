-- P Organizer: tablas y reglas de seguridad (cada usuario solo ve lo suyo).
-- Pegar en Supabase → SQL Editor → Run.

create table if not exists public.organizer_state (
  user_id uuid primary key references auth.users on delete cascade default auth.uid(),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.organizer_state enable row level security;
drop policy if exists "own state" on public.organizer_state;
create policy "own state" on public.organizer_state for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Avisos ya enviados (solo los usa la función del servidor)
create table if not exists public.sent_reminders (
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.sent_reminders enable row level security;
