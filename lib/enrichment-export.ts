// Server-safe helpers to turn a lead's `enrichment` JSONB into clean CSV
// columns. Mirrors the cleaning done in components/PersonalizedInfoPanel.tsx
// (normalizeEnrichment) so the per-ICP CSV export and the lead-detail UI agree
// on what counts as signal vs noise. Kept dependency-free (no React) so it can
// run inside an API route.

// Strip noisy/duplicate keys: the `__1/__2` suffixes from CSV-merge dupes, the
// import bookkeeping `source_file`, null/empty/placeholder values, and collapse
// a couple of synonym pairs to one canonical key.
export function normalizeEnrichment(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (k === "source_file") continue;
    if (/__\d+$/.test(k)) continue;
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || s === "." || s === "—") continue;
    out[k] = v;
  }
  if (out.icp_status && !out.ICP) { out.ICP = out.icp_status; delete out.icp_status; }
  else if (out.icp_status && out.ICP) { delete out.icp_status; }
  if (out.industry && !out.vertical) { out.vertical = out.industry; delete out.industry; }
  else if (out.industry && out.vertical) { delete out.industry; }
  delete out.company_name; // duplicate of the lead's own company_name column
  return out;
}

// Human-readable CSV header from an enrichment key: drop the rfa_/ch_ source
// prefix, snake_case → spaced Title Case. "rfa_annual_revenue" → "Annual Revenue".
export function prettyLabel(key: string): string {
  return key
    .replace(/^rfa_|^ch_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}
