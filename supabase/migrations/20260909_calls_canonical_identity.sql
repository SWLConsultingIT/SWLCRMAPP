-- ─────────────────────────────────────────────────────────────────────────
-- PHASE 3A · Canonical call identity
--
-- `calls` stores up to three technical rows for ONE physical call: the
-- click-to-dial marker the app writes before dialling, the Aircall webhook
-- row, and occasionally a recovery row. Nothing links them, so the same call
-- is counted 1, 2 or 3 times depending on which surface is asking.
--
-- Measured on production (2026-09-09): 2,556 rows, of which 1,073 are
-- marker+webhook pairs that were never joined. 212 of those have the human's
-- outcome on the marker and the audio/duration on the webhook — neither row
-- is a complete call.
--
-- The identity is a GROUP, not a row. Every technical representation of one
-- physical call shares a `canonical_call_id`. Nothing is deleted, nothing is
-- overwritten: metrics group by the new column, and a reader that ignores it
-- behaves exactly as before.
--
-- Additive and reversible. See the rollback block at the bottom.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Identity column ───────────────────────────────────────────────────
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS canonical_call_id uuid;

-- Seed every existing row as its own physical call. This is the identity
-- state BEFORE any reconciliation: correct-but-fragmented, never wrong.
-- Batched so the statement does not hold a long lock on a hot table.
DO $$
DECLARE
  touched integer;
BEGIN
  LOOP
    UPDATE public.calls
       SET canonical_call_id = id
     WHERE id IN (
       SELECT id FROM public.calls WHERE canonical_call_id IS NULL LIMIT 2000
     );
    GET DIAGNOSTICS touched = ROW_COUNT;
    EXIT WHEN touched = 0;
  END LOOP;
END $$;

ALTER TABLE public.calls
  ALTER COLUMN canonical_call_id SET DEFAULT gen_random_uuid();

ALTER TABLE public.calls
  ALTER COLUMN canonical_call_id SET NOT NULL;

COMMENT ON COLUMN public.calls.canonical_call_id IS
  'Identity of the PHYSICAL call. Several technical rows (dial marker, Aircall '
  'webhook, recovery row) share one value. Metrics count distinct '
  'canonical_call_id, never rows. Defaults to a fresh uuid so an unlinked row '
  'is its own call.';

-- ── 2. Indexes ───────────────────────────────────────────────────────────
-- Grouping key for every call metric.
CREATE INDEX IF NOT EXISTS calls_canonical_call_id_idx
  ON public.calls (canonical_call_id);

-- The reconciler sweeps orphan markers by lead and time. Partial, because
-- only rows without an Aircall id are ever candidates.
CREATE INDEX IF NOT EXISTS calls_orphan_marker_idx
  ON public.calls (lead_id, started_at)
  WHERE aircall_call_id IS NULL;

-- ── 3. Audit log — why two rows are the same call ────────────────────────
CREATE TABLE IF NOT EXISTS public.calls_recon_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_call_id    uuid NOT NULL,
  row_ids              uuid[] NOT NULL,
  -- how the link was decided
  match_method         text NOT NULL
    CHECK (match_method IN ('high_auto_webhook', 'high_auto_reconciler',
                            'medium_manual', 'backfill_high', 'unlink')),
  confidence           text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  time_delta_seconds   numeric,
  phone_match          text CHECK (phone_match IN ('exact', 'suffix', 'none')),
  -- how many rivals were considered and rejected — this is what makes a link
  -- auditable rather than merely recorded
  candidates_considered integer NOT NULL DEFAULT 0,
  notes                text,
  reconciled_at        timestamptz NOT NULL DEFAULT now(),
  reconciled_by        text NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS calls_recon_log_canonical_idx
  ON public.calls_recon_log (canonical_call_id);
CREATE INDEX IF NOT EXISTS calls_recon_log_at_idx
  ON public.calls_recon_log (reconciled_at DESC);

COMMENT ON TABLE public.calls_recon_log IS
  'Append-only audit of every canonical_call_id assignment. Answers "why are '
  'these two rows the same call?" with the time delta, the phone match and the '
  'number of rival candidates that were rejected.';

-- ── 4. Backfill staging — a PLAN, never applied automatically ────────────
-- Kept separate from the productive log: the plan is a proposal that a human
-- reviews and may discard. `previous_canonical_call_id` is what makes the
-- historical UPDATE reversible row by row.
CREATE TABLE IF NOT EXISTS public.calls_recon_plan (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch                     text NOT NULL,
  webhook_row_id            uuid NOT NULL,
  marker_row_id             uuid NOT NULL,
  proposed_canonical_call_id uuid NOT NULL,
  previous_canonical_call_id uuid NOT NULL,
  confidence                text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  time_delta_seconds        numeric NOT NULL,
  phone_match               text NOT NULL,
  candidates_considered     integer NOT NULL DEFAULT 0,
  applied_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calls_recon_plan_batch_idx
  ON public.calls_recon_plan (batch, confidence);
-- A row may appear in at most one proposal per batch, on either side.
CREATE UNIQUE INDEX IF NOT EXISTS calls_recon_plan_webhook_uniq
  ON public.calls_recon_plan (batch, webhook_row_id);
CREATE UNIQUE INDEX IF NOT EXISTS calls_recon_plan_marker_uniq
  ON public.calls_recon_plan (batch, marker_row_id);

COMMENT ON TABLE public.calls_recon_plan IS
  'Staging for the historical backfill. Written by the dry run, applied only '
  'by an explicit operator action. previous_canonical_call_id makes every '
  'applied row individually revertible.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
-- Nothing here destroys data, so reverting is safe at any point.
--
--   -- undo an applied backfill (per batch), then re-run the dry run:
--   UPDATE public.calls c
--      SET canonical_call_id = p.previous_canonical_call_id
--     FROM public.calls_recon_plan p
--    WHERE p.webhook_row_id = c.id
--      AND p.batch = '<batch>'
--      AND p.applied_at IS NOT NULL;
--
--   -- full teardown:
--   DROP TABLE IF EXISTS public.calls_recon_plan;
--   DROP TABLE IF EXISTS public.calls_recon_log;
--   DROP INDEX IF EXISTS public.calls_orphan_marker_idx;
--   DROP INDEX IF EXISTS public.calls_canonical_call_id_idx;
--   ALTER TABLE public.calls DROP COLUMN IF EXISTS canonical_call_id;
--
-- Softer than either: leave the schema in place and set
-- CALLS_CANONICAL_IDENTITY=0. The metric layer falls back to the legacy dedup
-- and the column is simply unread.
-- ─────────────────────────────────────────────────────────────────────────
