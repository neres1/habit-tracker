-- Habit Tracker — esquema inicial
-- Cada evento do Google Agenda ou task do Google Tasks vira uma linha em "activities".
-- A sincronização atualiza só os campos vindos do Google; status, nota e observação
-- pertencem ao usuário e nunca são sobrescritos.

create table if not exists public.activities (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source         text not null check (source in ('calendar', 'tasks')),
  external_id    text not null,            -- "<agenda ou lista>:<id no Google>"
  series_key     text not null,            -- agrupa ocorrências da mesma atividade (ex.: "calendar:aula de cálculo ii")
  container_id   text,                     -- id da agenda ou da lista de tarefas
  container_name text,                     -- nome da agenda ou da lista de tarefas
  title          text not null,
  description    text,
  location       text,
  day            date not null,            -- dia local da atividade
  start_at       timestamptz,
  end_at         timestamptz,
  all_day        boolean not null default false,
  status         text not null default 'pending' check (status in ('pending', 'done')),
  rating         smallint check (rating between 1 and 10),
  note           text,
  completed_at   timestamptz,
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint activities_unique_external unique (user_id, source, external_id),
  constraint activities_rating_when_done check ((status = 'done') = (rating is not null))
);

create index if not exists activities_user_day_idx on public.activities (user_id, day);
create index if not exists activities_user_series_idx on public.activities (user_id, series_key);

create table if not exists public.user_settings (
  user_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  last_synced_at timestamptz,
  updated_at     timestamptz not null default now()
);

-- Segurança por linha: cada usuário só enxerga e altera os próprios dados.
alter table public.activities enable row level security;
alter table public.user_settings enable row level security;

create policy "activities_select_own" on public.activities
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "activities_insert_own" on public.activities
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "activities_update_own" on public.activities
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "activities_delete_own" on public.activities
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "settings_select_own" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "settings_insert_own" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "settings_update_own" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
