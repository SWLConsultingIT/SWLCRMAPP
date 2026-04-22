-- ───────────────────────────────────────────────────────────
-- Session changes — 2026-04-21
-- Additions during the Aircall/Classification/Calls session.
-- Run this on any freshly-cloned Supabase project before deploying
-- a new client instance.
-- ───────────────────────────────────────────────────────────

-- 1. App-level settings (Auto/Manual classification, future toggles)
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_settings DISABLE ROW LEVEL SECURITY;

INSERT INTO app_settings (key, value)
VALUES ('call_classification_mode', '"manual"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. Campaigns: default Aircall country/number for this campaign
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS aircall_number_id bigint;

COMMENT ON COLUMN campaigns.aircall_number_id IS
  'Aircall number (country) to use when calling leads from this campaign. NULL = use app default.';

-- 3. Calls table: ensure classification + AI summary columns exist
-- (these were already present in the base schema — idempotent)
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS classification text,
  ADD COLUMN IF NOT EXISTS ai_confidence  numeric,
  ADD COLUMN IF NOT EXISTS ai_summary     text;

COMMENT ON COLUMN calls.classification IS
  'positive / negative / follow_up. Set manually from UI or by n8n workflow (AI mode).';
COMMENT ON COLUMN calls.ai_confidence  IS
  '0-1. If 1, manually classified. If <1, classified by AI on the transcript.';
