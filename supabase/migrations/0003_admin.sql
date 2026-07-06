-- Phase 4: admin dashboard — admin_users + token_logs

-- ---------------------------------------------------------------------------
-- admin_users
-- ---------------------------------------------------------------------------
create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create policy "admin_users_no_direct_access"
  on public.admin_users for all
  using (false);

-- ---------------------------------------------------------------------------
-- token_logs
-- ---------------------------------------------------------------------------
create table public.token_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  api_provider text not null,
  model_name text not null,
  tokens_used integer not null,
  cost numeric not null,
  session_id uuid references public.sessions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_token_logs_user_id on public.token_logs (user_id);
create index idx_token_logs_created_at on public.token_logs (created_at desc);
create index idx_token_logs_api_provider on public.token_logs (api_provider);

alter table public.token_logs enable row level security;

create policy "token_logs_no_direct_access"
  on public.token_logs for select
  using (false);
