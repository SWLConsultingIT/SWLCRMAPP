-- 024_sellers_rls_shared_2026-05-15.sql
--
-- The old "tenant isolation" policy on `sellers` was `FOR ALL USING (
-- company_bio_id = get_auth_company_bio_id() OR is_auth_admin() )`. That
-- correctly scoped writes to the owning tenant, but it also blocked SELECT
-- for the tenants in `shared_with_company_bio_ids`, defeating the admin
-- "Share with this client" toggle: shared sellers were never visible to
-- the receiving tenant's non-admin users.
--
-- Split the policy so SELECT also allows shared tenants, while INSERT /
-- UPDATE / DELETE stay owner-or-admin only. Receiving tenants get read-only
-- access to shared seller rows.

BEGIN;

DROP POLICY IF EXISTS "tenant isolation" ON sellers;

CREATE POLICY "sellers_select_own_or_shared" ON sellers
  FOR SELECT
  USING (
    company_bio_id = get_auth_company_bio_id()
    -- shared_with_company_bio_ids is text[] (legacy); cast both sides through
    -- text so the equality is well-typed.
    OR get_auth_company_bio_id()::text = ANY(shared_with_company_bio_ids)
    OR is_auth_admin()
  );

CREATE POLICY "sellers_insert_owner_only" ON sellers
  FOR INSERT
  WITH CHECK (
    company_bio_id = get_auth_company_bio_id()
    OR is_auth_admin()
  );

CREATE POLICY "sellers_update_owner_only" ON sellers
  FOR UPDATE
  USING (
    company_bio_id = get_auth_company_bio_id()
    OR is_auth_admin()
  )
  WITH CHECK (
    company_bio_id = get_auth_company_bio_id()
    OR is_auth_admin()
  );

CREATE POLICY "sellers_delete_owner_only" ON sellers
  FOR DELETE
  USING (
    company_bio_id = get_auth_company_bio_id()
    OR is_auth_admin()
  );

COMMIT;
