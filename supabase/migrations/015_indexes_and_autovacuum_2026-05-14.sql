-- Comprehensive index + autovacuum hardening, applied 2026-05-14.
-- Goal: O(log n) lookup on every FK and every hot WHERE/JOIN/ORDER BY column,
-- plus aggressive autovacuum thresholds so bloat never accumulates on
-- the small high-churn tables (which are most public CRM tables today).
--
-- Background: NANO compute (43 Mbps disk IO baseline) was saturating because
-- bloated tables + missing FK indexes turned every dispatcher tick into
-- sequential scans. After this migration: seq scans only happen on tables
-- with <50 rows where the planner correctly prefers them.

-- ---------- FK + hot-column indexes ----------

-- calls
CREATE INDEX IF NOT EXISTS idx_calls_lead_id           ON public.calls (lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_seller_id         ON public.calls (seller_id);
CREATE INDEX IF NOT EXISTS idx_calls_status            ON public.calls (status);
CREATE INDEX IF NOT EXISTS idx_calls_created_at        ON public.calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_lead_created      ON public.calls (lead_id, created_at DESC);

-- campaign_messages (composite for dispatcher hot path)
CREATE INDEX IF NOT EXISTS idx_campaign_messages_status_sent
  ON public.campaign_messages (status, sent_at) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_campaign_messages_lead_status
  ON public.campaign_messages (lead_id, status);

-- campaign_requests
CREATE INDEX IF NOT EXISTS idx_campaign_requests_status            ON public.campaign_requests (status);
CREATE INDEX IF NOT EXISTS idx_campaign_requests_company_bio_id    ON public.campaign_requests (company_bio_id);
CREATE INDEX IF NOT EXISTS idx_campaign_requests_lead_id           ON public.campaign_requests (lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_requests_icp_profile_id    ON public.campaign_requests (icp_profile_id);
CREATE INDEX IF NOT EXISTS idx_campaign_requests_created_at        ON public.campaign_requests (created_at DESC);

-- campaigns
CREATE INDEX IF NOT EXISTS idx_campaigns_template_id
  ON public.campaigns (template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_archived_at
  ON public.campaigns (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_company_status
  ON public.campaigns (company_bio_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_active_status
  ON public.campaigns (status, next_step_due_at)
  WHERE status = 'active' AND archived_at IS NULL;

-- company_bios
CREATE INDEX IF NOT EXISTS idx_company_bios_instantly_workspace
  ON public.company_bios (instantly_workspace_id) WHERE instantly_workspace_id IS NOT NULL;

-- icp_profiles
CREATE INDEX IF NOT EXISTS idx_icp_profiles_status              ON public.icp_profiles (status);
CREATE INDEX IF NOT EXISTS idx_icp_profiles_status_execution    ON public.icp_profiles (status, execution_status);
CREATE INDEX IF NOT EXISTS idx_icp_profiles_company_bio_id      ON public.icp_profiles (company_bio_id);

-- instantly_accounts (no company_bio_id — workspace-scoped via FK)
CREATE INDEX IF NOT EXISTS idx_instantly_accounts_email   ON public.instantly_accounts (email);
CREATE INDEX IF NOT EXISTS idx_instantly_accounts_active  ON public.instantly_accounts (active) WHERE active = true;

-- lead_notes
CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id      ON public.lead_notes (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_notes_created_at   ON public.lead_notes (created_at DESC);

-- lead_replies
CREATE INDEX IF NOT EXISTS idx_lead_replies_campaign_message_id
  ON public.lead_replies (campaign_message_id) WHERE campaign_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_replies_created_at  ON public.lead_replies (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_replies_lead_created ON public.lead_replies (lead_id, created_at DESC);

-- lead_suppressions
CREATE INDEX IF NOT EXISTS idx_lead_suppressions_lead_id ON public.lead_suppressions (lead_id);

-- leads (composite for the multi-tenant filter+status query)
CREATE INDEX IF NOT EXISTS idx_leads_icp_profile_id
  ON public.leads (icp_profile_id) WHERE icp_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_company_status     ON public.leads (company_bio_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_updated_at         ON public.leads (updated_at DESC);

-- message_sequences
CREATE INDEX IF NOT EXISTS idx_message_sequences_company_bio_id     ON public.message_sequences (company_bio_id);
CREATE INDEX IF NOT EXISTS idx_message_sequences_icp_profile_id     ON public.message_sequences (icp_profile_id);
CREATE INDEX IF NOT EXISTS idx_message_sequences_status             ON public.message_sequences (status);

-- message_templates
CREATE INDEX IF NOT EXISTS idx_message_templates_icp_profile_id
  ON public.message_templates (icp_profile_id) WHERE icp_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_templates_sequence_id
  ON public.message_templates (sequence_id) WHERE sequence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_templates_company_bio_id ON public.message_templates (company_bio_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_status         ON public.message_templates (status);

-- sellers
CREATE INDEX IF NOT EXISTS idx_sellers_company_bio_id ON public.sellers (company_bio_id);

-- user_company_memberships
CREATE INDEX IF NOT EXISTS idx_user_company_memberships_invited_by
  ON public.user_company_memberships (invited_by) WHERE invited_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_company_memberships_user_id        ON public.user_company_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_user_company_memberships_company_bio_id ON public.user_company_memberships (company_bio_id);

-- user_profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_company_bio_id
  ON public.user_profiles (company_bio_id) WHERE company_bio_id IS NOT NULL;

-- ---------- Autovacuum tuning on every public table ----------
-- 5% scale_factor + threshold 20: trigger autovacuum/analyze when 5% of rows
-- become dead OR 20 rows churn (whichever comes first). Default 20% +
-- threshold 50 was way too lazy for tables with <100 rows (a 10-row table
-- needed 52 dead tuples to trigger — impossible).

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format(
      'ALTER TABLE public.%I SET ('
      'autovacuum_vacuum_scale_factor = 0.05, '
      'autovacuum_vacuum_threshold = 20, '
      'autovacuum_analyze_scale_factor = 0.05, '
      'autovacuum_analyze_threshold = 20)',
      r.tablename
    );
  END LOOP;
END $$;

-- ---------- Refresh planner stats ----------

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ANALYZE public.%I', r.tablename);
  END LOOP;
END $$;
