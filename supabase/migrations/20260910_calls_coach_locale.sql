-- calls.coach_locale — which language a cached coach analysis is written in.
--
-- Why: `calls.coach_analysis` is a single markdown column and the route serves
-- it to every reader. Once generation became locale-aware (see
-- /api/calls/[id]/coach-analysis), the first reader's language won and everyone
-- else got prose they may not read. This column lets the route decide whether
-- the cache is usable for THIS reader, and regenerate if not.
--
-- Backward-compatible on purpose:
--   * Nullable, no default, no backfill. An existing analysis keeps NULL.
--   * The route reads `coach_locale ?? 'en'`, because every analysis generated
--     before this was English — the prompt carried no language instruction.
--   * Nothing writes NULL going forward; new rows always stamp the locale.
--   * Rollback is `drop column`; the route falls back to serving any cache.
--
-- ADD COLUMN with no default and no constraint is metadata-only in Postgres 11+
-- — no table rewrite, no long lock, safe on a live `calls` table.

alter table public.calls
  add column if not exists coach_locale text;

comment on column public.calls.coach_locale is
  'Locale the cached coach_analysis prose is written in (en|es|it). NULL = generated before localization, treated as en.';
