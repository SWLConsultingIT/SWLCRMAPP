-- 040 — ICP company size multi-select buckets
-- Adds a text[] column so an ICP can target several employee-count bands at once
-- (the old single `company_size` text stays as a legacy/freeform fallback and is
-- still rendered when no buckets are set, e.g. the PE/VC "AUM 10M-5B" profiles).
-- Applied via Management API on 2026-06-04.

ALTER TABLE public.icp_profiles
  ADD COLUMN IF NOT EXISTS company_size_buckets text[];
