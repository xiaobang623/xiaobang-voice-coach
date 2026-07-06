-- Allow guest usage logs + Doubao duration tracking

alter table public.token_logs drop constraint if exists token_logs_user_id_fkey;

alter table public.token_logs alter column user_id drop not null;

alter table public.token_logs
  add column if not exists guest_id text,
  add column if not exists duration_seconds integer;

alter table public.token_logs
  add constraint token_logs_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

create index if not exists idx_token_logs_guest_id on public.token_logs (guest_id);
