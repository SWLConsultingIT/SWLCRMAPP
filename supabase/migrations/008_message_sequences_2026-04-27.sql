-- Sequences = ordered groups of message_templates that tell a coherent story
-- (connection_request → first_dm → followup_1 → followup_2 → cta → breakup) for a
-- specific ICP / industry / use-case. The Message Generator V7 Pro can either
-- pick from individual templates (existing flow) OR follow a chosen sequence
-- when the user wants a coherent narrative across all steps.

CREATE TABLE message_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_bio_id uuid NOT NULL REFERENCES company_bios(id) ON DELETE CASCADE,
  icp_profile_id uuid REFERENCES icp_profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  industry text,
  channels text[] DEFAULT ARRAY['linkedin']::text[],
  status text NOT NULL DEFAULT 'active',
  is_default boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX message_sequences_company_idx ON message_sequences(company_bio_id);

ALTER TABLE message_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_seq ON message_sequences
  FOR ALL
  USING (company_bio_id = get_auth_company_bio_id())
  WITH CHECK (company_bio_id = get_auth_company_bio_id());

-- Templates can belong to a sequence (optional) or live standalone in the library.
ALTER TABLE message_templates
  ADD COLUMN sequence_id uuid REFERENCES message_sequences(id) ON DELETE SET NULL,
  ADD COLUMN sequence_order int;
CREATE INDEX message_templates_sequence_idx ON message_templates(sequence_id, sequence_order)
  WHERE sequence_id IS NOT NULL;
