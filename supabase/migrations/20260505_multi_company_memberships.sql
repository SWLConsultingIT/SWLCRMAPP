-- Multi-company memberships: a user can belong to N tenants with a per-tenant tier.
-- Replaces the old "user_profiles.company_bio_id + tier" single-tenant model.
--
-- Apply order:
--   1. Create the new table.
--   2. Promote super_admin from user_profiles.tier to user_profiles.is_super_admin.
--   3. Backfill memberships from existing user_profiles rows.
--   4. RLS policies on the new table.
--   5. user_profiles.company_bio_id and user_profiles.tier remain for backwards
--      compatibility during the rollout. They will be dropped in a follow-up
--      migration once all reads route through user_company_memberships.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Memberships table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_company_memberships (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_bio_id uuid NOT NULL REFERENCES company_bios(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('owner', 'manager', 'seller', 'viewer')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_bio_id)
);

CREATE INDEX IF NOT EXISTS user_company_memberships_user_idx
  ON user_company_memberships (user_id);
CREATE INDEX IF NOT EXISTS user_company_memberships_bio_idx
  ON user_company_memberships (company_bio_id);

COMMENT ON TABLE user_company_memberships IS
  'Many-to-many: a user can belong to multiple tenants with a different tier in each.';
COMMENT ON COLUMN user_company_memberships.tier IS
  'Per-tenant role. owner = full admin of this tenant; manager = read/write; seller = own leads only; viewer = read-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Promote super_admin to a global flag on user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

UPDATE user_profiles
SET is_super_admin = true
WHERE tier = 'super_admin';

COMMENT ON COLUMN user_profiles.is_super_admin IS
  'Cross-tenant SWL ops. Bypasses memberships and can access any tenant.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill memberships from existing user_profiles rows
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO user_company_memberships (user_id, company_bio_id, tier, created_at)
SELECT
  up.user_id,
  up.company_bio_id,
  CASE
    WHEN up.tier = 'super_admin' THEN 'owner'   -- super_admins also get an owner row in their primary tenant
    WHEN up.tier IN ('owner','manager','seller','viewer') THEN up.tier
    WHEN up.role = 'admin' THEN 'owner'
    ELSE 'viewer'
  END,
  COALESCE(up.created_at, now())
FROM user_profiles up
WHERE up.company_bio_id IS NOT NULL
ON CONFLICT (user_id, company_bio_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS policies
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_company_memberships ENABLE ROW LEVEL SECURITY;

-- A user can read their own memberships (so the tenant switcher can list them).
DROP POLICY IF EXISTS user_memberships_self_read ON user_company_memberships;
CREATE POLICY user_memberships_self_read ON user_company_memberships
  FOR SELECT USING (user_id = auth.uid());

-- An owner of a tenant can read all memberships of that tenant (team management).
DROP POLICY IF EXISTS user_memberships_owner_read ON user_company_memberships;
CREATE POLICY user_memberships_owner_read ON user_company_memberships
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_company_memberships m
      WHERE m.user_id = auth.uid()
        AND m.company_bio_id = user_company_memberships.company_bio_id
        AND m.tier IN ('owner', 'manager')
    )
  );

-- Super admins read everything.
DROP POLICY IF EXISTS user_memberships_super_admin_read ON user_company_memberships;
CREATE POLICY user_memberships_super_admin_read ON user_company_memberships
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND is_super_admin = true)
  );

-- Writes through service_role only — invitation flow runs via API route.
-- (No INSERT/UPDATE/DELETE policy = denied for anon/authenticated users.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Helper RPCs used by RLS on other tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns the tenants the calling user is a member of (or all tenants for super_admin).
CREATE OR REPLACE FUNCTION get_my_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND is_super_admin = true)
      THEN (SELECT id FROM company_bios)  -- super_admin sees all
    ELSE NULL
  END
  UNION
  SELECT company_bio_id FROM user_company_memberships WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION get_my_tenant_ids() TO authenticated;

COMMENT ON FUNCTION get_my_tenant_ids IS
  'Returns the company_bio_ids the caller can access. Super admins get every tenant.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION user_company_memberships_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_company_memberships_updated_at ON user_company_memberships;
CREATE TRIGGER user_company_memberships_updated_at
BEFORE UPDATE ON user_company_memberships
FOR EACH ROW
EXECUTE FUNCTION user_company_memberships_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification queries (uncomment to inspect after running)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT count(*) AS profiles_total FROM user_profiles WHERE company_bio_id IS NOT NULL;
-- SELECT count(*) AS memberships_total FROM user_company_memberships;
-- SELECT count(*) AS super_admins FROM user_profiles WHERE is_super_admin = true;
