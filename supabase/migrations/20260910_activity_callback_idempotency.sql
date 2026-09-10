-- Callback idempotency (phase 2). Additive. NOT applied to prod.
-- Guarantees at most ONE call_callback activity per originating call, so a retry
-- or double-submit of the same call's outcome can never create a duplicate
-- callback (the route also checks-first; this is the DB-level backstop).
create unique index if not exists uq_activities_call_callback
  on activities (source_reference_id)
  where source = 'call_callback' and source_reference_id is not null;
