-- Roadmap #3 (P1) from scale audit 2026-05-14.
--
-- `instantly_workspaces` holds Instantly API keys per workspace. Migration 013
-- created the table but never ran ENABLE ROW LEVEL SECURITY, leaving it
-- readable by any client with the anon key if they guess the table name.
--
-- The dispatcher uses service-role (bypasses RLS), so this policy only
-- affects browser / anon paths — which should NEVER touch this table.
-- We gate to super_admin only because Instantly workspaces are an SWL-ops
-- resource, not per-tenant (one workspace can serve multiple tenants via
-- company_bios.instantly_workspace_id).

ALTER TABLE public.instantly_workspaces ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing copy of this policy (idempotent re-run safety).
DROP POLICY IF EXISTS "instantly_workspaces_super_admin_only" ON public.instantly_workspaces;

CREATE POLICY "instantly_workspaces_super_admin_only"
  ON public.instantly_workspaces
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = auth.uid() AND tier = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = auth.uid() AND tier = 'super_admin'
    )
  );
