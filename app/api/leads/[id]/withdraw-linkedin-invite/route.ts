// Manual companion to the daily expire-invites cron. Lets an admin retire a
// pending LinkedIn invitation for a single lead on-demand — useful when:
//  - The lead is already a real connection elsewhere and the invite is dead weight.
//  - We want to re-target the lead before the 10-day TTL with new copy.
//  - The cron's withdraw call failed (network glitch) and left the invitation
//    alive in Unipile even though the campaign is marked completed.
//
// Behavior: finds the most recent step-0 LinkedIn message with a stored
// provider_message_id for this lead, calls Unipile DELETE invite/sent, then
// stamps the message metadata. Does NOT close the campaign or archive the lead
// by default — those state transitions live in the cron / cancel endpoints.
// Pass `?close=true` to also flip the campaign to completed (mirrors cron).
//
// Auth: super_admin / owner / manager via getUserScope; OR Bearer CRON_SECRET
// for programmatic use.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

type WithdrawResult =
  | { ok: true; status: "withdrawn" }
  | { ok: true; status: "already_gone" }
  | { ok: false; status: "failed"; reason: string };

async function withdrawInvitation(invitationId: string, accountId: string): Promise<WithdrawResult> {
  if (!UNIPILE_KEY) return { ok: false, status: "failed", reason: "UNIPILE_API_KEY missing" };
  const url = `${UNIPILE_BASE}/api/v1/users/invite/sent/${encodeURIComponent(invitationId)}?account_id=${encodeURIComponent(accountId)}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" },
    });
    if (res.ok) return { ok: true, status: "withdrawn" };
    if (res.status === 404) return { ok: true, status: "already_gone" };
    const body = await res.text().catch(() => "");
    return { ok: false, status: "failed", reason: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, status: "failed", reason: e?.message ?? String(e) };
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Auth: cron-secret OR admin-like tier.
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const cronAuthed = !!CRON_SECRET && presented === CRON_SECRET;
  if (!cronAuthed) {
    const scope = await getUserScope();
    if (!canViewAllTenantData(scope.tier)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const { id: leadId } = await params;
  const url = new URL(req.url);
  const shouldClose = url.searchParams.get("close") === "true";

  const svc = getSupabaseService();

  // Pick the most recent step-0 LinkedIn message that actually got sent and
  // has the Unipile invitation_id stored. Order by sent_at desc so re-running
  // doesn't accidentally hit a stale older row.
  const { data: msg, error: msgErr } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, provider_message_id, status, sent_at, campaigns!inner(id, seller_id, status)")
    .eq("lead_id", leadId)
    .eq("step_number", 0)
    .eq("channel", "linkedin")
    .eq("status", "sent")
    .not("provider_message_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });
  if (!msg) {
    return NextResponse.json(
      { error: "no sent LinkedIn invite with provider_message_id found for this lead" },
      { status: 404 },
    );
  }

  const camp = Array.isArray((msg as any).campaigns) ? (msg as any).campaigns[0] : (msg as any).campaigns;
  const sellerId = camp?.seller_id as string | null;
  if (!sellerId) {
    return NextResponse.json({ error: "campaign has no seller_id" }, { status: 422 });
  }

  const { data: seller } = await svc
    .from("sellers")
    .select("id, unipile_account_id")
    .eq("id", sellerId)
    .maybeSingle();
  const accountId = (seller?.unipile_account_id as string | null) ?? null;
  if (!accountId) {
    return NextResponse.json({ error: "seller has no unipile_account_id" }, { status: 422 });
  }

  const invitationId = (msg as any).provider_message_id as string;
  const result = await withdrawInvitation(invitationId, accountId);
  const nowISO = new Date().toISOString();

  await svc
    .from("campaign_messages")
    .update({
      metadata: {
        dispatched_by: "manual-withdraw",
        withdraw_attempted_at: nowISO,
        withdraw_status: result.ok ? result.status : "failed",
        ...(result.ok ? {} : { withdraw_error: result.reason }),
      },
    })
    .eq("id", (msg as any).id);

  if (shouldClose && result.ok) {
    await svc
      .from("campaigns")
      .update({ status: "completed", stop_reason: "manual_withdraw", completed_at: nowISO })
      .eq("id", camp.id);
  }

  return NextResponse.json({
    ok: result.ok,
    leadId,
    campaignId: camp.id,
    invitationId,
    status: result.ok ? result.status : "failed",
    ...(result.ok ? {} : { error: result.reason }),
    campaignClosed: shouldClose && result.ok,
  }, { status: result.ok ? 200 : 502 });
}
