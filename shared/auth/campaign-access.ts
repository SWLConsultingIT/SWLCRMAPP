// Server-side authorization for campaign attachment upload (and any future
// campaign-scoped write that should honor the caller's real access). Kept
// dependency-light so the route and the test harness both import it.
//
// campaigns RLS is TENANT-WIDE only (`is_auth_admin() OR company_bio_id =
// get_auth_company_bio_id()`) — it does NOT enforce seller ownership. So RLS
// visibility alone would let a seller act on a PEER's campaign in the same
// tenant. We layer the canonical seller chokepoint on top: a seller
// (getMyAssignedUserId() → their user id) may only act on a campaign whose
// `assigned_user_id` is them; a non-seller (owner/manager/super_admin →
// getMyAssignedUserId() === null) keeps the tenant-wide access RLS already
// grants. This reuses `campaigns.assigned_user_id`, the same key
// getMyAssignedUserId / getMyAssignedLeadIds scope every other seller surface
// by — not a parallel ad-hoc filter. Nothing is trusted from the request body.

import type { SupabaseClient } from "@supabase/supabase-js";

export type CampaignRow = { id: string; assigned_user_id: string | null };

export type CampaignAuthzInput = {
  userId: string | null;
  companyBioId: string | null;
  /** The campaign as read under the caller's RLS session (null = not visible:
   *  cross-tenant or unknown id). */
  campaign: CampaignRow | null;
  /** getMyAssignedUserId(): the caller's user id when tier==='seller', else null
   *  (owner/manager/super_admin are unrestricted within their tenant). */
  sellerUserId: string | null;
};

export type CampaignAuthzResult = { ok: true } | { ok: false; status: 401 | 403; error: string };

/** Pure decision — the exact order the route applies it. */
export function campaignWriteAuthz(i: CampaignAuthzInput): CampaignAuthzResult {
  if (!i.userId) return { ok: false, status: 401, error: "Unauthorized" };
  if (!i.companyBioId) return { ok: false, status: 403, error: "No tenant" };
  // RLS visibility: cross-tenant / unknown campaign → not accessible.
  if (!i.campaign) return { ok: false, status: 403, error: "Campaign not found or not accessible" };
  // Seller ownership (RLS doesn't enforce it): a seller may only act on their
  // own assigned campaign. Non-sellers (sellerUserId === null) are tenant-wide.
  if (i.sellerUserId !== null && i.campaign.assigned_user_id !== i.sellerUserId) {
    return { ok: false, status: 403, error: "Campaign not assigned to you" };
  }
  return { ok: true };
}

/** Reads the campaign (id + owner) under the caller's RLS session. Returns null
 *  for a campaign the user can't see (cross-tenant, or unknown id). */
export async function getVisibleCampaign(sb: SupabaseClient, campaignId: string): Promise<CampaignRow | null> {
  const { data } = await sb.from("campaigns").select("id, assigned_user_id").eq("id", campaignId).maybeSingle();
  return (data as CampaignRow | null) ?? null;
}
