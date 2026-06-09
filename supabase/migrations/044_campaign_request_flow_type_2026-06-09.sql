-- Add flow_type to campaign_requests so the wizard can branch between the
-- legacy "Generic" path (one template per step, mechanical substitution —
-- $0 extra per lead) and the new "Tailored" path (per-lead AI hook + fit
-- using publications/news/tech stack — ~$0.001/lead).
--
-- Default is 'generic' so existing rows and any in-flight requests behave
-- exactly as today — backward-compatible by construction.
--
-- The new column gates downstream behavior:
--   • V8 generator's prepare-context-v8 node enriches the prompt only for
--     tailored requests.
--   • /api/campaigns/approve runs the tailor pass only for tailored.
--   • Step 3 of the wizard renders the new review surface only for tailored.

ALTER TABLE public.campaign_requests
  ADD COLUMN IF NOT EXISTS flow_type text NOT NULL DEFAULT 'generic'
    CHECK (flow_type IN ('generic', 'tailored'));

COMMENT ON COLUMN public.campaign_requests.flow_type IS
  'generic = one template per step + mechanical {{first_name}} substitution. tailored = per-lead AI-generated hook+fit using the lead''s publications/news/tech stack.';

CREATE INDEX IF NOT EXISTS campaign_requests_flow_type_idx
  ON public.campaign_requests (flow_type)
  WHERE flow_type = 'tailored';
