-- Drop legacy personalized_info_1..10 columns from leads.
--
-- Context: these were 10 hardcoded text columns used as a generic dumping ground
-- for any "extra" enrichment a scraping tool produced (Pathway's RFA fields,
-- etc.). They forced every lead to fit into a fixed 10-slot shape that doesn't
-- scale across different scrapers/clients.
--
-- Replacement: leads.enrichment JSONB (already exists). The Sheets Sync n8n
-- workflow now routes any non-canonical sheet column to enrichment[col_name].
-- The sheet template's EXTRAS section grows dynamically per-scrape.
--
-- Safety: pre-migration, only 1 lead exists in the DB (Francisco test) and
-- all 10 personalized_info_* columns are NULL across all leads. No data loss.

ALTER TABLE public.leads
  DROP COLUMN IF EXISTS personalized_info_1,
  DROP COLUMN IF EXISTS personalized_info_2,
  DROP COLUMN IF EXISTS personalized_info_3,
  DROP COLUMN IF EXISTS personalized_info_4,
  DROP COLUMN IF EXISTS personalized_info_5,
  DROP COLUMN IF EXISTS personalized_info_6,
  DROP COLUMN IF EXISTS personalized_info_7,
  DROP COLUMN IF EXISTS personalized_info_8,
  DROP COLUMN IF EXISTS personalized_info_9,
  DROP COLUMN IF EXISTS personalized_info_10;
