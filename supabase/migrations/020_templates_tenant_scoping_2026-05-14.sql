-- Templates feature, Phase 1 (Fran 2026-05-14).
--
-- The existing `campaign_templates` table held 6 legacy "automation archetype"
-- seed rows (steps in {action, condition, wait_days} shape — unused by the
-- current campaign pipeline). We extend the table for user-saved templates:
-- a saved template captures a campaign's `sequence_steps` + per-step message
-- content + optional attachments so the seller can apply it to a new
-- campaign without re-typing.
--
-- New columns are all nullable so the legacy seeds stay valid. Tenant
-- isolation: company_bio_id IS NULL means "global seed"; populated value
-- = tenant-owned. The UI filters to tenant-owned by default.
--
-- attachments stays empty for Phase 1A. Phase 1B will populate it via
-- Supabase Storage uploads (PDF/DOCX). The email dispatcher already
-- reads metadata.attachments on campaign_messages, so applying a template
-- just copies the attachments array over.

ALTER TABLE public.campaign_templates
  ADD COLUMN IF NOT EXISTS company_bio_id uuid REFERENCES public.company_bios(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sequence_steps jsonb,
  ADD COLUMN IF NOT EXISTS step_messages jsonb,
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS channels text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS usage_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_campaign_templates_company_bio_id
  ON public.campaign_templates (company_bio_id) WHERE company_bio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_templates_last_used
  ON public.campaign_templates (last_used_at DESC NULLS LAST)
  WHERE company_bio_id IS NOT NULL;

-- Make autovacuum match the rest of public schema (5%/20 — migration 015).
ALTER TABLE public.campaign_templates SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 20,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 20
);
