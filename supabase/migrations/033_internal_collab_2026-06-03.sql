-- Internal collaboration, Phase 1: real notifications + multi-seller lead tags
-- + @mentions on team notes. Additive. RLS ON with policies on the new tables
-- (browser reads only via the recipient/tenant policy — used for Realtime
-- delivery; all writes go through service-role API routes).

-- ── notifications ── the first persisted notification feed in the app.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  recipient_user_id uuid not null,
  actor_user_id uuid,
  actor_name text,
  type text not null,                 -- 'mention' | 'tag' | 'note' | 'message'
  lead_id uuid references leads(id) on delete cascade,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_recipient
  on notifications (recipient_user_id, read_at, created_at desc);

alter table notifications enable row level security;
drop policy if exists notifications_select_own on notifications;
create policy notifications_select_own on notifications
  for select using (recipient_user_id = auth.uid());

-- ── lead_seller_tags ── many sellers tagged on a lead (leads.seller_id stays
-- the single owner). Tenant column kept direct for fast/simple policies.
create table if not exists lead_seller_tags (
  lead_id uuid not null references leads(id) on delete cascade,
  seller_id uuid not null references sellers(id) on delete cascade,
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  tagged_by uuid,
  created_at timestamptz not null default now(),
  primary key (lead_id, seller_id)
);
create index if not exists idx_lead_seller_tags_lead on lead_seller_tags (lead_id);

alter table lead_seller_tags enable row level security;
drop policy if exists lead_seller_tags_select_tenant on lead_seller_tags;
create policy lead_seller_tags_select_tenant on lead_seller_tags
  for select using (
    company_bio_id in (
      select company_bio_id from user_company_memberships where user_id = auth.uid()
    )
  );

-- ── @mentions on existing team notes ──
alter table lead_notes add column if not exists mentioned_user_ids uuid[];
