-- Per-seller weekly meeting target, for the Home "My performance this week"
-- progress bar.
--
-- WHY IT IS NEEDED: audited 2026-09-14, nothing reusable exists. The four
-- target-ish columns in the schema are unrelated — campaign_requests.
-- target_leads_count is how many leads to mine, and company_bios.target_market
-- / icp_profiles.target_industries / target_roles define an ICP. Every numeric
-- column on `sellers` is a per-day SENDING cap (linkedin_daily_limit,
-- call_daily_limit, …), not a commercial goal.
--
-- WHY ON `sellers` AND NOT A TENANT CONFIG: the target is the seller's own
-- commitment and differs between people on the same team. Putting it on the
-- tenant would force one number on everybody, and Fran explicitly rejected
-- hardcoded per-tenant config.
--
-- NULLABLE ON PURPOSE — it is the whole feature contract:
--   target set  → Home shows "6 / 10 meetings booked" + progress bar
--   target NULL → Home shows "6 meetings booked", no bar, no denominator
-- A default would invent a goal nobody agreed to and make the bar lie, so
-- there is none. Existing sellers stay NULL and render the second form.

ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS weekly_meeting_target integer;

-- A target of 0 is not "no target" (that is NULL) and a negative one is
-- meaningless; both would divide the progress bar by garbage.
ALTER TABLE sellers
  DROP CONSTRAINT IF EXISTS sellers_weekly_meeting_target_positive;
ALTER TABLE sellers
  ADD CONSTRAINT sellers_weekly_meeting_target_positive
  CHECK (weekly_meeting_target IS NULL OR weekly_meeting_target > 0);

COMMENT ON COLUMN sellers.weekly_meeting_target IS
  'Meetings this seller aims to book per week. NULL = no target set; Home then shows the count with no denominator and no progress bar. Must be > 0 when present.';
