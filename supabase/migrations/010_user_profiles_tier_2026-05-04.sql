-- Multi-tenant RBAC — add tier column to user_profiles.
--
-- The legacy `role` column was binary: 'admin' (SWL super-admin, cross-tenant)
-- vs 'client' (any tenant user). To support per-tenant role hierarchy
-- (Pathway's Graeme as `owner`, plus future managers / sellers / viewers),
-- we add a `tier` column with 5 values.
--
-- Backwards compat: `role` is kept untouched for now. Code reads `tier` going
-- forward; the legacy `role` will be deprecated after every caller is migrated.
--
-- Mapping during backfill:
--   role = 'admin'  → tier = 'super_admin'
--   role = 'client' → tier = 'owner'
--
-- Future tiers (created via team-management UI):
--   'manager' — same data access as owner, no team management
--   'seller'  — only their own assigned leads + campaigns
--   'viewer'  — read-only across the tenant

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS tier text;

UPDATE public.user_profiles
  SET tier = CASE
    WHEN role = 'admin' THEN 'super_admin'
    WHEN role = 'client' THEN 'owner'
    ELSE 'viewer'
  END
  WHERE tier IS NULL;

ALTER TABLE public.user_profiles
  ALTER COLUMN tier SET NOT NULL;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS valid_tier;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT valid_tier CHECK (
    tier IN ('super_admin', 'owner', 'manager', 'seller', 'viewer')
  );

COMMENT ON COLUMN public.user_profiles.tier IS
  'RBAC tier: super_admin (SWL only) | owner (full per-tenant admin) | manager (tenant-wide, no team mgmt) | seller (own leads only) | viewer (read-only).';
