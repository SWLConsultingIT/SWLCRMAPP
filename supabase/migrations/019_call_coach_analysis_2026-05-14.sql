-- AI Sales Coach for call transcripts (feature requested by Fran 2026-05-14).
--
-- Persists Claude-generated coaching analysis on each `calls` row so the
-- expensive LLM call (Opus 4.7 ~$0.05 per analysis) only fires once per
-- call. Re-generation requires explicit `?force=1` from the UI button.
--
-- coach_score: extracted from the analysis markdown ("Overall Score: X/10")
-- so the UI can render a badge without re-parsing the full text. Nullable
-- because old rows have no analysis yet.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS coach_analysis text,
  ADD COLUMN IF NOT EXISTS coach_score int,
  ADD COLUMN IF NOT EXISTS coach_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS coach_model text;
