-- Boldup · Amigos y proyectos compartidos (v69)
-- Pegar en Supabase → SQL Editor → Run. Solo AÑADE tablas y funciones nuevas:
-- no toca organizer_state, push_subscriptions ni las cuentas. Se puede ejecutar varias veces.
--
-- Qué hay aquí:
--   profiles        nick único (minúsculas, 3-20) + ID de amigo público (p. ej. BU-7KQ2MX)
--   friendships     solicitudes de amistad (pendiente / aceptada)
--   team_*          proyectos compartidos tipo Trello: miembros, columnas, tareas, objetivos,
--                   comentarios y actividad (la actividad la escriben los triggers, nadie a mano)
-- Seguridad (RLS): cada persona ve su perfil, el de sus amigos, el de quien le ha pedido amistad y
-- el de la gente con la que comparte proyecto. Un proyecto solo lo ven y lo tocan sus miembros.
-- Las acciones delicadas (elegir nick, pedir amistad, crear proyecto, invitar, salir) van por
-- funciones RPC que comprueban todo en el servidor.

-- ============ Perfiles (nick + ID de amigo) ============
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade default auth.uid(),
  username text not null,
  display_name text,
  friend_code text not null,
  avatar text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9][a-z0-9_.]{2,19}$'),
  constraint profiles_display_len check (display_name is null or char_length(display_name) between 1 and 40),
  constraint profiles_avatar_len check (avatar is null or char_length(avatar) <= 16),
  constraint profiles_color_fmt check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);
create unique index if not exists profiles_username_key on public.profiles (username);
create unique index if not exists profiles_friend_code_key on public.profiles (friend_code);
alter table public.profiles enable row level security;

-- ============ Amistades ============
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_not_self check (requester <> addressee)
);
create unique index if not exists friendships_pair_key on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee);
alter table public.friendships enable row level security;

-- ============ Proyectos compartidos ============
create table if not exists public.team_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  icon text check (icon is null or char_length(icon) <= 16),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  description text check (description is null or char_length(description) <= 2000),
  owner uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table if not exists public.team_members (
  project_id uuid not null references public.team_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  added_by uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists team_members_user_idx on public.team_members (user_id);
create table if not exists public.team_columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.team_projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  position double precision not null default 0,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists team_columns_project_idx on public.team_columns (project_id);
create table if not exists public.team_goals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.team_projects(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  notes text check (notes is null or char_length(notes) <= 2000),
  due date,
  done_at timestamptz,
  position double precision not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists team_goals_project_idx on public.team_goals (project_id);
create table if not exists public.team_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.team_projects(id) on delete cascade,
  column_id uuid references public.team_columns(id) on delete set null,
  goal_id uuid references public.team_goals(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 5000),
  assignee uuid references public.profiles(id) on delete set null,
  start_date date,
  due date,
  priority smallint not null default 0 check (priority between 0 and 2),
  checklist jsonb not null default '[]'::jsonb,
  position double precision not null default 0,
  done_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_tasks_dates check (start_date is null or due is null or start_date <= due)
);
create index if not exists team_tasks_project_idx on public.team_tasks (project_id);
-- (para quien instaló una versión anterior de este archivo)
alter table public.team_tasks add column if not exists checklist jsonb not null default '[]'::jsonb;
do $$ begin
  alter table public.team_tasks add constraint team_tasks_checklist_ok check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 50 and pg_column_size(checklist) < 16000);
exception when duplicate_object then null; end $$;
create index if not exists team_tasks_assignee_idx on public.team_tasks (assignee) where done_at is null;
create table if not exists public.team_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.team_tasks(id) on delete cascade,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists team_comments_task_idx on public.team_comments (task_id);
create table if not exists public.team_activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  task_id uuid,
  title text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists team_activity_project_idx on public.team_activity (project_id, id desc);

