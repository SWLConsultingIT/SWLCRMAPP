-- Dashboard perf (Phase 1): fetch campaign_messages for the dashboard in ONE
-- round-trip instead of ~23 serial paginated ones.
--
-- getDashboardData paged campaign_messages 1000-at-a-time serially (fetchAllRows).
-- For SWL that is ~22k rows = ~23 sequential round-trips — the measured bottleneck
-- of the 20-30s dashboard load (each individual query is only ~40ms; the cost was
-- the serial network hops, NOT the DB or missing indexes — EXPLAIN confirmed the
-- existing indexes idx_campaign_messages_campaign_id + idx_leads_company_status are
-- used and each page runs in ~40-58ms).
--
-- This function returns the SAME bio-scoped rows the old embed fetch returned
-- (campaign_messages ⋈ campaigns ⋈ leads WHERE leads.company_bio_id = p_bio),
-- projected to the exact 6 columns the in-memory aggregations use, with NO
-- pagination and NO 1000-row cap — so the downstream aggregation code is
-- unchanged and every dashboard metric is byte-for-byte identical.
--
-- SECURITY INVOKER (not DEFINER): RLS still applies exactly as it did to the old
-- SSR-client query, so a normal user only sees their tenant's rows and cannot
-- read another tenant's messages by passing a different p_bio. p_bio IS NULL is
-- the super_admin/unscoped path (matches the old "no bio filter" branch, still
-- gated by RLS admin-bypass). No new indexes (EXPLAIN confirmed none are needed).

create or replace function public.dashboard_campaign_messages(p_bio uuid)
returns table (
  id uuid,
  campaign_id uuid,
  step_number int,
  status text,
  sent_at timestamptz,
  channel text
)
language sql
stable
security invoker
set search_path = public
as $$
  select m.id, m.campaign_id, m.step_number::int, m.status::text, m.sent_at::timestamptz, m.channel::text
  from campaign_messages m
  join campaigns c on c.id = m.campaign_id
  join leads l on l.id = c.lead_id
  where p_bio is null or l.company_bio_id = p_bio
$$;

revoke all on function public.dashboard_campaign_messages(uuid) from public, anon;
grant execute on function public.dashboard_campaign_messages(uuid) to authenticated, service_role;
