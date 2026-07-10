-- Allow guest sessions and reports (tracked by localStorage guest_id).

alter table public.sessions
  alter column user_id drop not null,
  add column if not exists guest_id text;

alter table public.sessions
  drop constraint if exists sessions_actor_check;

alter table public.sessions
  add constraint sessions_actor_check
  check (
    (user_id is not null and guest_id is null)
    or (user_id is null and guest_id is not null)
  );

create index if not exists idx_sessions_guest_id on public.sessions (guest_id);

alter table public.reports
  alter column user_id drop not null,
  add column if not exists guest_id text;

alter table public.reports
  drop constraint if exists reports_actor_check;

alter table public.reports
  add constraint reports_actor_check
  check (
    (user_id is not null and guest_id is null)
    or (user_id is null and guest_id is not null)
  );

create index if not exists idx_reports_guest_id on public.reports (guest_id);
