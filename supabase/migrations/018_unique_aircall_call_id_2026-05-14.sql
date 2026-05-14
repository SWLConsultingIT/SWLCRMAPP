-- Roadmap #1 (P0) from scale audit 2026-05-14.
--
-- Aircall retries webhooks (normal behavior). The aircall/webhook route
-- previously: PATCH if exists, else INSERT — with no unique guard. Under
-- retries, the PATCH ran twice (safe) but the INSERT path could race and
-- duplicate rows for the same Aircall call_id. We saw zero collisions today
-- (verified pre-flight), but at scale that breaks call counts, links the
-- recording to multiple rows, and confuses transcripts.
--
-- Using a partial UNIQUE index instead of an outright UNIQUE constraint so
-- manual / non-Aircall calls (aircall_call_id IS NULL) aren't blocked. NULL
-- is intentionally non-unique here.
--
-- Pairs with: app/api/aircall/webhook/route.ts switching its INSERT to
-- upsert via `Prefer: resolution=merge-duplicates` + `on_conflict=
-- aircall_call_id` so a retry resolves to a merge instead of a 23505 error.

CREATE UNIQUE INDEX IF NOT EXISTS calls_aircall_call_id_unique
  ON public.calls (aircall_call_id)
  WHERE aircall_call_id IS NOT NULL;
