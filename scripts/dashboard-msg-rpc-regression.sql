-- Regression for the dashboard_campaign_messages RPC (Phase 1 perf change).
-- Proves the RPC returns the EXACT same row set the old paginated embed fetch
-- returned (campaign_messages ⋈ campaigns ⋈ leads WHERE bio), for BOTH the
-- tenant-scoped and the unscoped (super_admin, p_bio NULL) cases. Same rows in →
-- identical downstream aggregations (that code is unchanged).
--
-- PASS = both *_in_rpc_not_direct and *_in_direct_not_rpc are 0 and the counts
-- match. Replace the bio uuid with the tenant you want to check.
--
-- Result on 2026-09-03 (SWL bio 7c02e222-…):
--   rpc_swl_n=22013 direct_swl_n=22013  swl diffs 0/0
--   rpc_all_n=34833 direct_all_n=34833  all diffs 0/0   → identical.

with
rpc_swl as (select * from public.dashboard_campaign_messages('7c02e222-be59-416d-9434-acf4685f8590')),
direct_swl as (
  select m.id, m.campaign_id, m.step_number::int step_number, m.status::text status, m.sent_at::timestamptz sent_at, m.channel::text channel
  from campaign_messages m join campaigns c on c.id=m.campaign_id join leads l on l.id=c.lead_id
  where l.company_bio_id='7c02e222-be59-416d-9434-acf4685f8590'),
rpc_all as (select * from public.dashboard_campaign_messages(null)),
direct_all as (
  select m.id, m.campaign_id, m.step_number::int step_number, m.status::text status, m.sent_at::timestamptz sent_at, m.channel::text channel
  from campaign_messages m join campaigns c on c.id=m.campaign_id join leads l on l.id=c.lead_id)
select
  (select count(*) from rpc_swl)  as rpc_swl_n,
  (select count(*) from direct_swl) as direct_swl_n,
  (select count(*) from (select * from rpc_swl except select * from direct_swl) a) as swl_in_rpc_not_direct,
  (select count(*) from (select * from direct_swl except select * from rpc_swl) b) as swl_in_direct_not_rpc,
  (select count(*) from rpc_all)  as rpc_all_n,
  (select count(*) from direct_all) as direct_all_n,
  (select count(*) from (select * from rpc_all except select * from direct_all) c) as all_in_rpc_not_direct,
  (select count(*) from (select * from direct_all except select * from rpc_all) d) as all_in_direct_not_rpc;
