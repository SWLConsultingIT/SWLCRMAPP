-- LinkedIn Recovery / Second Attempt (V1) — additive, isolated.
--
-- Business rule: when a campaign completes with a LinkedIn connection request
-- that was never accepted AND the invite is really still pending, wait 5 days,
-- withdraw the invite, wait 21 days from the WITHDRAWAL, send ONE different
-- second connection request, and on acceptance send ONE different LinkedIn DM.
-- Hard cap: 2 connection attempts total. The original campaign stays completed
-- — this table is a separate recovery layer, never a campaign re-open.
--
-- Design:
--   • One recovery row per lead (UNIQUE lead_id) — idempotent enrollment.
--   • `withdrawn_at` is the SOLE source of truth for the 21-day cooldown
--     (`reinvite_after`). We never anchor the cooldown on completion date.
--   • `eligible_withdraw_at` = campaign.completed_at + 5d. Historical campaigns
--     with a NULL completed_at get NO eligible_withdraw_at and stay in SHADOW /
--     MANUAL_REVIEW — never auto-actioned (we don't invent a completion date).
--   • FKs only where safe: lead_id / company_bio_id (own-table outbound FKs, no
--     embed ambiguity with any other table's reads). campaign_id / seller_id are
--     plain uuids on purpose (no FK) to avoid any PostgREST embed ambiguity.
--   • Tenant isolation mirrors activities (20260909): RLS SELECT scoped to the
--     caller's memberships + admin bypass; every write goes through a
--     service-role route/cron.

create table if not exists linkedin_recovery (
  id uuid primary key default gen_random_uuid(),
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  campaign_id uuid,                       -- no FK on purpose (avoid embed ambiguity)
  seller_id uuid,                         -- LinkedIn sending identity (sellers.id)

  original_invitation_id text,            -- Unipile invitation_id of attempt #1 (withdraw handle)
  original_invite_sent_at timestamptz,    -- step0 sent_at of attempt #1

  state text not null default 'SHADOW',

  eligible_withdraw_at timestamptz,       -- completed_at + 5d (NULL ⇒ cannot auto-act)
  withdrawn_at timestamptz,               -- SOURCE OF TRUTH for the cooldown
  reinvite_after timestamptz,             -- withdrawn_at + 21d

  second_invitation_id text,
  second_invite_sent_at timestamptz,
  second_message_id text,
  second_message_sent_at timestamptz,

  second_connection_note text,            -- attempt #2 CR note (must differ from #1)
  second_dm text,                         -- attempt #2 post-accept DM (must differ from #1)
  copy_approved_at timestamptz,
  copy_approved_by uuid,

  attempt_count int not null default 1,   -- 1 = original only; 2 = second sent
  stop_reason text,
  last_error text,
  retry_count int not null default 0,
  next_retry_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint linkedin_recovery_lead_uniq unique (lead_id),
  constraint linkedin_recovery_attempt_chk check (attempt_count >= 0 and attempt_count <= 2),
  constraint linkedin_recovery_state_chk check (state in (
    'SHADOW',
    'WAITING_WITHDRAWAL',
    'WITHDRAWING',
    'WAITING_REINVITE',
    'SECOND_INVITE_SENDING',
    'SECOND_INVITE_SENT',
    'SECOND_MESSAGE_SENDING',
    'DONE',
    'STOPPED_UNACCEPTED',
    'CANCELLED_ACCEPTED',
    'CANCELLED_TERMINAL',
    'CANCELLED_SUPPRESSED',
    'MANUAL_REVIEW',
    'FAILED'
  ))
);

-- Cron scans by state; the two timed gates and the per-seller cap window each
-- get a partial/targeted index so the worker query stays cheap.
create index if not exists idx_linkedin_recovery_state on linkedin_recovery (state);
create index if not exists idx_linkedin_recovery_waiting_withdrawal
  on linkedin_recovery (eligible_withdraw_at)
  where state = 'WAITING_WITHDRAWAL';
create index if not exists idx_linkedin_recovery_waiting_reinvite
  on linkedin_recovery (reinvite_after)
  where state = 'WAITING_REINVITE';
create index if not exists idx_linkedin_recovery_seller_second_invite
  on linkedin_recovery (seller_id, second_invite_sent_at);
create index if not exists idx_linkedin_recovery_company on linkedin_recovery (company_bio_id);

-- keep updated_at honest
create or replace function public.touch_linkedin_recovery_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_touch_linkedin_recovery on linkedin_recovery;
create trigger trg_touch_linkedin_recovery
  before update on linkedin_recovery
  for each row execute function public.touch_linkedin_recovery_updated_at();

alter table linkedin_recovery enable row level security;

-- Reads: members of the owning tenant; writes are service-role only (cron/admin
-- route), same as activities / notifications.
drop policy if exists linkedin_recovery_select_tenant on linkedin_recovery;
create policy linkedin_recovery_select_tenant on linkedin_recovery
  for select using (
    company_bio_id in (
      select company_bio_id from user_company_memberships where user_id = auth.uid()
    )
  );

drop policy if exists linkedin_recovery_select_admin on linkedin_recovery;
create policy linkedin_recovery_select_admin on linkedin_recovery
  for select using (is_auth_admin());
