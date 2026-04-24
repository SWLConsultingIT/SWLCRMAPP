-- Strict tenant isolation — remove is_admin() bypass from all "tenant isolation" policies.
--
-- Problem: sales@swlconsulting.com (admin of SWL Consulting tenant) could see leads
-- from Pathway Commercial Finance because every policy had an `is_admin() OR ...`
-- escape hatch. Admins are tenant-scoped, not super-admins.
--
-- All /admin/* pages already use the service-role key (getSupabaseService), so they
-- bypass RLS entirely — removing the is_admin() bypass does NOT break admin views.
--
-- app_settings "admin write" policy is intentionally left untouched — that one is
-- a legitimate admin-only permission for global app config.

-- ── leads ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.leads;
CREATE POLICY "tenant isolation" ON public.leads
  FOR ALL
  USING (company_bio_id = get_auth_company_bio_id());

-- ── campaigns (join via leads) ───────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.campaigns;
CREATE POLICY "tenant isolation" ON public.campaigns
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = campaigns.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  );

-- ── campaign_requests ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.campaign_requests;
CREATE POLICY "tenant isolation" ON public.campaign_requests
  FOR ALL
  USING (company_bio_id = get_auth_company_bio_id());

-- ── calls (join via leads) ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.calls;
CREATE POLICY "tenant isolation" ON public.calls
  FOR ALL
  USING (
    EXISTS (
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
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_notes.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  );

-- ── lead_replies (join via leads) ────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.lead_replies;
CREATE POLICY "tenant isolation" ON public.lead_replies
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_replies.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  );

-- ── icp_profiles ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.icp_profiles;
CREATE POLICY "tenant isolation" ON public.icp_profiles
  FOR ALL
  USING (company_bio_id = get_auth_company_bio_id());

-- ── sellers ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.sellers;
CREATE POLICY "tenant isolation" ON public.sellers
  FOR ALL
  USING (company_bio_id = get_auth_company_bio_id());

-- ── company_bios ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant isolation" ON public.company_bios;
CREATE POLICY "tenant isolation" ON public.company_bios
  FOR ALL
  USING (id = get_auth_company_bio_id());
