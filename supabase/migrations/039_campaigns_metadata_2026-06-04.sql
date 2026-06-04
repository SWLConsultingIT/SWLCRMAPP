-- Dispatch was failing for EVERY tenant with a false "lead or campaign missing":
-- the dispatchers (dispatch-queue, dispatch-email) select campaigns.metadata
-- (used for the re-engagement flag: { reengaged, reengaged_at }) but the column
-- never existed. PostgREST errors the whole select on an unknown column → the
-- campaign row comes back null → the dispatcher fails the message as "missing"
-- even though the lead + campaign exist. Adding the column makes the select
-- valid and unblocks dispatch. Applied to prod 2026-06-04 via Management API.
alter table campaigns add column if not exists metadata jsonb;
