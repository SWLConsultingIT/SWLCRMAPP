-- Human owner/caller per lead, decoupled from the LinkedIn/channel SENDING
-- identity.
--
-- Today `campaign.seller_id` does double duty: (1) which `sellers` row
-- (LinkedIn/Unipile/email/Aircall account + daily limits) SENDS the outreach,
-- and (2) which human "owns"/works/calls the lead. That forced 1 human = 1
-- LinkedIn. Reality: one shared LinkedIn account can send while several humans
-- split the calling (e.g. 300 leads / 3 reps = 100 each).
--
-- This adds a parallel "assigned human" dimension WITHOUT touching sending:
--   * seller_id            → stays the SENDING identity (dispatcher unchanged,
--                            zero risk to live outreach).
--   * assigned_user_id     → the HUMAN (auth.users id) who works/calls this lead.
--
-- Leads get divided among assigned humans exactly like the flow-creation seller
-- split, settable at creation AND later from the flow detail (even while active).
-- tier=seller scoping and call attribution move to assigned_user_id.
--
-- Backfill: existing campaigns inherit the human currently implied by their
-- sending seller (seller_id → sellers.user_id) so nothing changes for live flows.

alter table public.campaigns add column if not exists assigned_user_id uuid;

comment on column public.campaigns.assigned_user_id is
  'Human (auth.users id) who works/calls this lead. Decoupled from seller_id (the LinkedIn/channel SENDING identity). Drives tier=seller scoping and call attribution.';

-- Backfill from the current sending seller''s linked user so existing flows keep
-- their implied ownership. Only where the seller maps to a real user.
update public.campaigns c
   set assigned_user_id = s.user_id
  from public.sellers s
 where c.seller_id = s.id
   and s.user_id is not null
   and c.assigned_user_id is null;

-- Scoping filters campaigns by assigned_user_id (per tenant via the leads
-- embed), so index it.
create index if not exists idx_campaigns_assigned_user_id
  on public.campaigns (assigned_user_id);
