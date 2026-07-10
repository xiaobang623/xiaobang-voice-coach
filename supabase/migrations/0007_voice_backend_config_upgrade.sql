-- Upgrade legacy voice_backend_config (scope/scope_id) to new schema (scope_type/config/...)

alter table public.voice_backend_config
  add column if not exists scope_type text,
  add column if not exists user_id uuid references public.profiles (id) on delete cascade,
  add column if not exists guest_id text,
  add column if not exists session_id uuid references public.sessions (id) on delete cascade,
  add column if not exists config jsonb not null default '{}',
  add column if not exists updated_by text;

update public.voice_backend_config
set scope_type = coalesce(scope_type, scope, 'global')
where scope_type is null;

update public.voice_backend_config
set user_id = scope_id::uuid
where scope_type = 'user'
  and scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and user_id is null;

update public.voice_backend_config
set guest_id = scope_id
where scope_type = 'user'
  and user_id is null
  and scope_id is not null;

update public.voice_backend_config
set session_id = scope_id::uuid
where scope_type = 'session'
  and scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and session_id is null;

update public.voice_backend_config
set config = '{"doubao":{"dialogModel":"1.2.1.1"}}'::jsonb
where config = '{}'::jsonb or config is null;

alter table public.voice_backend_config
  alter column scope_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voice_backend_config_scope_type_check'
  ) then
    alter table public.voice_backend_config
      add constraint voice_backend_config_scope_type_check
      check (scope_type in ('global', 'user', 'session'));
  end if;
end $$;

create unique index if not exists voice_backend_config_global
  on public.voice_backend_config ((true))
  where scope_type = 'global';

create unique index if not exists voice_backend_config_user
  on public.voice_backend_config (user_id)
  where scope_type = 'user' and user_id is not null;

create unique index if not exists voice_backend_config_guest
  on public.voice_backend_config (guest_id)
  where scope_type = 'user' and guest_id is not null;

create unique index if not exists voice_backend_config_session
  on public.voice_backend_config (session_id)
  where scope_type = 'session';