alter table public.team_projects enable row level security;
alter table public.team_members enable row level security;
alter table public.team_columns enable row level security;
alter table public.team_goals enable row level security;
alter table public.team_tasks enable row level security;
alter table public.team_comments enable row level security;
alter table public.team_activity enable row level security;

-- ============ Funciones de ayuda (SECURITY DEFINER: evitan recursión en RLS) ============
create or replace function public.is_team_member(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m where m.project_id = pid and m.user_id = auth.uid())
$$;
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships f where f.status = 'accepted'
    and least(f.requester, f.addressee) = least(a, b) and greatest(f.requester, f.addressee) = greatest(a, b))
$$;
-- ¿Puedo ver el perfil de «other»? (yo, amigos, solicitudes entre los dos, compañeros de proyecto)
create or replace function public.can_see_profile(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select other = auth.uid()
    or exists (select 1 from public.friendships f where least(f.requester, f.addressee) = least(other, auth.uid()) and greatest(f.requester, f.addressee) = greatest(other, auth.uid()))
    or exists (select 1 from public.team_members a join public.team_members b on a.project_id = b.project_id where a.user_id = auth.uid() and b.user_id = other)
$$;

-- ============ Políticas RLS ============
drop policy if exists "profiles visibles" on public.profiles;
create policy "profiles visibles" on public.profiles for select to authenticated using (public.can_see_profile(id));
drop policy if exists "profile propio" on public.profiles;
create policy "profile propio" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- (el perfil se crea con claim_username(); no hay política de insert directo)

drop policy if exists "amistades mias" on public.friendships;
create policy "amistades mias" on public.friendships for select to authenticated using ((select auth.uid()) in (requester, addressee));
drop policy if exists "borrar amistad" on public.friendships;
create policy "borrar amistad" on public.friendships for delete to authenticated using ((select auth.uid()) in (requester, addressee));

drop policy if exists "ver proyecto" on public.team_projects;
create policy "ver proyecto" on public.team_projects for select to authenticated using (public.is_team_member(id));
drop policy if exists "editar proyecto" on public.team_projects;
create policy "editar proyecto" on public.team_projects for update to authenticated using (public.is_team_member(id)) with check (public.is_team_member(id));
drop policy if exists "borrar proyecto" on public.team_projects;
create policy "borrar proyecto" on public.team_projects for delete to authenticated using (owner = (select auth.uid()));

drop policy if exists "ver miembros" on public.team_members;
create policy "ver miembros" on public.team_members for select to authenticated using (public.is_team_member(project_id));

do $$ declare t text; begin
  foreach t in array array['team_columns', 'team_goals', 'team_tasks'] loop
    execute format('drop policy if exists "miembros leen" on public.%I', t);
    execute format('create policy "miembros leen" on public.%I for select to authenticated using (public.is_team_member(project_id))', t);
    execute format('drop policy if exists "miembros crean" on public.%I', t);
    execute format('create policy "miembros crean" on public.%I for insert to authenticated with check (public.is_team_member(project_id))', t);
    execute format('drop policy if exists "miembros editan" on public.%I', t);
    execute format('create policy "miembros editan" on public.%I for update to authenticated using (public.is_team_member(project_id)) with check (public.is_team_member(project_id))', t);
    execute format('drop policy if exists "miembros borran" on public.%I', t);
    execute format('create policy "miembros borran" on public.%I for delete to authenticated using (public.is_team_member(project_id))', t);
  end loop;
end $$;

drop policy if exists "leer comentarios" on public.team_comments;
create policy "leer comentarios" on public.team_comments for select to authenticated using (public.is_team_member(project_id));
drop policy if exists "escribir comentario" on public.team_comments;
create policy "escribir comentario" on public.team_comments for insert to authenticated with check (public.is_team_member(project_id) and user_id = (select auth.uid()));
drop policy if exists "borrar mi comentario" on public.team_comments;
create policy "borrar mi comentario" on public.team_comments for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "leer actividad" on public.team_activity;
create policy "leer actividad" on public.team_activity for select to authenticated using (public.is_team_member(project_id));

-- ============ Triggers: coherencia + actividad ============
create or replace function public.team_log(pid uuid, k text, tid uuid, ttl text, det jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.team_activity (project_id, user_id, kind, task_id, title, detail) values (pid, auth.uid(), k, tid, ttl, det);
  update public.team_projects set updated_at = now() where id = pid;
$$;
revoke execute on function public.team_log(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.team_tasks_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare col_done boolean;
begin
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then raise exception 'No se puede mover una tarea a otro proyecto'; end if;
  if new.column_id is not null and not exists (select 1 from public.team_columns c where c.id = new.column_id and c.project_id = new.project_id) then
    raise exception 'La columna no es de este proyecto'; end if;
  if new.goal_id is not null and not exists (select 1 from public.team_goals g where g.id = new.goal_id and g.project_id = new.project_id) then
    raise exception 'El objetivo no es de este proyecto'; end if;
  if new.assignee is not null and not exists (select 1 from public.team_members m where m.project_id = new.project_id and m.user_id = new.assignee) then
    raise exception 'Solo puedes asignar tareas a miembros del proyecto'; end if;
  -- Mover a una columna «hecho» la completa; sacarla de ahí la reabre
  if tg_op = 'INSERT' or new.column_id is distinct from old.column_id then
    select c.is_done into col_done from public.team_columns c where c.id = new.column_id;
    if col_done then new.done_at := coalesce(new.done_at, now());
    elsif tg_op = 'UPDATE' and new.done_at is not null and old.done_at is not null then new.done_at := null; end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := now(); end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists team_tasks_guard on public.team_tasks;
create trigger team_tasks_guard before insert or update on public.team_tasks for each row execute function public.team_tasks_guard();

create or replace function public.team_tasks_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.team_log(new.project_id, 'task_created', new.id, new.title, null);
    return new;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.team_projects p where p.id = old.project_id) then
      perform public.team_log(old.project_id, 'task_deleted', old.id, old.title, null);
    end if;
    return old;
  end if;
  if new.done_at is not null and old.done_at is null then
    perform public.team_log(new.project_id, 'task_done', new.id, new.title, null);
  elsif new.done_at is null and old.done_at is not null then
    perform public.team_log(new.project_id, 'task_reopened', new.id, new.title, null);
  elsif new.column_id is distinct from old.column_id then
    perform public.team_log(new.project_id, 'task_moved', new.id, new.title,
      jsonb_build_object('column', (select c.name from public.team_columns c where c.id = new.column_id)));
  end if;
  if new.assignee is distinct from old.assignee then
    perform public.team_log(new.project_id, 'task_assigned', new.id, new.title, jsonb_build_object('to', new.assignee));
  end if;
  if new.due is distinct from old.due and new.due is not null then
    perform public.team_log(new.project_id, 'task_due', new.id, new.title, jsonb_build_object('due', new.due));
  end if;
  if new.title is distinct from old.title or new.notes is distinct from old.notes or new.goal_id is distinct from old.goal_id
    or new.start_date is distinct from old.start_date or new.priority is distinct from old.priority or new.position is distinct from old.position
    or new.checklist is distinct from old.checklist then
    update public.team_projects set updated_at = now() where id = new.project_id;
  end if;
  return new;
end $$;
drop trigger if exists team_tasks_log on public.team_tasks;
create trigger team_tasks_log after insert or update or delete on public.team_tasks for each row execute function public.team_tasks_log();

create or replace function public.team_goals_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then perform public.team_log(new.project_id, 'goal_created', null, new.title, null); return new; end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.team_projects p where p.id = old.project_id) then perform public.team_log(old.project_id, 'goal_deleted', null, old.title, null); end if;
    return old;
  end if;
  if new.project_id <> old.project_id then raise exception 'No se puede mover un objetivo a otro proyecto'; end if;
  if new.done_at is not null and old.done_at is null then perform public.team_log(new.project_id, 'goal_done', null, new.title, null);
  else update public.team_projects set updated_at = now() where id = new.project_id; end if;
  return new;
end $$;
drop trigger if exists team_goals_log on public.team_goals;
create trigger team_goals_log after insert or update or delete on public.team_goals for each row execute function public.team_goals_log();

create or replace function public.team_columns_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then raise exception 'No se puede mover una columna a otro proyecto'; end if;
  update public.team_projects set updated_at = now() where id = coalesce(new.project_id, old.project_id);
  return coalesce(new, old);
end $$;
drop trigger if exists team_columns_touch on public.team_columns;
create trigger team_columns_touch after insert or update or delete on public.team_columns for each row execute function public.team_columns_touch();

create or replace function public.team_comments_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.team_tasks;
begin
  select * into t from public.team_tasks where id = new.task_id;
  if t.id is null or t.project_id <> new.project_id then raise exception 'La tarea no es de este proyecto'; end if;
  perform public.team_log(new.project_id, 'comment', new.task_id, t.title, jsonb_build_object('body', left(new.body, 140)));
  return new;
end $$;
drop trigger if exists team_comments_log on public.team_comments;
create trigger team_comments_log after insert on public.team_comments for each row execute function public.team_comments_log();

-- El nombre del proyecto también deja rastro
create or replace function public.team_projects_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner <> old.owner and auth.uid() is not null and auth.uid() <> old.owner then raise exception 'Solo el creador puede ceder el proyecto'; end if;
  if new.owner <> old.owner and not exists (select 1 from public.team_members m where m.project_id = new.id and m.user_id = new.owner) then
    raise exception 'El nuevo responsable debe ser miembro'; end if;
  if new.name is distinct from old.name then
    insert into public.team_activity (project_id, user_id, kind, title, detail) values (new.id, auth.uid(), 'project_renamed', new.name, jsonb_build_object('from', old.name));
  end if;
  if new.archived_at is distinct from old.archived_at then
    insert into public.team_activity (project_id, user_id, kind, title) values (new.id, auth.uid(), case when new.archived_at is null then 'project_restored' else 'project_archived' end, new.name);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists team_projects_log on public.team_projects;
create trigger team_projects_log before update on public.team_projects for each row execute function public.team_projects_log();

-- ============ RPC: nick ============
create or replace function public.normalize_username(name text) returns text
language sql immutable set search_path = '' as $$ select lower(trim(both from coalesce(name, ''))) $$;

-- ¿Está libre? (también sin sesión, para el formulario de registro). Devuelve 'ok', 'taken', 'invalid' o 'reserved'
create or replace function public.username_status(name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare n text := public.normalize_username(name);
begin
  if n !~ '^[a-z0-9][a-z0-9_.]{2,19}$' then return 'invalid'; end if;
  if n in ('admin', 'administrador', 'root', 'soporte', 'support', 'boldup', 'oficial', 'official', 'moderador', 'staff', 'sistema', 'system', 'null', 'undefined', 'anonimo', 'anonymous', 'help', 'ayuda')
    then return 'reserved'; end if;
  if exists (select 1 from public.profiles p where p.username = n and p.id is distinct from auth.uid()) then return 'taken'; end if;
  return 'ok';
end $$;

create or replace function public.new_friend_code() returns text
language plpgsql volatile set search_path = '' as $$
declare abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := 'BU-';
    for i in 1..6 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.profiles p where p.friend_code = c);
  end loop;
  return c;
end $$;
revoke execute on function public.new_friend_code() from public, anon, authenticated;

-- Elige o cambia el nick. Crea el perfil (con ID de amigo) la primera vez.
create or replace function public.claim_username(name text, display text default null) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n text := public.normalize_username(name); st text; p public.profiles;
begin
  if me is null then raise exception 'Tienes que entrar en tu cuenta' using errcode = '28000'; end if;
  st := public.username_status(n);
  if st = 'invalid' then raise exception 'NICK_INVALID' using hint = 'De 3 a 20 letras minúsculas, números, punto o guion bajo'; end if;
  if st = 'reserved' then raise exception 'NICK_RESERVED'; end if;
  if st = 'taken' then raise exception 'NICK_TAKEN'; end if;
  display := nullif(trim(both from coalesce(display, '')), '');
  begin
    insert into public.profiles (id, username, display_name, friend_code) values (me, n, left(display, 40), public.new_friend_code())
    on conflict (id) do update set username = excluded.username, display_name = coalesce(excluded.display_name, public.profiles.display_name), updated_at = now()
    returning * into p;
  exception when unique_violation then raise exception 'NICK_TAKEN';
  end;
  return p;
end $$;

-- Busca a alguien por nick exacto o por ID de amigo (no deja listar a todo el mundo)
create or replace function public.find_user(q text)
returns table (id uuid, username text, display_name text, friend_code text, avatar text, color text, relation text)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); s text := upper(trim(both from coalesce(q, '')));
begin
  if me is null then raise exception 'Tienes que entrar en tu cuenta'; end if;
  s := regexp_replace(s, '^@', '');
  if s ~ '^BU-?[A-Z0-9]{6}$' then s := 'BU-' || right(s, 6); end if;
  return query
    select p.id, p.username, p.display_name, p.friend_code, p.avatar, p.color,
      case when p.id = me then 'me'
        when f.status = 'accepted' then 'friend'
        when f.status = 'pending' and f.requester = me then 'sent'
        when f.status = 'pending' then 'received'
        else 'none' end
    from public.profiles p
    left join public.friendships f on least(f.requester, f.addressee) = least(p.id, me) and greatest(f.requester, f.addressee) = greatest(p.id, me)
    where p.friend_code = s or p.username = lower(s)
    limit 1;
