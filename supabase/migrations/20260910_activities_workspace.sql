-- Activities → operational workspace (block 1). Additive. NOT applied to prod.
--
--   • due_tz: the IANA timezone the user scheduled the activity in. due_at stays
--     the absolute/canonical instant (for queries/order/reminders); due_tz lets
--     us render + reschedule in the human's intended zone, DST-correct.
--   • reminder_offset_minutes: fire the reminder this many minutes BEFORE due_at
--     (NULL = at due_at / arch default). Callbacks get a default offset.
--   • activity_events: append-only audit trail (created/edited/rescheduled/
--     completed/cancelled/assigned/reopened) — base for the Drawer's history.

alter table activities add column if not exists due_tz text;
alter table activities add column if not exists reminder_offset_minutes integer;
comment on column activities.due_tz is
  'IANA tz the user scheduled the due time in; due_at remains the absolute instant.';

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  company_bio_id uuid references company_bios(id) on delete cascade,
  actor_user_id uuid,
  event text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_activity_events_activity on activity_events (activity_id, created_at);

alter table activity_events enable row level security;
-- Reads scoped to the caller's tenant; all writes go through service-role routes.
drop policy if exists activity_events_select_tenant on activity_events;
create policy activity_events_select_tenant on activity_events
  for select using (
    company_bio_id in (
      select company_bio_id from user_company_memberships where user_id = auth.uid()
    )
  );
drop policy if exists activity_events_select_admin on activity_events;
create policy activity_events_select_admin on activity_events
  for select using (is_auth_admin());
