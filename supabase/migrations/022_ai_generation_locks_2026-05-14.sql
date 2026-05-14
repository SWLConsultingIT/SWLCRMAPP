-- AI-generation locks (Fran 2026-05-14).
--
-- We charge Anthropic per token, so double-clicks on the Coach / Summary
-- buttons can double-spend if both requests reach the server before the
-- first one writes the cache. Cheap fix: stamp `<feature>_generating_at`
-- before the LLM call, check it before starting a new one, clear it on
-- completion (success or failure).
--
-- 90 seconds is the lock window — well above the typical generation time
-- (Sonnet 4.6 ~10-15s, Haiku 4.5 ~2-4s) but short enough that a crashed
-- generation auto-unlocks before a user gets frustrated retrying.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS coach_generating_at timestamptz,
  ADD COLUMN IF NOT EXISTS summary_generating_at timestamptz;
