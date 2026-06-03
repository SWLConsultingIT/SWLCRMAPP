# Internal collaboration & chat — technical plan

Goal: let sellers (a) tag each other on leads, (b) collaborate with @mentions in
team notes, (c) get real notifications, and (d) chat generally (DMs/channels).
Built in two phases. Lead-contextual first (highest ROI, reuses existing infra),
general chat second.

Project rules honored: tenant-scope every query via `lib/scope.ts`; RLS ON **with
policies** on every new table (avoid the no-policies silent-deny trap); one concern
per commit; additive migrations only; deploy via main.

---

## Reused foundations (already in the codebase)
- `lead_notes` table + `/api/leads/[id]/notes` CRUD + `ActivityTimeline` Team Notes UI (author + date already tracked).
- `GET /api/sellers?usable=1` — ungated, tenant-scoped seller pick-list.
- Supabase Realtime: `RealtimeRefresh.tsx` (postgres_changes → refresh) + `ActivityWidget.tsx` (presence "who's online").
- Bell in header = `TodayPlanPopover.tsx`; sidebar "Notifications" → `/queue`.
- Chat-bubble UI exists: `LeadChatThread.tsx` (clone for internal threads).

---

# PHASE 1 — Lead-contextual collaboration + real notifications

### New tables (migration 033)
```sql
-- The keystone: a real persisted notification feed (none exists today).
create table notifications (
  id uuid primary key default gen_random_uuid(),
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  recipient_user_id uuid not null,           -- auth.users.id
  actor_user_id uuid,                         -- who triggered it
  actor_name text,                            -- denormalized snapshot
  type text not null,                         -- 'mention' | 'tag' | 'note' | 'message'
  lead_id uuid references leads(id) on delete cascade,
  body text,                                  -- preview line
  link text,                                  -- where a click navigates (e.g. /leads/<id>)
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_recipient on notifications (recipient_user_id, read_at, created_at desc);

-- Multi-seller tagging on a lead (leads.seller_id stays the single owner).
create table lead_seller_tags (
  lead_id uuid not null references leads(id) on delete cascade,
  seller_id uuid not null references sellers(id) on delete cascade,
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  tagged_by uuid,
  created_at timestamptz not null default now(),
  primary key (lead_id, seller_id)
);
create index idx_lead_seller_tags_lead on lead_seller_tags (lead_id);

-- @mentions on existing team notes.
alter table lead_notes add column if not exists mentioned_user_ids uuid[];
```
RLS: enable + policies. `notifications`: recipient reads own (`recipient_user_id = auth.uid()`), service-role writes. `lead_seller_tags`: tenant read/write by `company_bio_id` membership. All writes go through service-role API routes (the precedent in this codebase).

### New / changed APIs
- `GET /api/notifications` — my unread+recent (scoped to me). `POST /api/notifications/read` — mark read (one or all).
- `GET /api/team/roster` — **new ungated, tenant-scoped** mode returning `{ userId, name }[]` for the @mention + tag pickers (today `/api/team` is admin-gated).
- `POST/DELETE /api/leads/[id]/tags` — add/remove a seller tag; on add → insert a `notification` for the tagged seller's `sellers.user_id`.
- Extend `POST /api/leads/[id]/notes` — accept `mentioned_user_ids[]`; on insert → one `notification` per mentioned user. (GET already returns the column via `select *`.)

### UI
- **Tag picker** in lead Profile Overview (next to the assigned-seller badge, `page.tsx:499`): chips of tagged sellers + "+ Tag" dropdown (from `/api/team/roster` or `/api/sellers?usable=1`).
- **@mention composer** in `ActivityTimeline` Team Notes: typeahead on "@", inserts `@Name`, collects `mentioned_user_ids`; renderer highlights `@Name`.
- **Notification bell**: extend `TodayPlanPopover` (or a sibling `NotificationBell`) to show unread count + a list ("X mentioned you on {lead}", "X tagged you") → click navigates to `link`, marks read. Subscribe `notifications` (filtered to me) via the existing Realtime pattern so the badge updates live.
- Sidebar "/queue" badge can fold in unread-notification count.

### Commit breakdown (one concern each)
1. migration 033 + RLS policies.
2. `/api/notifications` + `/api/team/roster`.
3. notification bell UI + realtime badge.
4. lead seller tags (table already in #1) → API + picker UI + notify-on-tag.
5. note @mentions → API extension + composer + render + notify-on-mention.

---

# PHASE 2 — General internal chat (DMs + channels)

### New tables (migration 034)
```sql
create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  kind text not null,                 -- 'dm' | 'channel'
  title text,                         -- channels only
  created_by uuid,
  created_at timestamptz not null default now()
);
create table chat_participants (
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_id uuid not null,
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid not null,
  sender_name text,
  body text not null,
  created_at timestamptz not null default now()
);
create index idx_chat_messages_thread on chat_messages (thread_id, created_at);
```
DMs dedup by participant pair; channels have a title + N participants. RLS: a user reads threads they participate in. Unread = `chat_messages.created_at > chat_participants.last_read_at`.

### APIs
- `GET /api/chat/threads` (my threads + unread counts), `POST /api/chat/threads` (start DM/channel), `GET/POST /api/chat/threads/[id]/messages`, `POST /api/chat/threads/[id]/read`.

### UI
- New **Chat tab in `/queue`** (`QueueClient.tsx` tab pattern): thread list (left) + message pane (right, clone `LeadChatThread` bubbles). Composer with the roster picker for new DMs/channels.
- **Realtime**: subscribe `chat_messages` by thread (postgres_changes) for live messages; reuse `ActivityWidget` presence for online dots + typing (optional).
- New chat messages → a `notification` (type `'message'`) for participants not currently in the thread, so the bell + sidebar badge light up.

### Commit breakdown
1. migration 034 + RLS.
2. chat APIs.
3. chat UI in /queue + realtime.
4. message → notification wiring + unread badges.

---

## Effort & sequencing
- **Phase 1** is the bulk of the value and reuses ~70% existing infra. Ship it first, in the 5 commits above, deploying incrementally.
- **Phase 2** is mostly net-new tables + one new surface; start after Phase 1 is in use and we know whether DMs, channels, or both matter most.

## Open questions to confirm before building
1. Tag picker source: **all tenant users** (`/api/team/roster`) or **sellers only** (`/api/sellers?usable=1`)?
2. Mentions: only sellers, or any teammate (managers/owners too)?
3. Notification delivery: in-app only (bell), or also **email** (we now have Google SMTP wired)?
4. Phase 2 chat: DMs only, channels only, or both?
