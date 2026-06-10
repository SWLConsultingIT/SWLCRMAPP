-- Help / Support requests (2026-06-10, Fran).
-- Sellers and client companies submit a request from the in-app Help menu; the
-- requests land in /admin/support, visible ONLY to super_admins. Writes go
-- through the service-role API (lib gates), so RLS here is defense-in-depth:
-- a requester may read their own rows; super_admin (is_auth_admin) sees + edits
-- everything; nobody else can touch the table.

create table if not exists public.help_requests (
  id            uuid primary key default gen_random_uuid(),
  company_bio_id uuid references public.company_bios(id) on delete set null,
  company_name  text,                          -- denormalized for the admin list
  created_by    uuid not null,                 -- auth.uid() of the requester
  author_name   text,
  author_email  text,
  author_tier   text,                          -- requester tier at submit time
  category      text not null default 'general', -- general | bug | feature | question | billing
  subject       text not null,
  body          text not null,
  status        text not null default 'open',  -- open | in_progress | resolved
  admin_notes   text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid
);

create index if not exists idx_help_requests_status
  on public.help_requests (status, created_at desc);

alter table public.help_requests enable row level security;

-- Any authenticated user can create a request attributed to themselves.
drop policy if exists "create own help request" on public.help_requests;
create policy "create own help request" on public.help_requests
  for insert with check (created_by = auth.uid());

-- Requester reads their own; super_admin reads all.
drop policy if exists "read help requests" on public.help_requests;
create policy "read help requests" on public.help_requests
  for select using (is_auth_admin() or created_by = auth.uid());

-- Only super_admin can update status / notes / resolve.
drop policy if exists "admin update help requests" on public.help_requests;
create policy "admin update help requests" on public.help_requests
  for update using (is_auth_admin()) with check (is_auth_admin());

comment on table public.help_requests is
  'In-app Help menu support requests from sellers/companies; triaged in /admin/support by super_admins only.';
