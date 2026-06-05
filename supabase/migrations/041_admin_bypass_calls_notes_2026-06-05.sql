-- Restore the is_auth_admin() bypass on the tenant-isolation policies that
-- were left out when the bypass was re-added to the rest of the schema.
--
-- ROOT CAUSE (2026-06-05): Pathway's Calls → History tab rendered 0 even
-- though 37 classified Pathway calls exist. The super_admin (sales@swl)
-- views other tenants by switching the active-tenant cookie, but
-- get_auth_company_bio_id() reads user_profiles.company_bio_id — which stays
-- pinned to SWL for super_admins (switch-tenant deliberately does NOT mirror
-- the bio for them). Every operational table works around this with an
-- `is_auth_admin() OR (...)` escape hatch on its RLS policy, so the app-layer
-- `.eq("leads.company_bio_id", activeTenant)` filter does the real scoping.
--
-- leads / campaigns / lead_replies / campaign_requests already carry that
-- bypass. calls, lead_notes, message_sequences and autoreply_new_leads were
-- missed — they still use the strict migration-004 form with no bypass, so a
-- super_admin viewing any non-home tenant sees zero rows. This was a
-- per-tenant-invisible bug for EVERY tenant that isn't SWL, not just Pathway.
--
-- Fix: bring these four in line with the canonical pattern. Real tenant users
-- (role != 'admin') are unaffected — is_auth_admin() is false for them, so
-- the get_auth_company_bio_id() match still governs their access exactly as
-- before. Service-role writes (webhooks, crons) bypass RLS regardless.
--
-- Previous policy definitions (for rollback):
--   calls               USING: EXISTS(SELECT 1 FROM leads WHERE leads.id = calls.lead_id      AND leads.company_bio_id = get_auth_company_bio_id())
--   lead_notes          USING: EXISTS(SELECT 1 FROM leads WHERE leads.id = lead_notes.lead_id AND leads.company_bio_id = get_auth_company_bio_id())
--   message_sequences   USING/CHECK: company_bio_id = get_auth_company_bio_id()
--   autoreply_new_leads USING (SELECT): company_bio_id = get_auth_company_bio_id()

-- ── calls (join via leads) ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.calls;
CREATE POLICY "tenant isolation" ON public.calls
  FOR ALL
  USING (
    is_auth_admin() OR EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = calls.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  )
  WITH CHECK (
    is_auth_admin() OR EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = calls.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  );

-- ── lead_notes (join via leads) ──────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.lead_notes;
CREATE POLICY "tenant isolation" ON public.lead_notes
  FOR ALL
  USING (
    is_auth_admin() OR EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_notes.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  )
  WITH CHECK (
    is_auth_admin() OR EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_notes.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  );

-- ── message_sequences (direct company_bio_id) ─────────────────────────────────
DROP POLICY IF EXISTS "tenant_isolation_seq" ON public.message_sequences;
CREATE POLICY "tenant_isolation_seq" ON public.message_sequences
  FOR ALL
  USING (is_auth_admin() OR company_bio_id = get_auth_company_bio_id())
  WITH CHECK (is_auth_admin() OR company_bio_id = get_auth_company_bio_id());

-- ── autoreply_new_leads (direct company_bio_id, read-only policy) ─────────────
DROP POLICY IF EXISTS "Tenant can read own autoreply_new_leads" ON public.autoreply_new_leads;
CREATE POLICY "Tenant can read own autoreply_new_leads" ON public.autoreply_new_leads
  FOR SELECT
  USING (is_auth_admin() OR company_bio_id = get_auth_company_bio_id());
