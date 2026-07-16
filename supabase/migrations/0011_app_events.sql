-- App behavior events for the speaking funnel (开口漏斗埋点).
-- Rows are written only by the service role via api/log-event.js.
-- RLS is enabled with NO policies on purpose: anon/authenticated clients
-- cannot read or write this table directly.

create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  user_id uuid,
  guest_id text,
  session_id text,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_events_name_created
  on public.app_events (event_name, created_at);

create index if not exists idx_app_events_session
  on public.app_events (session_id);

alter table public.app_events enable row level security;

-- Aggregation helper for the admin funnel view. Called with the service
-- role key from serverless-admin/funnel-summary.js; regular clients are
-- explicitly revoked so the aggregate cannot leak through PostgREST rpc.
create or replace function public.app_event_funnel(p_from timestamptz, p_to timestamptz)
returns table (event_name text, actor_count bigint, event_count bigint)
language sql
stable
set search_path = public
as $$
  select
    event_name,
    count(distinct coalesce(user_id::text, guest_id)) as actor_count,
    count(*) as event_count
  from public.app_events
  where created_at >= p_from
    and created_at <= p_to
  group by event_name;
$$;

revoke execute on function public.app_event_funnel(timestamptz, timestamptz)
  from public, anon, authenticated;

grant execute on function public.app_event_funnel(timestamptz, timestamptz)
  to service_role;
