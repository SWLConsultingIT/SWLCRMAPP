-- RBAC Phase 5 — link seller records to auth users.
--
-- Why: with the tier system from migration 010, we have `tier='seller'`
-- users. They should only see leads + campaigns whose `seller_id` belongs
-- to a sellers row whose `user_id` equals their auth.uid().
--
-- Today this is enforced server-side (see getMyAssignedSellerIds in
-- lib/scope.ts). RLS-level enforcement deferred to a later migration once
-- the JWT carries the user's tier — meanwhile every read path filters in
-- the API layer.
--
-- One auth user can map to many seller records (a person who is the seller
-- on multiple campaigns/inboxes). The Team UI exposes a single-select for
-- simplicity but the schema supports multi-link.

ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sellers_user_id
  ON public.sellers(user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.sellers.user_id IS
  'Auth user this seller record belongs to. NULL = unassigned. When tier=seller, app filters leads/campaigns by sellers where user_id = auth.uid().';
