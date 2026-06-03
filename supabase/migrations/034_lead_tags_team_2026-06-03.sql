-- Tagging targets the whole team now (any tenant user), not just sellers.
-- Replaces lead_seller_tags (brand-new in 033, seller-only) with a user-keyed
-- lead_tags table. Additive + drop of the just-created seller table.
create table if not exists lead_tags (
  lead_id uuid not null references leads(id) on delete cascade,
  user_id uuid not null,
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  tagged_by uuid,
  created_at timestamptz not null default now(),
  primary key (lead_id, user_id)
);
create index if not exists idx_lead_tags_lead on lead_tags (lead_id);

alter table lead_tags enable row level security;
drop policy if exists lead_tags_select_tenant on lead_tags;
create policy lead_tags_select_tenant on lead_tags
  for select using (
    company_bio_id in (
      select company_bio_id from user_company_memberships where user_id = auth.uid()
    )
  );

drop table if exists lead_seller_tags;
