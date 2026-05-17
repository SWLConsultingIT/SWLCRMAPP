-- 026_template_icp_2026-05-17.sql
--
-- Templates are inherently tied to a single ICP (the PDFs that seed them,
-- the detected cadence, the message hooks — all of those are ICP-specific).
-- Adding `icp_profile_id` so the Templates UI can group by ICP and so the
-- per-lead generator can validate that a lead's ICP matches the template's
-- ICP before applying.
--
-- Nullable in DB:
--   - Legacy templates created before this migration will be NULL.
--   - The app surfaces a "Needs ICP" section + quick-assign menu so the
--     tenant can backfill at their own pace.
--   - New templates created via the wizard must include it (validated at
--     the POST /api/templates layer, not via DB constraint).
--
-- ON DELETE SET NULL so deleting an ICP doesn't cascade-orphan its templates
-- — they survive and get surfaced in the "Needs ICP" bucket for reassignment.

BEGIN;

ALTER TABLE campaign_templates
  ADD COLUMN IF NOT EXISTS icp_profile_id uuid
    REFERENCES icp_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_templates_icp_profile_id
  ON campaign_templates(icp_profile_id)
  WHERE icp_profile_id IS NOT NULL;

COMMENT ON COLUMN campaign_templates.icp_profile_id IS
  'Required for new templates (enforced at API). Legacy rows may be NULL and surface in a Needs ICP bucket. ON DELETE SET NULL keeps templates around when an ICP is deleted.';

COMMIT;
