-- Library of reusable outreach templates per tenant. The Message Generator V7 Pro
-- pulls relevant rows as few-shot examples when generating personalized messages.
--
-- Tenant isolation via RLS (matches the pattern used by leads / icp_profiles /
-- campaigns). Service role bypasses for server-side workflow access.

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  icp_profile_id uuid references icp_profiles(id) on delete set null,
  industry text,
  channel text not null,                    -- linkedin / email / whatsapp / sms / call
  step_position text not null,              -- connection_request / first_dm / followup_1 / followup_2 / cta / breakup / other
  label text,                               -- short human label, e.g. "Pathway opener — Asset finance"
  template_text text not null,
  tone_tags text[] default '{}',            -- e.g. ['formal','direct'] / ['casual','witty']
  performance_score numeric,                -- optional, manual or computed later
  status text not null default 'active',    -- active / draft / archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index message_templates_company_bio_id_idx on message_templates(company_bio_id);
create index message_templates_lookup_idx on message_templates(company_bio_id, channel, step_position, status);

alter table message_templates enable row level security;
create policy "tenant isolation" on message_templates
  for all
  using (company_bio_id = get_auth_company_bio_id())
  with check (company_bio_id = get_auth_company_bio_id());
