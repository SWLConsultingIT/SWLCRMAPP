-- Internal collaboration was silently undelivered: chat_messages + notifications
-- had RLS policies (the migrations 033/035 assumed that was enough) but were
-- NEVER added to the `supabase_realtime` publication. Without publication
-- membership Realtime emits zero postgres_changes events, so NotificationBell
-- (notifications) and ChatPanel (chat_messages) never updated live — messages
-- and tag/mention notifications simply never arrived.
--
-- Applied to prod 2026-06-04 via the Management API; this file tracks it.
-- INSERT events use the default replica identity, which is sufficient for the
-- INSERT-only subscriptions both clients use.

alter publication supabase_realtime add table chat_messages;
alter publication supabase_realtime add table notifications;
