-- Team Chat: screenshots attached to a message.
--
-- WHY IT IS NEEDED: chat_messages only has (id, thread_id, sender_id,
-- sender_name, body, created_at). There is nowhere to put an attachment.
--
-- MINIMAL MODEL: a jsonb column on the message itself, not a separate table.
-- A screenshot belongs to one message and dies with it; it is not shared, not
-- searched on its own, and not referenced from anywhere else. A
-- chat_attachments table would add a join to every chat read and buy nothing.
-- This is the same pattern the repo already uses for campaign step
-- attachments (campaigns.sequence_steps[i].attachments).
--
-- Element shape — same as StepAttachment in lib/campaign-attachments:
--   { path: string, name: string, mimeType: string, sizeBytes: number,
--     width?: number, height?: number }
-- `path` is the bucket-relative key. A URL is NEVER stored: signed URLs are
-- minted on read and expire.
--
-- BACKWARD-COMPATIBLE: nullable, no default. Existing messages stay NULL and
-- the client reads them as "no attachments". No backfill.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb;

COMMENT ON COLUMN chat_messages.attachments IS
  'Message screenshots. Array of {path,name,mimeType,sizeBytes,width?,height?}. NULL = no attachments. path is relative to the chat-attachments bucket; URLs are signed on read.';

-- PRIVATE bucket for the screenshots. Same path layout as
-- campaign-attachments: {company_bio_id}/{uuid}-{filename}, so the tenant
-- prefix makes the isolation guard trivial.
--
-- 10 MB and images only: this is for screen captures, not a document manager.
-- A PNG screenshot of a 5K display lands around 3-5 MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760, -- 10 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
