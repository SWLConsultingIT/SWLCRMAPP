-- Roadmap #2 (P0) from scale audit 2026-05-14.
--
-- The dispatch pipeline (dispatch-queue / dispatch-email / dispatch-call)
-- claims a row by flipping `status = 'queued' → 'dispatching'` BEFORE the
-- external provider call. If the function crashes / Vercel timeouts / network
-- blips between the claim and the final `status = 'sent'`, the row is stuck
-- in `dispatching` forever — next tick filters `status = 'queued'`, so it's
-- invisible until manually rescued.
--
-- `dispatching_since` is stamped during the claim; the reaper cron
-- (/api/cron/reap-stuck) resets rows where dispatching_since < now() - 15min
-- back to `queued` so they get retried automatically. 15 min is well over
-- Vercel's 60 s function limit, so we never race against a legitimately
-- still-running dispatcher.

ALTER TABLE public.campaign_messages
  ADD COLUMN IF NOT EXISTS dispatching_since timestamptz;

-- Partial index — only `dispatching` rows are ever interesting to the reaper,
-- and we already have plenty of indexes on this table. Keep it tight.
CREATE INDEX IF NOT EXISTS idx_campaign_messages_stuck
  ON public.campaign_messages (dispatching_since)
  WHERE status = 'dispatching';
