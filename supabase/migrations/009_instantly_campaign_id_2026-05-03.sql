-- Tenant-scoped Instantly campaign id.
--
-- The CRM email dispatcher used to call Instantly's `/emails/send` endpoint —
-- but that endpoint does not exist in v2. Instantly v2 is campaign-based: to
-- send a mail you POST a lead to /api/v2/leads with a `campaign` field, and
-- Instantly handles dispatch using the campaign's connected inboxes (rotation,
-- warmup, deliverability). Each tenant gets its own Instantly campaign
-- ("<Tenant>-CRM-Outbound") wired to that tenant's inboxes; the CRM stores
-- that campaign UUID here and uses it as the dispatch target for every email
-- step belonging to that tenant.

ALTER TABLE public.company_bios
  ADD COLUMN IF NOT EXISTS instantly_campaign_id text;

COMMENT ON COLUMN public.company_bios.instantly_campaign_id IS
  'UUID of the Instantly v2 campaign used as the send target for this tenant''s email steps. Required for /api/cron/dispatch-email.';
