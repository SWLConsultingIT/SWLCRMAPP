-- 029 — Storage bucket for per-step campaign attachments (flyers, brochures, PDFs).
--
-- Path layout: {company_bio_id}/{uuid}-{original_filename}
--   • Tenant prefix makes RLS + audit trivial.
--   • UUID prefix on the filename avoids name collisions when two sellers
--     upload "brochure.pdf" the same minute and keeps the original name
--     visible in the URL for the recipient's mail client / download dialog.
--
-- Bucket is PRIVATE: dispatchers generate short-lived signed URLs at send
-- time (Instantly + Unipile both accept https URLs in their message payloads;
-- the URL only needs to live long enough for the provider to fetch the file,
-- typically < 60s). We never expose the public URL.
--
-- 50MB cap to stay well under Instantly's 10MB-per-attachment soft limit
-- × ~5 attachments per email, and Unipile's 20MB cap per LinkedIn DM file.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'campaign-attachments',
  'campaign-attachments',
  false,
  52428800, -- 50 MB
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint'
  ]
)
ON CONFLICT (id) DO NOTHING;
