import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Cron-driven Aircall dispatcher.
//
// Same parallel-batch pattern as /api/cron/dispatch-queue (LinkedIn): list
// active sellers across all tenants, process each in parallel, send up to
// BATCH_SIZE_PER_SELLER calls per tick. Tenants are decoupled by virtue of
// having different sellers and different tenant-scoped number pools.
//
// Aircall specifics:
//   - Outbound endpoint: POST /v1/users/{user_id}/calls
//     The OLD /v1/calls endpoint returns 404 — that's deprecated.
//   - Returns 204 No Content on success — the actual call_id arrives later
//     via webhook (n8n workflow 26vRoCGqSNuti1Ky AIRCALL Webhook Events
//     updates the calls row with the call_id).
//   - User resolution: pick first user with `available === true` (signed
//     into Aircall app). If none → return early with reason; we don't want
//     to enqueue calls that Aircall will queue indefinitely without anyone
//     actually picking up.
//   - Number resolution per call:
//       1. campaigns.aircall_number_id (per-campaign override)
//       2. company_bios.aircall_number_ids[0] (tenant default)
//       3. AIRCALL_DEFAULT_NUMBER_ID env (last resort, SWL admin only path)
//   - Phone normalization to E.164 (strip non-digits, prepend +).

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`,
).toString("base64");
const DEFAULT_NUMBER_ID = Number(process.env.AIRCALL_DEFAULT_NUMBER_ID);
const CRON_SECRET = process.env.CRON_SECRET ?? "";

const RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const BATCH_SIZE_PER_SELLER = 3;

type QueuedRow = {
  id: string;
  campaign_id: string;
  lead_id: string;
  step_number: number;
  channel: string;
  status: string;
  metadata?: Record<string, unknown> | null;
};

type SellerRow = {
  id: string;
  name: string | null;
  call_daily_limit: number | null;
  active: boolean | null;
};

function authorized(req: NextRequest, scopeRole: string | null): boolean {
  if (scopeRole === "admin") return true;
  if (!CRON_SECRET) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${CRON_SECRET}`;
}

type DispatchOutcome =
  | { kind: "initiated"; msgId: string; leadId: string; userId: number; numberId: number }
  | { kind: "skipped"; msgId: string; leadId: string; reason: string }
  | { kind: "failed"; msgId: string; leadId: string; reason: string }
  | { kind: "lost_race"; msgId: string; leadId: string };

async function failMessage(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
): Promise<DispatchOutcome> {
  await svc.from("campaign_messages").update({
    status: "failed",
    error_details: reason,
    metadata: { dispatched_by: "cron-dispatch-call", failed_at: new Date().toISOString() },
  }).eq("id", msgId);
  return { kind: "failed", msgId, leadId, reason };
}

async function dispatchOneCall(
  svc: ReturnType<typeof getSupabaseService>,
  candidate: QueuedRow,
  seller: SellerRow,
  availableAircallUserId: number,
): Promise<DispatchOutcome> {
  // Atomic claim: queued → dispatching
  const { data: lockedRows } = await svc
    .from("campaign_messages")
    .update({ status: "dispatching" })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select("id");
  if (!lockedRows || lockedRows.length === 0) {
    return { kind: "lost_race", msgId: candidate.id, leadId: candidate.lead_id };
  }

  // Hydrate lead + campaign + tenant.
  const [{ data: lead }, { data: campaign }] = await Promise.all([
    svc.from("leads")
      .select("id, primary_first_name, primary_last_name, primary_phone, primary_secondary_phone, company_bio_id")
      .eq("id", candidate.lead_id).maybeSingle(),
    svc.from("campaigns")
      .select("id, seller_id, name, aircall_number_id")
      .eq("id", candidate.campaign_id).maybeSingle(),
  ]);
  if (!lead || !campaign) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "lead or campaign missing");
  }

  // Phone resolution + E.164 normalization.
  const rawPhone = (lead as any).primary_phone || (lead as any).primary_secondary_phone || null;
  if (!rawPhone) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "lead has no phone");
  }
  const normalizedPhone = "+" + String(rawPhone).replace(/[^\d]/g, "");
  if (normalizedPhone.length < 8) {
    return await failMessage(svc, candidate.id, candidate.lead_id, `phone "${rawPhone}" did not normalize to E.164`);
  }

  // Number resolution: campaign override → tenant pool → env default.
  let numberId: number | null = (campaign as any).aircall_number_id ?? null;
  if (!numberId) {
    const { data: bio } = await svc
      .from("company_bios")
      .select("aircall_number_ids")
      .eq("id", (lead as any).company_bio_id)
      .maybeSingle();
    const pool = ((bio as any)?.aircall_number_ids as number[] | null) ?? [];
    numberId = pool[0] ?? null;
  }
  if (!numberId && Number.isFinite(DEFAULT_NUMBER_ID)) numberId = DEFAULT_NUMBER_ID;
  if (!numberId) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "tenant has no Aircall number assigned");
  }

  // Place the call. Aircall returns 204 No Content; the call_id arrives
  // later via webhook.
  let callOk = false;
  let errReason = "";
  try {
    const res = await fetch(`https://api.aircall.io/v1/users/${availableAircallUserId}/calls`, {
      method: "POST",
      headers: { Authorization: `Basic ${AIRCALL_AUTH}`, "Content-Type": "application/json" },
      body: JSON.stringify({ number_id: numberId, to: normalizedPhone }),
    });
    callOk = res.ok;
    if (!res.ok) errReason = (await res.text()) || `Aircall ${res.status}`;
  } catch (e: any) {
    errReason = e?.message ?? String(e);
  }

  if (!callOk) {
    return await failMessage(svc, candidate.id, candidate.lead_id, errReason);
  }

  // Mark sent + log into calls table. The webhook will fill in aircall_call_id
  // when call.created fires.
  const now = new Date().toISOString();
  await Promise.all([
    svc.from("campaign_messages").update({
      status: "sent",
      sent_at: now,
      error_details: null,
      metadata: {
        dispatched_by: "cron-dispatch-call",
        aircall_user_id: availableAircallUserId,
        aircall_number_id: numberId,
      },
    }).eq("id", candidate.id),
    svc.from("calls").insert({
      lead_id: lead.id,
      seller_id: seller.id,
      direction: "outbound",
      status: "initiated",
      phone_number: rawPhone,
      started_at: now,
    }),
    svc.from("leads").update({ status: "contacted", current_channel: "call" }).eq("id", lead.id),
  ]);

  return { kind: "initiated", msgId: candidate.id, leadId: lead.id, userId: availableAircallUserId, numberId };
}

