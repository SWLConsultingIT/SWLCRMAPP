-- Quick-scan call summary (Fran 2026-05-14).
--
-- Distinct from coach_analysis:
--   - coach_analysis: deep, multi-section, Sonnet 4.6, manual trigger, ~$0.02
--   - summary: 1-2 sentences, Haiku 4.5, auto-generated when transcript
--     lands, ~$0.0005. Always visible in the UI so the seller can scan
--     the call in 2 seconds without reading the full transcript.
--
-- Both share the same input (transcript + lead/tenant context) but answer
-- different questions: "what happened?" vs "how can I improve?".

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS summary_model text;
