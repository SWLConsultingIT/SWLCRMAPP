import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Daily ramp for `sellers.linkedin_daily_limit`. Cold LinkedIn accounts get
// throttled by Unipile/LinkedIn well before the configured 20/day cap (see
// reference_linkedin_invite_limits.md). This endpoint walks every active
// seller, computes a target cap based on account "age" (the earliest sent
// LinkedIn message, falling back to sellers.created_at), and updates the
// cap when it differs.
//
// Schedule: once a day from the n8n Orquestador. The dispatcher already
// enforces whatever cap is in the row, so this just shifts the ceiling.
//
// Manual override grace: if `sellers.updated_at` was bumped in the last 6h
// the row is skipped — assumed to be a human edit via /accounts that the
// cron should not stomp on. The next day's tick will pick it up if it's
// drifted from the auto target.

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const MANUAL_OVERRIDE_GRACE_MS = 6 * 60 * 60 * 1000;

function authorized(req: NextRequest, scopeRole: string | null): boolean {
  if (scopeRole === "admin") return true;
  if (!CRON_SECRET) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${CRON_SECRET}`;
}

// Static ramp — empirical curve from reference_linkedin_invite_limits.md.
// Days are counted from the seller's earliest sent message (or created_at).
function targetCap(daysActive: number): number {
  if (daysActive <= 7)  return 5;
  if (daysActive <= 14) return 8;
  if (daysActive <= 30) return 12;
  return 20;
}

// Sellers managed by the ramp have a cap in the ramp set. Anything else
// (e.g. 50 set manually for a power user) is treated as an explicit override
// and left alone — the ramp won't drag a tuned-up seller back down.
const RAMP_SET = new Set([5, 8, 12, 20]);

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }

async function handle(req: NextRequest) {
  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (!authorized(req, scope.role ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();
  const nowMs = Date.now();

  // Filter on `unipile_account_id` — the dispatcher uses Unipile, and not
  // every seller has the legacy `linkedin_account_id` field populated.
  const { data: sellers, error: sellersErr } = await svc
    .from("sellers")
    .select("id, name, created_at, updated_at, linkedin_daily_limit, unipile_account_id")
    .eq("active", true)
    .not("unipile_account_id", "is", null);

  if (sellersErr) {
    return NextResponse.json({ error: sellersErr.message }, { status: 500 });
  }

  // Earliest sent LinkedIn message per seller — anchors "account age".
  // Single query: pull the (seller_id, sent_at) for status='sent' rows joined
  // through campaigns, then min() in JS.
  const sellerIds = (sellers ?? []).map(s => s.id);
  const earliestBySeller: Record<string, number> = {};
  if (sellerIds.length > 0) {
    const { data: sentRows } = await svc
      .from("campaign_messages")
      .select("sent_at, campaigns!inner(seller_id)")
      .eq("status", "sent")
      .eq("channel", "linkedin")
      .not("sent_at", "is", null)
      .in("campaigns.seller_id", sellerIds)
      .order("sent_at", { ascending: true });
    for (const row of sentRows ?? []) {
      const sid = (row as any)?.campaigns?.seller_id;
      const t = row.sent_at ? new Date(row.sent_at as string).getTime() : null;
      if (sid && t && earliestBySeller[sid] === undefined) earliestBySeller[sid] = t;
    }
  }

  const updates: Array<{ id: string; name: string | null; from: number | null; to: number; days: number }> = [];
  const skipped: Array<{ id: string; name: string | null; reason: string }> = [];

  for (const s of sellers ?? []) {
    const anchor = earliestBySeller[s.id] ?? new Date(s.created_at).getTime();
    const days = Math.floor((nowMs - anchor) / (24 * 60 * 60 * 1000));
    const target = targetCap(days);
    const current = (s as any).linkedin_daily_limit ?? null;

    if (current === target) continue;

    // Respect manual overrides: if the cap isn't one of the ramp values, the
    // user (or a previous tier) deliberately set it — don't pull it back down.
    if (current !== null && !RAMP_SET.has(current)) {
      skipped.push({ id: s.id, name: s.name, reason: `manual_override (current=${current})` });
      continue;
    }

    const updatedAtMs = s.updated_at ? new Date(s.updated_at).getTime() : 0;
    if (updatedAtMs && nowMs - updatedAtMs < MANUAL_OVERRIDE_GRACE_MS) {
      skipped.push({ id: s.id, name: s.name, reason: "recent_manual_edit" });
      continue;
    }

    const { error: updErr } = await svc
      .from("sellers")
      .update({ linkedin_daily_limit: target })
      .eq("id", s.id);
    if (updErr) {
      skipped.push({ id: s.id, name: s.name, reason: `db_error: ${updErr.message}` });
      continue;
    }
    updates.push({ id: s.id, name: s.name, from: current, to: target, days });
  }

  return NextResponse.json({
    ok: true,
    processed: sellers?.length ?? 0,
    updated: updates.length,
    updates,
    skipped,
  });
}
