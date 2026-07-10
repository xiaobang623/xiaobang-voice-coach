-- Voice backend + model configuration (global / user / session overrides)

create table public.voice_backend_config (
  id          uuid primary key default gen_random_uuid(),
  scope_type  text not null check (scope_type in ('global', 'user', 'session')),
  user_id     uuid references public.profiles (id) on delete cascade,
  guest_id    text,
  session_id  uuid references public.sessions (id) on delete cascade,
  backend     text not null default 'doubao'
              check (backend in ('doubao', 'selfhosted')),
  config      jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.voice_backend_config enable row level security;

create policy "voice_backend_config_no_direct_access"
  on public.voice_backend_config for all
  using (false);

create unique index voice_backend_config_global
  on public.voice_backend_config ((true))
  where scope_type = 'global';

create unique index voice_backend_config_user
  on public.voice_backend_config (user_id)
  where scope_type = 'user' and user_id is not null;

create unique index voice_backend_config_guest
  on public.voice_backend_config (guest_id)
  where scope_type = 'user' and guest_id is not null;

create unique index voice_backend_config_session
  on public.voice_backend_config (session_id)
  where scope_type = 'session';

insert into public.voice_backend_config (scope_type, backend, config)
values ('global', 'doubao', '{"doubao":{"dialogModel":"1.2.1.1"}}');
