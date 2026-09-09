-- Activities — a real per-lead activity / task system for sellers (P0).
--
-- ADDITIVE and independent: this does NOT replace or touch `leads.opportunity_stage`
-- (the "Pipeline Stage" that feeds Results/Odoo). Activities is a new domain that
-- lives alongside it, so sellers can manage follow-ups, callbacks and pending work.
--
-- Design notes:
--   • `status` is only pending | completed | cancelled. "Overdue / Today / Upcoming"
--     are DERIVED from due_at at read time — never persisted (a persisted "overdue"
--     would drift the moment the clock ticks).
--   • `type` / `status` / `source` store CANONICAL snake_case tokens. The UI
--     translates them per-locale — we never persist a translated label.
--   • Tenant isolation mirrors lead_seller_tags (033): RLS SELECT scoped to the
--     caller's memberships; every write goes through a service-role API route.
--   • lead_id is nullable so a generic Task/Other (no lead) is representable, but
--     the common case carries a lead and the consolidated view links to it.

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  -- 'call' | 'email' | 'follow_up' | 'prepare_proposal' | 'meeting' | 'task' | 'other'
  type text not null default 'task',
  title text not null,
  description text,
  assigned_to uuid,               -- the human seller/user responsible (auth user id)
  created_by uuid,                -- who created it (auth user id)
  due_at timestamptz,             -- nullable: not every activity is time-bound
  completed_at timestamptz,
  -- 'pending' | 'completed' | 'cancelled'
  status text not null default 'pending',
  -- 'low' | 'normal' | 'high' (nullable — most are normal)
  priority text,
  -- provenance: 'manual' | 'call_callback' | 'inbox' | ...
  source text not null default 'manual',
  source_reference_id uuid,       -- e.g. the originating call id / reply id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_status_chk check (status in ('pending','completed','cancelled'))
);

-- Consolidated "My Activities" view sorts by due_at within an assignee+status; the
-- Lead Detail section reads by lead. Tenant dashboards read by company+status+due.
create index if not exists idx_activities_assignee_status_due
  on activities (assigned_to, status, due_at);
create index if not exists idx_activities_lead on activities (lead_id);
create index if not exists idx_activities_company_status_due
  on activities (company_bio_id, status, due_at);

alter table activities enable row level security;

-- Reads: any member of the owning tenant may see the tenant's activities (the app
-- narrows to "mine vs all sellers" per permission on top of this). Writes are
-- service-role only (API routes), same as notifications / lead_seller_tags.
drop policy if exists activities_select_tenant on activities;
create policy activities_select_tenant on activities
  for select using (
    company_bio_id in (
      select company_bio_id from user_company_memberships where user_id = auth.uid()
    )
  );

-- Admin-bypass mirror (matches migration 041 pattern) so super_admin tooling and
-- the auth-admin role can read across tenants when impersonating.
drop policy if exists activities_select_admin on activities;
create policy activities_select_admin on activities
  for select using (is_auth_admin());
