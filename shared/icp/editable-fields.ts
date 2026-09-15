// The ONLY icp_profiles fields a caller may set through the /api/icp/profiles
// endpoints. Everything else — company_bio_id (tenant), created_by /
// created_by_email (owner), status, id, timestamps — is derived server-side, so
// a crafted request body can't move a profile across tenants or forge ownership.
// Pure (no framework imports) so both the route handlers and the tests use it.

export const ICP_EDITABLE_KEYS = [
  "profile_name", "target_industries", "target_roles", "company_size_buckets",
  "geography", "pain_points", "solutions_offered", "notes", "leads_requested",
] as const;

export function pickEditable(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ICP_EDITABLE_KEYS) if (k in body) out[k] = body[k];
  return out;
}