end $$;

-- ============ RPC: amistades ============
create or replace function public.send_friend_request(target uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); f public.friendships;
begin
  if me is null then raise exception 'Tienes que entrar en tu cuenta'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Primero elige tu nick'; end if;
  if target is null or target = me then raise exception 'No puedes añadirte a ti'; end if;
  if not exists (select 1 from public.profiles where id = target) then raise exception 'No existe ese usuario'; end if;
  select * into f from public.friendships x where least(x.requester, x.addressee) = least(me, target) and greatest(x.requester, x.addressee) = greatest(me, target);
  if f.id is not null then
    if f.status = 'accepted' then return 'friend'; end if;
    if f.requester = me then return 'sent'; end if;
    -- Te la había pedido él: se acepta
    update public.friendships set status = 'accepted', responded_at = now() where id = f.id;
    return 'friend';
  end if;
  if (select count(*) from public.friendships x where x.requester = me and x.status = 'pending') >= 50 then
    raise exception 'Tienes demasiadas solicitudes sin contestar'; end if;
  insert into public.friendships (requester, addressee) values (me, target);
  return 'sent';
end $$;

create or replace function public.respond_friend_request(request_id uuid, accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); f public.friendships;
begin
  select * into f from public.friendships where id = request_id;
  if f.id is null or f.addressee <> me or f.status <> 'pending' then raise exception 'Esta solicitud ya no está'; end if;
  if accept then update public.friendships set status = 'accepted', responded_at = now() where id = f.id; return 'friend'; end if;
  delete from public.friendships where id = f.id;
  return 'none';
