-- token_logs.session_id is a client correlation id (app session UUID).
-- Usage is often logged before a sessions row exists (guests never persist one).

alter table public.token_logs
  drop constraint if exists token_logs_session_id_fkey;
