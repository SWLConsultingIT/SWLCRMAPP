-- 046 — Telegram channel (2026-06-18)
--
-- Adds Telegram support at two levels:
--   1. sellers: unipile telegram account ID + daily limit
--   2. leads: resolved telegram_user_id (from phone resolution job)
--
-- The telegram_account_id stores the Unipile account ID for the seller's
-- personal Telegram (same pattern as unipile_account_id for LinkedIn).
-- telegram_status mirrors linkedin_status: 'active' | 'restricted' | 'banned'.
-- telegram_daily_limit default 20 matches the conservative cap from the PDF.
--
-- leads.telegram_user_id is populated by /api/cron/resolve-telegram-users
-- (phone → Telegram user ID via Unipile API). NULL means unresolved — the
-- dispatcher skips NULL leads.

ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS telegram_account_id    text,
  ADD COLUMN IF NOT EXISTS telegram_daily_limit   integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS telegram_status        text NOT NULL DEFAULT 'active';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS telegram_user_id       text,
  ADD COLUMN IF NOT EXISTS telegram_resolved_at   timestamptz;

-- Index for the dispatcher (picks up queued telegram messages for a seller)
CREATE INDEX IF NOT EXISTS idx_campaign_messages_telegram
  ON campaign_messages (channel, status, lead_id)
  WHERE channel = 'telegram';

-- Index for the resolver cron (finds leads that have a phone but no telegram_user_id)
CREATE INDEX IF NOT EXISTS idx_leads_telegram_unresolved
  ON leads (company_bio_id, primary_phone)
  WHERE telegram_user_id IS NULL AND primary_phone IS NOT NULL;