end $$;

-- ============ RPC: proyectos compartidos ============
create or replace function public.create_team_project(p_name text, p_icon text default null, p_color text default null, p_description text default null, p_members uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); pid uuid; m uuid;
begin
  if me is null then raise exception 'Tienes que entrar en tu cuenta'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Primero elige tu nick'; end if;
  if (select count(*) from public.team_projects where owner = me) >= 100 then raise exception 'Has llegado al máximo de proyectos compartidos'; end if;
  insert into public.team_projects (name, icon, color, description, owner) values (trim(both from p_name), p_icon, p_color, nullif(trim(both from coalesce(p_description, '')), ''), me) returning id into pid;
  insert into public.team_members (project_id, user_id, role, added_by) values (pid, me, 'owner', me);
  insert into public.team_columns (project_id, name, position, is_done) values
    (pid, 'Por hacer', 1, false), (pid, 'En curso', 2, false), (pid, 'Hecho', 3, true);
  insert into public.team_activity (project_id, user_id, kind, title) values (pid, me, 'project_created', trim(both from p_name));
  foreach m in array coalesce(p_members, '{}') loop
    if m <> me and public.are_friends(me, m) then
      insert into public.team_members (project_id, user_id, role, added_by) values (pid, m, 'member', me) on conflict do nothing;
      insert into public.team_activity (project_id, user_id, kind, detail) values (pid, me, 'member_added', jsonb_build_object('user', m));
    end if;
  end loop;
  return pid;
