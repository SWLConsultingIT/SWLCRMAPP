-- 030 — Per-campaign control over how the call step advances.
--
-- Two modes the seller picks at campaign creation:
--   • 'auto'   — when the call step's daysAfter window opens, the
--                dispatch-call cron auto-dials and the campaign advances
--                to the next step whether or not anyone answered. The lead
--                keeps moving through the sequence even if the seller is
--                busy or out of office.
--   • 'manual' — the call step blocks the sequence. The cron does NOT
--                auto-dial. The next step is queued only after the seller
--                manually dials via /api/aircall/dial. Used when the call
--                is the deliberate "live human gate" and skipping it would
--                be wrong (e.g. high-value enterprise leads where a missed
--                call must NOT silently fall through to a LinkedIn DM).
--
-- Default 'auto' preserves the pre-2026-05-21 behavior — campaigns created
-- before this column existed get the auto behavior so we don't suddenly
-- freeze existing pipelines.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS call_advance_mode text NOT NULL DEFAULT 'auto'
    CHECK (call_advance_mode IN ('auto', 'manual'));

COMMENT ON COLUMN campaigns.call_advance_mode IS
  'auto = call step auto-advances (cron dials + sequence proceeds regardless of outcome); manual = sequence waits at the call step until the seller dials via /api/aircall/dial';
