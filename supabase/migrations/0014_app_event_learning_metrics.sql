-- Admin-only learning-loop analytics aggregates.
-- Keep raw app_events private; dashboards call these with service_role only.
create or replace function public.app_event_funnel_diagnostics(p_from timestamptz, p_to timestamptz)
returns table (metric_name text, actor_count bigint, event_count bigint)
language sql stable set search_path = public as $$
  with base as (
    select event_name, coalesce(user_id::text, guest_id) as actor_id, props
    from public.app_events
    where created_at >= p_from and created_at <= p_to and coalesce(user_id::text, guest_id) is not null
  )
  select 'enter_session'::text, count(distinct actor_id), count(*) from base where event_name = 'enter_session'
  union all select 'first_utterance'::text, count(distinct actor_id), count(*) from base where event_name = 'first_utterance'
  union all select 'session_abandon_ready'::text, count(distinct actor_id), count(*) from base where event_name = 'session_abandon' and props->>'reachedReady' = 'true'
  union all select 'session_abandon_not_ready'::text, count(distinct actor_id), count(*) from base where event_name = 'session_abandon' and coalesce(props->>'reachedReady', 'false') <> 'true';
$$;
revoke execute on function public.app_event_funnel_diagnostics(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.app_event_funnel_diagnostics(timestamptz, timestamptz) to service_role;
create or replace function public.app_event_north_star()
returns table (period text, week_start date, speaking_actor_count bigint, total_speaking_seconds numeric, avg_speaking_minutes numeric)
language sql stable set search_path = public as $$
  with weeks as (
    select 'current'::text as period, date_trunc('week', now())::date as week_start
    union all select 'previous'::text as period, (date_trunc('week', now()) - interval '7 days')::date as week_start
  ), speakers as (
    select distinct coalesce(user_id::text, guest_id) as actor_id, date_trunc('week', created_at)::date as week_start
    from public.app_events
    where event_name = 'first_utterance' and created_at >= date_trunc('week', now()) - interval '7 days' and created_at < date_trunc('week', now()) + interval '7 days' and coalesce(user_id::text, guest_id) is not null
  ), completions as (
    select date_trunc('week', created_at)::date as week_start,
      sum(case when jsonb_typeof(props->'speakingSeconds') = 'number' then (props->>'speakingSeconds')::numeric when jsonb_typeof(props->'speakingSeconds') = 'string' and (props->>'speakingSeconds') ~ '^[0-9]+(\.[0-9]+)?$' then (props->>'speakingSeconds')::numeric else 0 end) as total_speaking_seconds
    from public.app_events
    where event_name = 'session_complete' and created_at >= date_trunc('week', now()) - interval '7 days' and created_at < date_trunc('week', now()) + interval '7 days'
    group by 1
  )
  select w.period, w.week_start, count(distinct s.actor_id)::bigint, coalesce(c.total_speaking_seconds, 0)::numeric,
    case when count(distinct s.actor_id) > 0 then round((coalesce(c.total_speaking_seconds, 0) / count(distinct s.actor_id) / 60)::numeric, 2) else 0 end
  from weeks w left join speakers s on s.week_start = w.week_start left join completions c on c.week_start = w.week_start
  group by w.period, w.week_start, c.total_speaking_seconds order by w.week_start desc;
$$;
revoke execute on function public.app_event_north_star() from public, anon, authenticated;
grant execute on function public.app_event_north_star() to service_role;
create or replace function public.app_event_retention(p_from timestamptz, p_to timestamptz)
returns table (metric_name text, cohort_actors bigint, returned_actors bigint, retention_rate numeric)
language sql stable set search_path = public as $$
  with opens as (
    select distinct coalesce(user_id::text, guest_id) as actor_id, created_at::date as event_date
    from public.app_events
    where event_name = 'app_open' and created_at >= p_from and created_at <= p_to and coalesce(user_id::text, guest_id) is not null
  ), bounds as (select least(p_to, now())::date as max_observed_date),
  next_day_cohort as (select o.* from opens o, bounds b where o.event_date <= b.max_observed_date - 1),
  seven_day_cohort as (select o.* from opens o, bounds b where o.event_date <= b.max_observed_date - 7),
  next_day as (select count(*)::bigint as cohort_actors, count(*) filter (where exists (select 1 from opens r where r.actor_id = c.actor_id and r.event_date = c.event_date + 1))::bigint as returned_actors from next_day_cohort c),
  seven_day as (select count(*)::bigint as cohort_actors, count(*) filter (where exists (select 1 from opens r where r.actor_id = c.actor_id and r.event_date > c.event_date and r.event_date <= c.event_date + 7))::bigint as returned_actors from seven_day_cohort c)
  select 'next_day'::text, cohort_actors, returned_actors, case when cohort_actors > 0 then round((returned_actors::numeric / cohort_actors)::numeric, 4) else null end from next_day
  union all select 'seven_day'::text, cohort_actors, returned_actors, case when cohort_actors > 0 then round((returned_actors::numeric / cohort_actors)::numeric, 4) else null end from seven_day;
$$;
revoke execute on function public.app_event_retention(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.app_event_retention(timestamptz, timestamptz) to service_role;
