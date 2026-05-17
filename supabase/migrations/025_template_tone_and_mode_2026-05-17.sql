-- 025_template_tone_and_mode_2026-05-17.sql
--
-- Extends `campaign_templates` with three new metadata fields that flow
-- through to both the template-draft generator and the per-lead generator
-- in n8n:
--
--   * tone_preset  — Conservative / Balanced / Direct / Spicy / Custom
--     Controls how the AI writes (formality, hype, CTA aggressiveness).
--     Default "balanced" preserves current behavior for existing rows.
--
--   * rewrite_mode — verbatim / personalize / rewrite_with_source
--     Controls what n8n's per-lead generator does at campaign time:
--       verbatim            = use template body as-is, only {{var}} substitution
--       personalize         = light per-lead rewrite (current default)
--       rewrite_with_source = Claude reads attachments + body, rewrites per lead
--     Default "personalize" preserves current behavior.
--
--   * voice_anchor_seller_id — optional FK to sellers.id
--     When set, both generators load `sellers.voice_examples` and use them
--     as few-shot context so each seller's voice stays consistent across
--     templates. Nullable — templates remain tenant-wide by default.
--
-- All three are additive with sensible defaults: every existing template
-- keeps working with no migration of data needed.

BEGIN;

ALTER TABLE campaign_templates
  ADD COLUMN IF NOT EXISTS tone_preset text NOT NULL DEFAULT 'balanced'
    CHECK (tone_preset IN ('conservative', 'balanced', 'direct', 'spicy', 'custom')),
  ADD COLUMN IF NOT EXISTS tone_custom_notes text,
  ADD COLUMN IF NOT EXISTS rewrite_mode text NOT NULL DEFAULT 'personalize'
    CHECK (rewrite_mode IN ('verbatim', 'personalize', 'rewrite_with_source')),
  ADD COLUMN IF NOT EXISTS voice_anchor_seller_id uuid REFERENCES sellers(id) ON DELETE SET NULL;

COMMENT ON COLUMN campaign_templates.tone_preset IS
  'AI tone knob. Conservative=formal/safe, Balanced=default, Direct=blunt CTA, Spicy=contrarian, Custom=use tone_custom_notes.';
COMMENT ON COLUMN campaign_templates.tone_custom_notes IS
  'Free-form style guide concatenated to the system prompt when tone_preset=custom.';
COMMENT ON COLUMN campaign_templates.rewrite_mode IS
  'How the n8n per-lead generator treats the template body: verbatim / personalize / rewrite_with_source.';
COMMENT ON COLUMN campaign_templates.voice_anchor_seller_id IS
  'Optional seller whose voice_examples both generators should mimic. Survives seller deletion via SET NULL.';

COMMIT;
