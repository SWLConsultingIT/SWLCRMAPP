-- Track who wrote each lead note so the Team Notes UI in the lead detail
-- can show real attribution instead of a hardcoded "Team" label.
--
-- `created_by` is the FK to auth.users for joins; `author_name` is a
-- denormalized snapshot of the writer's display name at write-time so the
-- UI doesn't need a join per render and historical notes stay attributed
-- even if the user leaves the workspace later.
--
-- Index on (lead_id, created_at DESC) so the per-lead notes feed renders
-- without a sort step.

ALTER TABLE lead_notes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS author_name text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id_created_at
  ON lead_notes(lead_id, created_at DESC);
