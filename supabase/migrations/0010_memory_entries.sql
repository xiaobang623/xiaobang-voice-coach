-- Coach memory v2: recent session memory stream stored beside the learner profile.
-- RLS continues to use the existing memory table policies keyed by user_id.
alter table public.memory
  add column if not exists entries jsonb not null default '[]'::jsonb;
