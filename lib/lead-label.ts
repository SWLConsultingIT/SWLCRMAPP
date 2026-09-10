// Single place that decides how a lead is LABELLED in pickers/lists/cards.
// Abstracted on purpose (boss 2026-09-10): today SWL/plaintext leads resolve to
// a real name; client-source (encrypted) leads gracefully fall back to company,
// then a generic label — WITHOUT the caller knowing anything about encryption.
// When we later add a proper name-resolution/decrypt layer, we change it HERE
// and every picker/list improves at once — no New Activity modal changes.

export type LeadNameParts = {
  primary_first_name?: string | null;
  primary_last_name?: string | null;
  company_name?: string | null;
};

/** Best available human label for a lead. Never returns empty. */
export function leadDisplayName(lead: LeadNameParts | null | undefined, fallback = "Lead"): string {
  if (!lead) return fallback;
  const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim();
  if (name) return name;
  if (lead.company_name) return lead.company_name;
  return fallback;
}

/** True when we have a real person name (vs a company/generic fallback). Lets UI
 *  render a subtle "name unavailable" affordance without duplicating the logic. */
export function hasResolvedName(lead: LeadNameParts | null | undefined): boolean {
  if (!lead) return false;
  return !!`${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim();
}
