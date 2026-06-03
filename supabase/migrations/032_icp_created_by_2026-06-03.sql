-- Track who created each ICP so the detail view + exported PDF can show
-- "Created by <account>". Additive + nullable: existing rows stay null and
-- render no creator line. Stamped client-side on insert (app/icp/page.tsx
-- handleCreate) with the auth user's id + email.
ALTER TABLE icp_profiles
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_by_email text;
