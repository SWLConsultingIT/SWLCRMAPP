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
-- Fix:
--  1. Backfill allow_call = true for the safe set: a phone on file AND never
--     called (no calls row → cannot be a real wrong-number). Leads that were
--     actually dialed are left untouched (a genuine wrong_number stays false).
--  2. Flip the column default to TRUE so no future insert recreates the bug —
--     calling is enabled by default; wrong-number is the explicit exception
--     (the post-call popup sets allow_call=false). Matches what the import
--     already did by hand.
--
-- Backup of pre-change values: table _backup_allow_call_2026_06_05 (id, allow_call).
-- Applied to prod via the Supabase Management API; this file is the record.

-- 1. Backfill (1075 rows: 920 SWL + 155 Pathway at apply time)
UPDATE public.leads
SET allow_call = true
WHERE allow_call IS FALSE
  AND primary_phone IS NOT NULL AND primary_phone <> ''
  AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = leads.id);

-- 2. Default flip
ALTER TABLE public.leads ALTER COLUMN allow_call SET DEFAULT true;
