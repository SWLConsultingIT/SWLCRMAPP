-- Per-flow Instantly campaign mapping. One Instantly campaign per GrowthEngine
-- flow (instead of one shared per-tenant passthrough) so a bad list in one
-- flow only triggers Instantly's bounce auto-pause for that flow, not every
-- email flow of the tenant. See lib/instantly-flow-campaign.ts.
create table if not exists public.instantly_flow_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_bio_id uuid not null references public.company_bios(id) on delete cascade,
  flow_name text not null,
  instantly_campaign_id text not null,
  created_at timestamptz not null default now(),
  unique (company_bio_id, flow_name)
);
alter table public.instantly_flow_campaigns enable row level security;
create index if not exists idx_ifc_bio on public.instantly_flow_campaigns(company_bio_id);
