-- Per-tenant enrichment schema — generic enrichment fields per company_bio.
--
-- Problem: today the leads table has 10 hardcoded `personalized_info_*` columns plus a
-- generic `enrichment` JSONB. Each tenant has its own value vocabulary (Pathway needs
-- RFA rating + credit score + Companies House data; a SaaS agency needs MRR + funding
-- rounds + tech stack; a recruiter needs hiring signals + Glassdoor rating). With the
-- current schema we have no way to define those per-tenant.
--
-- Solution: company_bios.enrichment_schema is a JSONB array describing each tenant's
-- enrichment vocabulary. Each entry defines a key (column key in the JSONB enrichment),
-- a human label (for the UI), a type, an optional category, priority for ordering, and
-- optional aliases (other names to try when auto-mapping a CSV column).
--
-- Schema entry shape:
--   {
--     "key": "rfa_rating",                     -- key inside leads.enrichment JSONB
--     "label": "RFA Rating",                   -- shown in UI
--     "type": "text",                          -- text | number | url | date | enum
--     "category": "credit",                    -- grouping for the UI panel
--     "priority": 1,                           -- ordering within category
--     "show_in_signals": true,                 -- show in SignalPicker
--     "show_in_panel": true,                   -- show in PersonalizedInfoPanel
--     "aliases": ["RFA Rating", "Credit Rating", "rating"],  -- for AI column mapping
--     "options": ["GOLD","SILVER","BRONZE"]    -- only for type=enum
--   }
--
-- After this migration, the 10 personalized_info_* columns in leads remain for backward
-- compatibility but new clients should use enrichment + schema. A future migration can
-- migrate old data and drop those columns.

ALTER TABLE public.company_bios
  ADD COLUMN IF NOT EXISTS enrichment_schema JSONB DEFAULT '[]'::jsonb;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_company_bios_enrichment_schema_keys
  ON public.company_bios USING GIN ((enrichment_schema));

-- Comment for clarity
COMMENT ON COLUMN public.company_bios.enrichment_schema IS
  'Per-tenant enrichment vocabulary. Array of {key,label,type,category,priority,show_in_signals,show_in_panel,aliases,options}. Drives SignalPicker, PersonalizedInfoPanel, and the AI column mapper for sheet imports.';
