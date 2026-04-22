-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-tenancy migration — 2026-04-21
-- One Supabase project, multiple client companies.
-- Each user belongs to exactly one company_bio (or is an admin with no company).
-- Run this ONCE on the shared Supabase project.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. user_profiles ─────────────────────────────────────────────────────────
-- Links auth.users → company_bios. One row per user.
-- Admins have company_bio_id = NULL (they see everything via RLS bypass).

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_bio_id  uuid REFERENCES company_bios(id) ON DELETE SET NULL,
  role            text NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'client')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile. Service role manages everything.
CREATE POLICY "users read own profile" ON user_profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "users update own profile" ON user_profiles
  FOR UPDATE USING (user_id = auth.uid());


-- ── 2. Add company_bio_id to sellers ─────────────────────────────────────────
-- Sellers (LinkedIn accounts / salespeople) belong to one client company.

ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS company_bio_id uuid REFERENCES company_bios(id) ON DELETE SET NULL;

COMMENT ON COLUMN sellers.company_bio_id IS
  'Which client company this seller works for. NULL = unassigned (legacy rows).';


-- ── 3. Helper functions (SECURITY DEFINER so they work inside RLS policies) ──

CREATE OR REPLACE FUNCTION get_auth_company_bio_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT company_bio_id FROM user_profiles WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM user_profiles WHERE user_id = auth.uid()),
    false
  );
$$;


-- ── 4. RLS: company_bios ──────────────────────────────────────────────────────
-- Clients see only their own company. Admins see all.

ALTER TABLE company_bios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON company_bios
  FOR ALL USING (
    is_admin() OR id = get_auth_company_bio_id()
  );


-- ── 5. RLS: leads ─────────────────────────────────────────────────────────────

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON leads
  FOR ALL USING (
    is_admin() OR company_bio_id = get_auth_company_bio_id()
  );


-- ── 6. RLS: icp_profiles ──────────────────────────────────────────────────────

ALTER TABLE icp_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON icp_profiles
  FOR ALL USING (
    is_admin() OR company_bio_id = get_auth_company_bio_id()
  );


-- ── 7. RLS: campaign_requests ─────────────────────────────────────────────────

ALTER TABLE campaign_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON campaign_requests
  FOR ALL USING (
    is_admin() OR company_bio_id = get_auth_company_bio_id()
  );


-- ── 8. RLS: campaigns (no direct company_bio_id — join through leads) ────────

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON campaigns
  FOR ALL USING (
    is_admin() OR EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = campaigns.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  );


-- ── 9. RLS: sellers ───────────────────────────────────────────────────────────

ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON sellers
  FOR ALL USING (
    is_admin() OR company_bio_id = get_auth_company_bio_id()
  );


-- ── 10. RLS: lead_replies (through leads) ────────────────────────────────────

ALTER TABLE lead_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON lead_replies
  FOR ALL USING (
    is_admin() OR EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = lead_replies.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  );


-- ── 11. RLS: calls (through leads) ───────────────────────────────────────────

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON calls
  FOR ALL USING (
    is_admin() OR EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = calls.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  );


-- ── 12. RLS: lead_notes (through leads) ──────────────────────────────────────

ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON lead_notes
  FOR ALL USING (
    is_admin() OR EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = lead_notes.lead_id
        AND leads.company_bio_id = get_auth_company_bio_id()
    )
  );


-- ── 13. app_settings: readable by all authenticated users ────────────────────
-- Already has RLS disabled. Re-enable with a permissive read policy so
-- getSupabaseServer() (anon key + session) can read it.

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read" ON app_settings
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "admin write" ON app_settings
  FOR ALL USING (is_admin());


-- ── Notes ─────────────────────────────────────────────────────────────────────
-- Service role (SUPABASE_SERVICE_KEY) bypasses ALL RLS policies automatically.
-- Use it for: admin page.tsx, webhooks, n8n callbacks, data imports.
-- Use getSupabaseServer() (anon key + session cookie) for all client-facing pages.