type SellerBatchResult = {
  sellerId: string;
  sellerName: string;
  attempted: number;
  outcomes: DispatchOutcome[];
  blockedReason: string | null;
};

async function processSellerBatch(
  svc: ReturnType<typeof getSupabaseService>,
  seller: SellerRow,
  sentToday: number,
  availableAircallUserId: number,
): Promise<SellerBatchResult> {
  const result: SellerBatchResult = {
    sellerId: seller.id,
    sellerName: seller.name ?? "(unnamed)",
    attempted: 0,
    outcomes: [],
    blockedReason: null,
  };

  const dailyLimit = seller.call_daily_limit ?? 30;
  const remaining = dailyLimit - sentToday;
  if (remaining <= 0) {
    result.blockedReason = `daily_cap_reached (${sentToday}/${dailyLimit})`;
    return result;
  }
  const batchSize = Math.min(remaining, BATCH_SIZE_PER_SELLER);

  const { data: candidates } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, step_number, channel, status, metadata, campaigns!inner(seller_id)")
    .eq("status", "queued")
    .eq("channel", "call")
    .eq("campaigns.seller_id", seller.id)
    .order("created_at", { ascending: true })
    .limit(20);

  const nowMs = Date.now();
  const eligible = (candidates ?? []).filter((r: any) => {
    const eligibleAt = r?.metadata?.eligible_at;
    if (eligibleAt && new Date(eligibleAt).getTime() > nowMs) return false;
    const lastRL = r?.metadata?.last_rate_limit_at;
    if (lastRL && nowMs - new Date(lastRL).getTime() <= RATE_LIMIT_COOLDOWN_MS) return false;
    return true;
  });

  if (eligible.length === 0) {
    result.blockedReason = (candidates?.length ?? 0) === 0 ? "no queued for seller" : "all in cooldown / future-scheduled";
    return result;
  }

  const batch = eligible.slice(0, batchSize) as QueuedRow[];

  for (const msg of batch) {
    result.attempted += 1;
    const outcome = await dispatchOneCall(svc, msg, seller, availableAircallUserId);
    result.outcomes.push(outcome);
  }
  return result;
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (!authorized(req, scope.role ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Aircall preflight: is there an available user signed into the app?
  // Without this, every message we'd "dispatch" would be queued by Aircall
  // and never actually rung. Better to skip entirely and surface the reason
  // than to mark messages sent prematurely.
  let availableUserId: number | null = null;
  try {
    const usersRes = await fetch("https://api.aircall.io/v1/users", {
      headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
    });
    if (usersRes.ok) {
      const usersData = await usersRes.json();
      const candidate = (usersData?.users ?? []).find((u: any) => u?.available === true);
      if (candidate?.id) availableUserId = Number(candidate.id);
    }
  } catch {}

  if (!availableUserId) {
    return NextResponse.json({
      ok: true, processed: 0,
      reason: "no Aircall user signed in — skipping tick",
    });
  }

  const svc = getSupabaseService();

  const { data: sellers } = await svc
    .from("sellers")
    .select("id, name, call_daily_limit, active")
    .eq("active", true);
  const activeSellers = (sellers ?? []) as SellerRow[];

  if (activeSellers.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, reason: "no active sellers" });
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sellerIds = activeSellers.map((s) => s.id);
  const { data: sentRows } = await svc
    .from("campaign_messages")
    .select("id, campaigns!inner(seller_id)")
    .eq("status", "sent")
    .eq("channel", "call")
    .gte("sent_at", since24h)
    .in("campaigns.seller_id", sellerIds);
  const sentCounts: Record<string, number> = {};
  for (const row of sentRows ?? []) {
    const sid = (row as any)?.campaigns?.seller_id as string | undefined;
    if (sid) sentCounts[sid] = (sentCounts[sid] ?? 0) + 1;
  }

  // Process every seller's batch in parallel.
  const sellerResults = await Promise.all(
    activeSellers.map((s) => processSellerBatch(svc, s, sentCounts[s.id] ?? 0, availableUserId!)),
  );

  let processed = 0;
  let failed = 0;
  for (const r of sellerResults) {
    for (const o of r.outcomes) {
      if (o.kind === "initiated") processed += 1;
      else if (o.kind === "failed") failed += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    failed,
    aircall_user_id: availableUserId,
    sellers: sellerResults.map((r) => ({
      sellerId: r.sellerId,
      sellerName: r.sellerName,
      attempted: r.attempted,
      initiated: r.outcomes.filter((o) => o.kind === "initiated").length,
      blocked: r.blockedReason,
    })),
  });
}
