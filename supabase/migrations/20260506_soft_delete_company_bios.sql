-- Soft delete for tenants: archive company_bios + cascade-archive leads/campaigns.
-- Restorable for 30 days; a daily cron will hard-delete anything older than that.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. archived_at columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE company_bios ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE leads        ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE campaigns    ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN company_bios.archived_at IS
  'Soft-delete timestamp. NULL = active. Daily cron hard-deletes rows older than 30 days.';
COMMENT ON COLUMN leads.archived_at IS
  'Soft-delete timestamp. Cascades from company_bios archive.';
COMMENT ON COLUMN campaigns.archived_at IS
  'Soft-delete timestamp. Cascades from company_bios archive.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Partial indexes for "active rows only" queries (the 99% case)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS company_bios_active_idx
  ON company_bios (id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_active_company_idx
  ON leads (company_bio_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS campaigns_active_idx
  ON campaigns (lead_id) WHERE archived_at IS NULL;

-- And one for the recovery page that shows archived bios.
CREATE INDEX IF NOT EXISTS company_bios_archived_idx
  ON company_bios (archived_at) WHERE archived_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: archive a tenant in one transaction (cascade to leads + campaigns)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION archive_company_bio(target_bio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  bio_exists boolean;
  caller_uid uuid;
  caller_is_super_admin boolean;
  caller_tier text;
  archived_count_leads int;
  archived_count_campaigns int;
  ts timestamptz := now();
BEGIN
  caller_uid := auth.uid();
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT exists(SELECT 1 FROM company_bios WHERE id = target_bio_id AND archived_at IS NULL)
    INTO bio_exists;
  IF NOT bio_exists THEN
    RAISE EXCEPTION 'Bio not found or already archived';
  END IF;

  -- Authorization: only super_admins or owners of the tenant can archive it.
  SELECT is_super_admin INTO caller_is_super_admin
    FROM user_profiles WHERE user_id = caller_uid;

  SELECT tier INTO caller_tier
    FROM user_company_memberships
    WHERE user_id = caller_uid AND company_bio_id = target_bio_id;

  IF NOT (COALESCE(caller_is_super_admin, false) OR caller_tier = 'owner') THEN
    RAISE EXCEPTION 'Only owners or super_admins can archive this tenant';
  END IF;

  -- Cascade-archive in one transaction.
  UPDATE leads SET archived_at = ts
    WHERE company_bio_id = target_bio_id AND archived_at IS NULL;
  GET DIAGNOSTICS archived_count_leads = ROW_COUNT;

  UPDATE campaigns SET archived_at = ts
    WHERE lead_id IN (SELECT id FROM leads WHERE company_bio_id = target_bio_id)
      AND archived_at IS NULL;
  GET DIAGNOSTICS archived_count_campaigns = ROW_COUNT;

  UPDATE company_bios SET archived_at = ts WHERE id = target_bio_id;

  RETURN jsonb_build_object(
    'archived_at', ts,
    'leads_archived', archived_count_leads,
    'campaigns_archived', archived_count_campaigns
  );
END;
$$;

GRANT EXECUTE ON FUNCTION archive_company_bio(uuid) TO authenticated;

COMMENT ON FUNCTION archive_company_bio IS
  'Soft-deletes a tenant + cascades to its leads and campaigns. Returns archived counts. Auth: super_admin or owner of that tenant.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: restore an archived tenant (within 30 days)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION restore_company_bio(target_bio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_uid uuid;
  caller_is_super_admin boolean;
  archived_at_ts timestamptz;
  restored_leads int;
  restored_campaigns int;
BEGIN
  caller_uid := auth.uid();
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT archived_at INTO archived_at_ts
    FROM company_bios WHERE id = target_bio_id;
  IF archived_at_ts IS NULL THEN
    RAISE EXCEPTION 'Bio is not archived';
  END IF;

  -- Authorization: super_admins always; owners only if their membership row
  -- still exists. Memberships are NOT cascaded on archive, so an owner of the
  -- archived tenant can still restore.
  SELECT is_super_admin INTO caller_is_super_admin
    FROM user_profiles WHERE user_id = caller_uid;

  IF NOT COALESCE(caller_is_super_admin, false) THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_company_memberships
      WHERE user_id = caller_uid AND company_bio_id = target_bio_id AND tier = 'owner'
    ) THEN
      RAISE EXCEPTION 'Only owners or super_admins can restore this tenant';
    END IF;
  END IF;

  -- Restore everything that was archived in the same transaction window
  -- (matching the bio's archived_at timestamp). Anything archived BEFORE
  -- (e.g. individual leads soft-deleted earlier) stays archived.
  UPDATE leads SET archived_at = NULL
    WHERE company_bio_id = target_bio_id AND archived_at = archived_at_ts;
  GET DIAGNOSTICS restored_leads = ROW_COUNT;

  UPDATE campaigns SET archived_at = NULL
    WHERE lead_id IN (SELECT id FROM leads WHERE company_bio_id = target_bio_id)
      AND archived_at = archived_at_ts;
  GET DIAGNOSTICS restored_campaigns = ROW_COUNT;

  UPDATE company_bios SET archived_at = NULL WHERE id = target_bio_id;

  RETURN jsonb_build_object(
    'restored', true,
    'leads_restored', restored_leads,
    'campaigns_restored', restored_campaigns
  );
END;
$$;

GRANT EXECUTE ON FUNCTION restore_company_bio(uuid) TO authenticated;

COMMENT ON FUNCTION restore_company_bio IS
  'Un-archives a tenant + the leads/campaigns archived in the same operation. Auth: super_admin or owner.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: hard-delete bios archived more than 30 days ago (called by cron)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hard_delete_expired_archives()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count int;
BEGIN
  -- Only the service role should ever call this. Cron route enforces a bearer
  -- token; if a regular user somehow reaches this, the SECURITY DEFINER context
  -- still applies the hardcoded 30-day window so they can't shorten it.
  WITH expired AS (
    DELETE FROM company_bios
    WHERE archived_at IS NOT NULL
      AND archived_at < now() - interval '30 days'
    RETURNING id
  )
  SELECT count(*) INTO deleted_count FROM expired;

  RETURN jsonb_build_object('hard_deleted_count', deleted_count, 'ran_at', now());
END;
$$;

REVOKE ALL ON FUNCTION hard_delete_expired_archives() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION hard_delete_expired_archives() TO service_role;

COMMENT ON FUNCTION hard_delete_expired_archives IS
  'Hard-deletes bios archived more than 30 days ago. Cascade FKs handle the rest. Service role only.';