end $$;

-- Cualquier miembro puede invitar a uno de SUS amigos
create or replace function public.add_team_member(pid uuid, target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not public.is_team_member(pid) then raise exception 'No eres miembro de este proyecto'; end if;
  if not public.are_friends(me, target) then raise exception 'Solo puedes añadir a tus amigos'; end if;
  if (select count(*) from public.team_members where project_id = pid) >= 50 then raise exception 'El proyecto ya tiene 50 miembros'; end if;
  insert into public.team_members (project_id, user_id, role, added_by) values (pid, target, 'member', me) on conflict do nothing;
  if found then perform public.team_log(pid, 'member_added', null, null, jsonb_build_object('user', target)); end if;
end $$;

-- Salir (yo) o quitar a alguien (solo el creador). Sus tareas quedan sin asignar.
-- Si sale el creador, el proyecto pasa al miembro más antiguo; si no queda nadie, se borra.
create or replace function public.remove_team_member(pid uuid, target uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); who uuid := coalesce(target, auth.uid()); own uuid; heir uuid;
begin
  select owner into own from public.team_projects where id = pid;
  if own is null or not public.is_team_member(pid) then raise exception 'No eres miembro de este proyecto'; end if;
  if who <> me and own <> me then raise exception 'Solo el creador puede quitar a otros'; end if;
  delete from public.team_members where project_id = pid and user_id = who;
  update public.team_tasks set assignee = null where project_id = pid and assignee = who;
  if not exists (select 1 from public.team_members where project_id = pid) then
    delete from public.team_projects where id = pid; return 'deleted';
  end if;
  if who = own then
    select user_id into heir from public.team_members where project_id = pid order by joined_at limit 1;
    update public.team_members set role = 'owner' where project_id = pid and user_id = heir;
    update public.team_projects set owner = heir where id = pid;
  end if;
  insert into public.team_activity (project_id, user_id, kind, detail) values (pid, me, case when who = me then 'member_left' else 'member_removed' end, jsonb_build_object('user', who));
  update public.team_projects set updated_at = now() where id = pid;
  return 'ok';
end $$;

-- Mis proyectos compartidos con lo justo para la lista (1 sola petición)
create or replace function public.my_team_projects() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'updated_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', p.id, 'name', p.name, 'icon', p.icon, 'color', p.color, 'description', p.description, 'owner', p.owner,
      'created_at', p.created_at, 'updated_at', p.updated_at, 'archived_at', p.archived_at,
      'members', (select jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name, 'avatar', u.avatar, 'color', u.color, 'role', m.role) order by m.joined_at)
                  from public.team_members m join public.profiles u on u.id = m.user_id where m.project_id = p.id),
      'total', (select count(*) from public.team_tasks t where t.project_id = p.id),
      'done', (select count(*) from public.team_tasks t where t.project_id = p.id and t.done_at is not null),
      'mine', (select count(*) from public.team_tasks t where t.project_id = p.id and t.done_at is null and t.assignee = auth.uid()),
      'late', (select count(*) from public.team_tasks t where t.project_id = p.id and t.done_at is null and t.due < current_date),
      'next_due', (select min(t.due) from public.team_tasks t where t.project_id = p.id and t.done_at is null and t.due >= current_date),
      'last_act', (select max(a.id) from public.team_activity a where a.project_id = p.id and a.user_id is distinct from auth.uid()),
      'last_kind', (select jsonb_build_object('kind', a.kind, 'title', a.title, 'user', a.user_id, 'at', a.created_at, 'detail', a.detail) from public.team_activity a where a.project_id = p.id and a.user_id is distinct from auth.uid() order by a.id desc limit 1)
    ) as x
    from public.team_projects p join public.team_members me on me.project_id = p.id and me.user_id = auth.uid()
  ) s
