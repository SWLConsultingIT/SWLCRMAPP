-- Fix the "Wrong number" badge appearing on every freshly-uploaded lead.
--
-- ROOT CAUSE (2026-06-05): leads.allow_call defaulted to FALSE. The lead-detail
-- header reads `allow_call === false` as "phone marked wrong" and swaps the
-- Call button for a red "Wrong number · click to replace" pill — hiding the
-- number. The app import route compensates (`allow_call ?? true`), so
-- app-imported leads are fine — but leads inserted by other paths (e.g. the
-- bulk upload scripts that loaded SWL's "Spanish Speaking Growth AI Sales" 200
-- + ~900 more) fell through to the FALSE default and every one of them showed
-- a false "Wrong number". None had ever been called.
--
-- Fix (establishes the invariant: for a lead with a phone,
-- allow_call=false  ⟺  a real wrong_number call exists):
--  1. Backfill allow_call = true for every lead with a phone that has NO
--     wrong_number call on record — clearing all false positives, whether or
--     not the lead was ever dialed. Only genuine wrong-numbers stay false.
--  2. Flip the column default to TRUE so no future insert recreates the bug —
--     calling is enabled by default; wrong-number is the explicit exception
--     (the classify / call-outcome routes are the ONLY writers of false).
--     Matches what the import already did by hand (`allow_call ?? true`).
--
-- Backup of pre-change values: table _backup_allow_call_2026_06_05 (id, allow_call),
-- 1079 rows. Applied to prod via the Supabase Management API; this file is the
-- record. After apply: 0 phone-bearing false positives; the only remaining
-- allow_call=false rows are genuine wrong-numbers or phoneless leads (whose
-- badge never renders anyway).

-- 1. Backfill — clear every phone-bearing false positive
UPDATE public.leads
SET allow_call = true
WHERE allow_call IS FALSE
  AND primary_phone IS NOT NULL AND primary_phone <> ''
  AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = leads.id AND c.classification = 'wrong_number');

-- 2. Default flip
ALTER TABLE public.leads ALTER COLUMN allow_call SET DEFAULT true;
