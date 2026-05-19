-- Table: autoreply_new_leads
-- Stores email addresses extracted from OOO/automatic-reply bodies.
-- These are redirect contacts found in auto-reply messages — e.g. "I'm away,
-- contact john@company.com instead". The original lead's company_bio_id and
-- icp_profile_id are inherited so the sales team can decide whether to import
-- them as full leads.

CREATE TABLE IF NOT EXISTS autoreply_new_leads (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email                text NOT NULL,
  original_lead_id     uuid REFERENCES leads(id) ON DELETE SET NULL,
  original_campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  company_bio_id       uuid REFERENCES company_bios(id) ON DELETE SET NULL,
  icp_profile_id       uuid REFERENCES icp_profiles(id) ON DELETE SET NULL,
  source_message_id    text,              -- Instantly message id for dedupe
  extracted_at         timestamptz DEFAULT now(),
  status               text DEFAULT 'new' CHECK (status IN ('new', 'imported', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS autoreply_new_leads_company_bio_id_idx ON autoreply_new_leads(company_bio_id);
CREATE INDEX IF NOT EXISTS autoreply_new_leads_original_lead_id_idx ON autoreply_new_leads(original_lead_id);
CREATE INDEX IF NOT EXISTS autoreply_new_leads_status_idx ON autoreply_new_leads(status);

-- RLS: tenant isolation — each company only sees its own extracted leads
ALTER TABLE autoreply_new_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant can read own autoreply_new_leads"
  ON autoreply_new_leads FOR SELECT
  USING (company_bio_id = get_auth_company_bio_id());

CREATE POLICY "Service role has full access"
  ON autoreply_new_leads FOR ALL
  USING (true)
  WITH CHECK (true);
