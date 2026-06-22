-- 047_referral_capture_2026-06-19.sql
--
-- Referral capture feature. When a lead replies "I left the company, talk to
-- X" or "I'm on vacation, contact Y", the reply handler (n8n, Haiku) extracts
-- the referred contacts and we let a seller turn them into new leads enrolled
-- in the same-ICP flow.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS) — no data is dropped or
-- altered, so this is safe to run on prod without a table backup.

-- Where the extracted referred contacts live (array of
-- { name, email, role, reason, is_decision_maker, is_generic_inbox, status,
--   created_lead_id }). Also a generic bag for any future reply-level metadata.
ALTER TABLE lead_replies ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Provenance: a lead created from a referral points back to the lead that
-- referred it and to the exact reply it came from.
--
-- These are PLAIN uuid columns, NOT foreign keys. A real FK
-- `referral_source_reply_id REFERENCES lead_replies(id)` created a SECOND
-- relationship between `leads` and `lead_replies`, which made every PostgREST
-- embed `lead_replies?select=...,leads!inner(...)` (the Inbox query, among
-- others) ambiguous → PGRST201 → the whole Inbox went blank across all tenants
-- (incident 2026-06-22). Provenance doesn't need referential integrity here, so
-- we keep the ids as plain columns and avoid the relationship entirely.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referred_by_lead_id uuid;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_source_reply_id uuid;

CREATE INDEX IF NOT EXISTS idx_leads_referred_by
  ON leads(referred_by_lead_id) WHERE referred_by_lead_id IS NOT NULL;
