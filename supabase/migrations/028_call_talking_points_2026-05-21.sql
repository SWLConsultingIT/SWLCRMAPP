-- 028 — Pre-call brief: 3 talking points per lead
--
-- AI-generated when a seller first views the lead (or via explicit refresh),
-- shown in the lead detail header card and as a Queue card hover preview.
-- Separate from ai_summary because the talking points are operational ("what
-- to say in the next 30s") while ai_summary is research ("who is this
-- person"). Storing as jsonb (rather than three text columns) keeps the
-- door open for future enrichment of each point (e.g. a citation source).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS call_talking_points    jsonb,
  ADD COLUMN IF NOT EXISTS call_talking_points_at timestamptz;
