-- Tenant-scoped Instantly API key.
--
-- Original design assumed all tenants live inside the same Instantly account
-- (a single env-level INSTANTLY_API_KEY). That breaks the moment a new
-- tenant's inboxes already live in a separate Instantly account/subscription
-- — moving the inboxes wastes the second plan, so we let each tenant point
-- the dispatcher at their own account by storing an API key on company_bios.
--
-- When `instantly_api_key` is null, the dispatcher falls back to
-- INSTANTLY_API_KEY from env (the existing single-account behaviour). When
-- it's set, the dispatcher uses that key for every Instantly call related
-- to this tenant (POST /leads, lead lookups, deletes during dedupe).
--
-- Stored as plain text intentionally:
--   - lives in Supabase (RLS-protected, never exposed to browser)
--   - read only by server routes via the service-role key
--   - encrypting it would require an extra layer of key management for
--     a value that already only travels server-side

ALTER TABLE public.company_bios
  ADD COLUMN IF NOT EXISTS instantly_api_key text;

COMMENT ON COLUMN public.company_bios.instantly_api_key IS
  'Per-tenant Instantly API key. NULL → use INSTANTLY_API_KEY env var (default SWL account). Set when the tenant''s inboxes live in a separate Instantly account.';
