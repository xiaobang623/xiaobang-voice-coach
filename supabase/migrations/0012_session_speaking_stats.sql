-- Approximate learner speaking volume per session.
-- user_speaking_seconds is a lightweight client-side ASR/RMS estimate, not precise VAD.

alter table public.sessions
  add column if not exists user_speaking_seconds int,
  add column if not exists user_turns int;
