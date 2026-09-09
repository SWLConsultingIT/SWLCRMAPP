-- Web Push subscriptions (P2b). One row per browser/device a user opted into
-- push on. Additive. Not applied to prod. Requires VAPID_PUBLIC_KEY /
-- VAPID_PRIVATE_KEY / VAPID_SUBJECT env vars for pushes to actually go out;
-- without them the whole push path is a no-op (pushConfigured() === false).

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_bio_id uuid references company_bios(id) on delete cascade,
  user_id uuid not null,
  endpoint text not null unique,   -- the push service URL (unique per device)
  p256dh text not null,            -- client public key
  auth text not null,              -- client auth secret
  ua text,                         -- user-agent, for the user to recognize devices
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists idx_push_subscriptions_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
-- A user can see/manage their own subscriptions; all writes go through the
-- service-role API routes anyway (which set user_id from the session).
drop policy if exists push_subscriptions_own on push_subscriptions;
create policy push_subscriptions_own on push_subscriptions
  for select using (user_id = auth.uid());