$$;

-- Todo un proyecto de una vez (tablero, objetivos, miembros, actividad reciente)
create or replace function public.team_snapshot(pid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_team_member(pid) then return null; end if;
  return (select jsonb_build_object(
    'project', to_jsonb(p),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name, 'avatar', u.avatar, 'color', u.color, 'friend_code', u.friend_code, 'role', m.role, 'joined_at', m.joined_at) order by m.joined_at), '[]'::jsonb)
                from public.team_members m join public.profiles u on u.id = m.user_id where m.project_id = pid),
    'columns', (select coalesce(jsonb_agg(to_jsonb(c) order by c.position, c.created_at), '[]'::jsonb) from public.team_columns c where c.project_id = pid),
    'goals', (select coalesce(jsonb_agg(to_jsonb(g) order by g.position, g.created_at), '[]'::jsonb) from public.team_goals g where g.project_id = pid),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('comments', (select count(*) from public.team_comments k where k.task_id = t.id)) order by t.position, t.created_at), '[]'::jsonb) from public.team_tasks t where t.project_id = pid),
    'activity', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id desc), '[]'::jsonb) from (select * from public.team_activity a where a.project_id = pid order by a.id desc limit 60) a)
  ) from public.team_projects p where p.id = pid);
end $$;

-- Tareas que me tocan en todos mis proyectos compartidos (para Hoy)
create or replace function public.my_team_tasks() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'project_id', t.project_id, 'project', p.name, 'icon', p.icon, 'color', p.color, 'title', t.title, 'due', t.due, 'start_date', t.start_date, 'priority', t.priority) order by t.due nulls last, t.position), '[]'::jsonb)
  from public.team_tasks t join public.team_projects p on p.id = t.project_id
  where t.assignee = auth.uid() and t.done_at is null and p.archived_at is null and public.is_team_member(t.project_id)
