-- Internal collaboration, Phase 2: general team chat (DMs + named channels).
-- Reads/writes go through service-role API routes; RLS here is what authorizes
-- the browser's Realtime subscription on chat_messages (participants only).

create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  company_bio_id uuid not null references company_bios(id) on delete cascade,
  kind text not null,                 -- 'dm' | 'channel'
  title text,                         -- channels only
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists chat_participants (
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_id uuid not null,
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid not null,
  sender_name text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_thread on chat_messages (thread_id, created_at);
create index if not exists idx_chat_participants_user on chat_participants (user_id);

-- SECURITY DEFINER membership check → avoids recursive RLS between threads,
-- participants and messages.
create or replace function is_chat_participant(p_thread uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (select 1 from chat_participants where thread_id = p_thread and user_id = auth.uid());
$$;

alter table chat_threads enable row level security;
alter table chat_participants enable row level security;
alter table chat_messages enable row level security;

drop policy if exists chat_threads_select on chat_threads;
create policy chat_threads_select on chat_threads for select using (is_chat_participant(id));

drop policy if exists chat_participants_select on chat_participants;
create policy chat_participants_select on chat_participants for select
  using (user_id = auth.uid() or is_chat_participant(thread_id));

drop policy if exists chat_messages_select on chat_messages;
create policy chat_messages_select on chat_messages for select using (is_chat_participant(thread_id));
