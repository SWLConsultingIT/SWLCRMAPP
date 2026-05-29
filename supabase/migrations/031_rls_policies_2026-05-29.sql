-- 031 — Close the silent default-deny on 3 tables that had RLS enabled with
-- zero policies.
--
-- Audit 2026-05-29 found `campaign_templates`, `instantly_accounts`, and
-- `lead_suppressions` in this state: `relrowsecurity=true` AND
-- `count(pg_policies)=0` → every browser-session SELECT returned 0 rows
-- silently (writes via service-role still worked, which is why the bug
-- went unnoticed for so long). See memory feedback_rls_no_policies.md.
--
-- Notes on the chosen policy per table:
--
-- campaign_templates → tenant isolation by company_bio_id (same shape as
--   campaigns, lead_replies). Templates ARE tenant-scoped.
--
-- instantly_accounts → no company_bio_id column; the rows are a global pool
--   of SWL-owned email inboxes used as senders. Restrict reads to
--   authenticated users; nothing PII lives here, just inbox metadata
--   (email, name, daily_limit, sent_today). Writes still go through the
--   service-role client (cron + admin tools), so a permissive read policy
--   doesn't widen the existing write surface.
--
-- lead_suppressions → no company_bio_id column; tenant scope is via lead.
--   Join through leads.company_bio_id mirrors the pattern used in
--   migration 002 for lead_replies pre-002→004 refactor.

-- ── campaign_templates ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.campaign_templates;
CREATE POLICY "tenant isolation" ON public.campaign_templates
  FOR ALL
  USING (
    is_auth_admin() OR company_bio_id = get_auth_company_bio_id()
  )
  WITH CHECK (
    is_auth_admin() OR company_bio_id = get_auth_company_bio_id()
  );

-- ── instantly_accounts ───────────────────────────────────────────────────
-- Global inbox pool — every authenticated user can read; writes are admin-only
-- (and currently all happen through service-role anyway).
DROP POLICY IF EXISTS "auth read" ON public.instantly_accounts;
CREATE POLICY "auth read" ON public.instantly_accounts
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "admin write" ON public.instantly_accounts;
CREATE POLICY "admin write" ON public.instantly_accounts
  FOR ALL
  USING (is_auth_admin())
  WITH CHECK (is_auth_admin());

-- ── lead_suppressions ────────────────────────────────────────────────────
-- Tenant scope via lead. Service-role writes (expire-invites cron, reply
-- handler) keep working because service-role bypasses RLS.
DROP POLICY IF EXISTS "tenant isolation" ON public.lead_suppressions;
CREATE POLICY "tenant isolation" ON public.lead_suppressions
  FOR ALL
  USING (
    is_auth_admin()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_suppressions.lead_id
        AND l.company_bio_id = get_auth_company_bio_id()
    )
  )
  WITH CHECK (
    is_auth_admin()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_suppressions.lead_id
        AND l.company_bio_id = get_auth_company_bio_id()
    )
  );
