-- Lightweight report summaries for growth page first-screen loading.
-- Full reports.payload remains the source for expanded report details.

alter table public.reports
  add column if not exists summary jsonb not null default '{}'::jsonb;

create index if not exists idx_reports_user_created_at
  on public.reports (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_reports_guest_created_at
  on public.reports (guest_id, created_at desc)
  where guest_id is not null;
