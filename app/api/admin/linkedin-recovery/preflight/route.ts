// READ-ONLY Unipile preflight for LinkedIn Recovery candidates.
//
// Runs the live GET /users/{slug} against Unipile (prod env creds) for a sample
// of recovery rows and classifies the real relation state. NEVER withdraws,
// invites, or DMs — GET only. Used to measure TRUE_ACTIONABLE before any pilot.
//
// Auth: admin tier via session OR Bearer CRON_SECRET (so ops/scripts can run it
// without a browser). Independent of LINKEDIN_RECOVERY_ENABLED — it is read-only.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";
import { getRelationState, extractLinkedinSlug, isFirstDegree, hasUnipileCreds } from "@/lib/unipile-linkedin";

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const MAX_SAMPLE = 40;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const cronAuthed = !!CRON_SECRET && auth.startsWith("Bearer ") && auth.slice(7).trim() === CRON_SECRET;
  if (!cronAuthed) {
    const scope = await getUserScope();
    if (!canViewAllTenantData(scope.tier)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!hasUnipileCreds()) return NextResponse.json({ error: "UNIPILE creds missing in this environment" }, { status: 503 });

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  const tenant = url.searchParams.get("tenant");
  const order = url.searchParams.get("order") ?? "recent"; // recent | old
  const sample = Math.min(MAX_SAMPLE, Math.max(1, parseInt(url.searchParams.get("sample") ?? "20", 10) || 20));
  const svc = getSupabaseService();

  let q = svc.from("linkedin_recovery")
    .select("id, lead_id, seller_id, state, original_invite_sent_at, leads!inner(primary_first_name, primary_last_name, company_name, primary_linkedin_url, linkedin_internal_id), sellers(unipile_account_id, linkedin_status)");
  if (idsParam) {
    q = q.in("id", idsParam.split(",").map((s) => s.trim()).filter(Boolean));
  } else {
    if (tenant) q = q.eq("company_bio_id", tenant);
    q = q.order("original_invite_sent_at", { ascending: order === "old" }).limit(sample);
  }
  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const counts: Record<string, number> = { PENDING: 0, ALREADY_CONNECTED: 0, NO_INVITATION: 0, PROVIDER_MISMATCH: 0, ERROR: 0 };
  const detail: any[] = [];
  for (const r of rows ?? []) {
    const lead = Array.isArray((r as any).leads) ? (r as any).leads[0] : (r as any).leads;
    const seller = Array.isArray((r as any).sellers) ? (r as any).sellers[0] : (r as any).sellers;
    const slug = extractLinkedinSlug(lead?.primary_linkedin_url ?? null);
    const acct = seller?.unipile_account_id ?? null;
    const label = `${lead?.primary_first_name ?? ""} ${lead?.primary_last_name ?? ""}`.trim() + (lead?.company_name ? ` · ${lead.company_name}` : "");
    if (!slug || !acct) { counts.ERROR += 1; detail.push({ id: (r as any).id, label, category: "ERROR", why: !slug ? "no_slug" : "no_account" }); continue; }
    try {
      const s = await getRelationState(slug, acct);
      let category: string;
      if (isFirstDegree(s.networkDistance)) category = "ALREADY_CONNECTED";
      else if (lead?.linkedin_internal_id && s.providerId && lead.linkedin_internal_id !== s.providerId) category = "PROVIDER_MISMATCH";
      else if (s.invitationStatus === "PENDING") category = "PENDING";
      else category = "NO_INVITATION";
      counts[category] += 1;
      detail.push({ id: (r as any).id, label, category, network_distance: s.networkDistance, invitation_status: s.invitationStatus, invited: (r as any).original_invite_sent_at });
    } catch (e: any) {
      counts.ERROR += 1;
      detail.push({ id: (r as any).id, label, category: "ERROR", why: (e?.message ?? String(e)).slice(0, 120) });
    }
  }

  const n = (rows ?? []).length;
  return NextResponse.json({
    ok: true, sampleN: n, counts,
    pendingRate: n > 0 ? Math.round((counts.PENDING / n) * 100) : null,
    detail,
  });
}