$$;

-- ============ Avisos push del equipo ============
-- Cola que vacía la función «reminders» (cada minuto) y envía como notificación a quien tenga
-- activados los avisos con la app cerrada. Nadie la lee desde la app (sin políticas = solo servidor).
create table if not exists public.notify_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  body text not null,
  url text,
  tag text,
  created_at timestamptz not null default now()
);
create index if not exists notify_queue_created_idx on public.notify_queue (created_at);
alter table public.notify_queue enable row level security;

create or replace function public.who(u uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(p.display_name, ''), '@' || p.username, 'Alguien') from public.profiles p where p.id = u
$$;
create or replace function public.notify(u uuid, t text, b text, link text, tg text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notify_queue (user_id, title, body, url, tag)
  select u, t, b, link, tg where u is not null and u is distinct from auth.uid();
$$;

create or replace function public.friendships_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify(new.addressee, 'Solicitud de amistad', coalesce(public.who(new.requester), 'Alguien') || ' quiere ser tu amigo en Boldup', '#amigos', 'friend-' || new.id);
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status = 'pending' then
    perform public.notify(new.requester, '¡Nuevo amigo!', coalesce(public.who(new.addressee), 'Alguien') || ' ha aceptado tu solicitud', '#amigos', 'friend-' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify after insert or update on public.friendships for each row execute function public.friendships_notify();

create or replace function public.team_members_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify(new.user_id, (select coalesce(p.icon || ' ', '') || p.name from public.team_projects p where p.id = new.project_id),
    coalesce(public.who(new.added_by), 'Alguien') || ' te ha añadido a este proyecto', '#equipo/' || new.project_id, 'team-' || new.project_id);
  return new;
end $$;
drop trigger if exists team_members_notify on public.team_members;
create trigger team_members_notify after insert on public.team_members for each row execute function public.team_members_notify();

create or replace function public.team_tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pname text;
begin
  if new.assignee is not null and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee) then
    select coalesce(p.icon || ' ', '') || p.name into pname from public.team_projects p where p.id = new.project_id;
    perform public.notify(new.assignee, pname, coalesce(public.who(auth.uid()), 'Alguien') || ' te ha asignado «' || new.title || '»' || coalesce(' · plazo ' || to_char(new.due, 'DD/MM'), ''), '#equipo/' || new.project_id, 'task-' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists team_tasks_notify on public.team_tasks;
create trigger team_tasks_notify after insert or update of assignee on public.team_tasks for each row execute function public.team_tasks_notify();

create or replace function public.team_comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.team_tasks; pname text; msg text;
begin
  select * into t from public.team_tasks where id = new.task_id;
  select coalesce(p.icon || ' ', '') || p.name into pname from public.team_projects p where p.id = new.project_id;
  msg := coalesce(public.who(new.user_id), 'Alguien') || ' en «' || t.title || '»: ' || left(new.body, 120);
  perform public.notify(t.assignee, pname, msg, '#equipo/' || new.project_id, 'comment-' || t.id);
  if t.created_by is distinct from t.assignee then perform public.notify(t.created_by, pname, msg, '#equipo/' || new.project_id, 'comment-' || t.id); end if;
  return new;
end $$;
drop trigger if exists team_comments_notify on public.team_comments;
create trigger team_comments_notify after insert on public.team_comments for each row execute function public.team_comments_notify();

-- ============ Permisos ============
grant usage on schema public to anon, authenticated, service_role;
-- Primero se quita todo (Supabase a veces da permisos por defecto) y luego se da solo lo necesario
revoke all on public.profiles, public.friendships, public.team_projects, public.team_members, public.team_columns,
  public.team_goals, public.team_tasks, public.team_comments, public.team_activity from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, delete on public.friendships to authenticated;
grant select, update, delete on public.team_projects to authenticated;
grant select on public.team_members to authenticated;
grant select, insert, update, delete on public.team_columns, public.team_goals, public.team_tasks to authenticated;
grant select, insert, delete on public.team_comments to authenticated;
grant select on public.team_activity to authenticated;
grant all on public.profiles, public.friendships, public.team_projects, public.team_members, public.team_columns,
  public.team_goals, public.team_tasks, public.team_comments, public.team_activity to service_role;
-- El perfil: solo se pueden cambiar nombre visible, avatar y color (el nick va por claim_username)
revoke update on public.profiles from authenticated;
grant update (display_name, avatar, color, updated_at) on public.profiles to authenticated;
-- Proyecto: los miembros cambian nombre, icono, color, descripción y archivado; el dueño se cede por RPC
revoke update on public.team_projects from authenticated;
grant update (name, icon, color, description, archived_at, owner) on public.team_projects to authenticated;

revoke execute on function public.username_status(text) from public;
grant execute on function public.username_status(text) to anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['claim_username(text, text)', 'find_user(text)', 'send_friend_request(uuid)', 'respond_friend_request(uuid, boolean)',
    'create_team_project(text, text, text, text, uuid[])', 'add_team_member(uuid, uuid)', 'remove_team_member(uuid, uuid)',
    'my_team_projects()', 'team_snapshot(uuid)', 'my_team_tasks()', 'is_team_member(uuid)', 'are_friends(uuid, uuid)', 'can_see_profile(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.team_log(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.new_friend_code() from public, anon, authenticated;

revoke all on public.notify_queue from anon, authenticated;
grant all on public.notify_queue to service_role;
revoke execute on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.who(uuid) from public, anon;

-- Para que la app sepa al momento si la función está instalada
notify pgrst, 'reload schema';
