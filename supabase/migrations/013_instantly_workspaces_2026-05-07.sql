-- Multi-workspace Instantly support.
--
-- Migration 012 added per-tenant `company_bios.instantly_api_key` so a tenant
-- whose inboxes lived in a separate Instantly account could route through
-- their own key. That worked for one or two tenants but doesn't scale: the
-- SWL super-admin needs a SINGLE place to see every Instantly workspace,
-- list its inboxes, and assign inboxes to tenants. Storing API keys spread
-- across N company_bios rows makes that view impossible.
--
-- Solution: pull workspaces into their own table, register each one once,
-- and reference them by ID from company_bios. Same key reused across N
-- tenants becomes a single row instead of N copies.
--
-- An Instantly "workspace" is the container Instantly calls an Organization
-- (visible top-right of their dashboard). Each Organization has its own API
-- key, its own connected inboxes, and its own warmup pool. Different
-- Organizations may belong to the same Instantly subscription (one user_id)
-- or be separate subscriptions (different user_ids). Both topologies fit
-- the same workspace abstraction here.

CREATE TABLE IF NOT EXISTS public.instantly_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-readable label shown in admin UI ("SWL Main", "Arqy/PACF", "Pathway").
  label text NOT NULL,
  -- The actual Instantly API key (Bearer token). Stored plain — same threat
  -- model as company_bios.instantly_api_key (server-only, RLS-locked).
  api_key text NOT NULL,
  -- Decoded user portion of the JWT-style key (everything before the colon).
  -- Two workspaces with the same `account_user_id` belong to the same
  -- Instantly subscription; useful for the admin view to group them.
  account_user_id text,
  -- Optional free-text notes (e.g. "Hypergrowth plan, billed to fran@swl",
  -- "shared inbox pool with Pathway").
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.instantly_workspaces IS
  'Registry of Instantly Organizations whose inboxes the CRM dispatches through. Referenced by company_bios.instantly_workspace_id.';

-- FK from company_bios. Keep `instantly_api_key` and `instantly_campaign_id`
-- around for now: campaign_id stays as the per-tenant routing target inside
-- the workspace, and instantly_api_key is the legacy column we'll migrate
-- below. The dispatcher's resolver prefers the workspace-derived key when
-- both are present.
ALTER TABLE public.company_bios
  ADD COLUMN IF NOT EXISTS instantly_workspace_id uuid
    REFERENCES public.instantly_workspaces(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.company_bios.instantly_workspace_id IS
  'FK to instantly_workspaces. NULL → fall back to company_bios.instantly_api_key (legacy) and finally to INSTANTLY_API_KEY env var.';

-- Backfill: every existing tenant with `instantly_api_key` gets its own
-- workspace row so the admin UI sees them on day one.
DO $$
DECLARE
  bio RECORD;
  new_ws_id uuid;
  decoded_user text;
BEGIN
  FOR bio IN
    SELECT id, company_name, instantly_api_key
    FROM public.company_bios
    WHERE instantly_api_key IS NOT NULL
      AND instantly_workspace_id IS NULL
  LOOP
    -- Best-effort decode of the user_id portion (everything before the first
    -- ':' in the base64-decoded key). If decoding fails we still create the
    -- workspace, just without the grouping hint.
    BEGIN
      decoded_user := split_part(
        convert_from(decode(bio.instantly_api_key, 'base64'), 'UTF8'),
        ':', 1
      );
    EXCEPTION WHEN OTHERS THEN
      decoded_user := NULL;
    END;

    INSERT INTO public.instantly_workspaces (label, api_key, account_user_id, notes)
    VALUES (
      bio.company_name || ' (auto)',
      bio.instantly_api_key,
      decoded_user,
      'Backfilled from company_bios.instantly_api_key on migration 013'
    )
    RETURNING id INTO new_ws_id;

    UPDATE public.company_bios
    SET instantly_workspace_id = new_ws_id
    WHERE id = bio.id;
  END LOOP;
END $$;
