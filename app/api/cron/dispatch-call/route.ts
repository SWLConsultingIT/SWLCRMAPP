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

// Business hours: 09:00-18:00 local Mon-Fri. We check this in the LEAD's
// timezone (best-effort from company_country) so we never dial somebody at
// 3 AM their time. Outside the window the message is requeued with
// eligible_at = next business window start, so the dispatcher just skips it
// until then instead of failing.
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18;

const COUNTRY_TZ: Record<string, string> = {
  GB: "Europe/London", UK: "Europe/London",
  IE: "Europe/Dublin",
  US: "America/New_York", USA: "America/New_York",
  CA: "America/Toronto",
  AR: "America/Argentina/Buenos_Aires",
  ES: "Europe/Madrid",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
  IT: "Europe/Rome",
  NL: "Europe/Amsterdam",
  PT: "Europe/Lisbon",
  CH: "Europe/Zurich",
  AT: "Europe/Vienna",
  BE: "Europe/Brussels",
  AU: "Australia/Sydney",
  MX: "America/Mexico_City",
  BR: "America/Sao_Paulo",
};

function resolveTimezone(country: string | null | undefined): string {
  if (!country) return "Europe/London"; // safe Western-business default
  const k = country.trim().toUpperCase();
  return COUNTRY_TZ[k] ?? "Europe/London";
}

function nowPartsInTz(tz: string): { hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", hour: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hourStr = parts.find(p => p.type === "hour")?.value ?? "0";
  const wd = parts.find(p => p.type === "weekday")?.value ?? "Mon";
  // Intl returns "00".."23" (or "24" for midnight in some locales)
  const hour = Number(hourStr) % 24;
  // Normalize weekday string to 0=Sun..6=Sat
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[wd] ?? 1;
  return { hour, weekday };
}

function isBusinessHours(tz: string): boolean {
  const { hour, weekday } = nowPartsInTz(tz);
  if (weekday === 0 || weekday === 6) return false; // weekend
  return hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
}

function nextBusinessWindowStartUTC(tz: string): string {
  // Walk forward in 1-hour steps from now until we hit the start of the
  // next business window. Capped at 7 days as a safety stop.
  const now = new Date();
  for (let h = 1; h <= 7 * 24; h += 1) {
    const candidate = new Date(now.getTime() + h * 60 * 60 * 1000);
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, weekday: "short", hour: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(candidate);
    const hour = Number(parts.find(p => p.type === "hour")?.value ?? "0") % 24;
    const wd = parts.find(p => p.type === "weekday")?.value ?? "Mon";
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = weekdayMap[wd] ?? 1;
    if (weekday !== 0 && weekday !== 6 && hour === BUSINESS_START_HOUR) {
      return candidate.toISOString();
    }
  }
  // Fallback: 12h from now (should never hit)
  return new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
}

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
  aircall_user_id: string | null;
};

// In-tick cache of company_bios.aircall_user_id keyed by lead.company_bio_id.
// Built lazily inside dispatchOneCall so tenants without queued calls don't
// generate any DB reads.

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
  // Atomic claim: queued → dispatching. Stamp dispatching_since so the reaper
  // cron can recover this row if we crash before reaching 'sent' / 'failed'.
  const { data: lockedRows } = await svc
    .from("campaign_messages")
    .update({ status: "dispatching", dispatching_since: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select("id");
  if (!lockedRows || lockedRows.length === 0) {
    return { kind: "lost_race", msgId: candidate.id, leadId: candidate.lead_id };
  }

  // Hydrate lead + campaign + tenant.
  const [{ data: lead }, { data: campaign }] = await Promise.all([
    svc.from("leads")
      .select("id, primary_first_name, primary_last_name, primary_phone, primary_secondary_phone, company_bio_id, company_country")
      .eq("id", candidate.lead_id).maybeSingle(),
    svc.from("campaigns")
      .select("id, seller_id, name, aircall_number_id")
      .eq("id", candidate.campaign_id).maybeSingle(),
  ]);
  if (!lead || !campaign) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "lead or campaign missing");
  }

  // Business-hours guard: never dial a lead at 3 AM their time. Skip + requeue
  // with eligible_at set to the next 09:00 local Mon-Fri so the dispatcher
  // ignores this row until then. Cooldown machinery and daily caps still apply.
  const tz = resolveTimezone((lead as any).company_country);
  if (!isBusinessHours(tz)) {
    const eligibleAt = nextBusinessWindowStartUTC(tz);
    await svc.from("campaign_messages").update({
      status: "queued",
      metadata: { eligible_at: eligibleAt, deferred_by: "business-hours", deferred_tz: tz },
    }).eq("id", candidate.id);
    return { kind: "skipped", msgId: candidate.id, leadId: lead.id, reason: `outside business hours (${tz}); requeued for ${eligibleAt}` };
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

  // Number + tenant-default-user resolution in one DB read.
  let numberId: number | null = (campaign as any).aircall_number_id ?? null;
  let tenantAircallUserId: number | null = null;
  const leadBioId = (lead as any).company_bio_id ?? null;
  if (leadBioId) {
    const { data: bio } = await svc
      .from("company_bios")
      .select("aircall_number_ids, aircall_user_id")
      .eq("id", leadBioId)
      .maybeSingle();
    const pool = ((bio as any)?.aircall_number_ids as number[] | null) ?? [];
    if (!numberId) numberId = pool[0] ?? null;
    const tu = (bio as any)?.aircall_user_id;
    if (tu) {
      const parsed = Number(tu);
      if (Number.isFinite(parsed)) tenantAircallUserId = parsed;
    }
  }
  if (!numberId && Number.isFinite(DEFAULT_NUMBER_ID)) numberId = DEFAULT_NUMBER_ID;
  if (!numberId) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "tenant has no Aircall number assigned");
  }

  // Resolve which Aircall user dials this message. Model is one Aircall user
  // per tenant — everyone working under a given tenant calls through that
  // shared inbox (e.g., sales@arqy.io for Arqy leads). Falls back to
  // "first available" only if the tenant has no Aircall user configured
  // yet (mostly during onboarding before company_bios.aircall_user_id is set).
  const resolvedUserId = tenantAircallUserId ?? availableAircallUserId;

  // Place the call. Aircall returns 204 No Content; the call_id arrives
  // later via webhook.
  let callOk = false;
  let errReason = "";
  try {
    const res = await fetch(`https://api.aircall.io/v1/users/${resolvedUserId}/calls`, {
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
        aircall_user_id: resolvedUserId,
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

  return { kind: "initiated", msgId: candidate.id, leadId: lead.id, userId: resolvedUserId, numberId };
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
  availableUserIdSet: Set<number>,
  fallbackAvailableUserId: number,
): Promise<SellerBatchResult> {
  const result: SellerBatchResult = {
    sellerId: seller.id,
    sellerName: seller.name ?? "(unnamed)",
    attempted: 0,
    outcomes: [],
    blockedReason: null,
  };

  // Per-seller Aircall user resolution. NOTE: at this point we don't yet know
  // which tenant the queued message belongs to (the message could be for any
  // lead in any tenant the seller serves). The full resolution chain
  // (seller → tenant → fallback) happens inside dispatchOneCall once we
  // hydrate the lead. Here we only use seller-level binding when present;
  // otherwise we pass the fallback as a hint to dispatchOneCall.
  let aircallUserId: number;
  if (seller.aircall_user_id) {
    const mapped = Number(seller.aircall_user_id);
    if (!Number.isFinite(mapped) || !availableUserIdSet.has(mapped)) {
      result.blockedReason = `seller's Aircall user ${seller.aircall_user_id} is not signed in`;
      return result;
    }
    aircallUserId = mapped;
  } else {
    // Will be overridden per-message inside dispatchOneCall by the tenant's
    // company_bios.aircall_user_id when set. This preserves backwards compat
    // for sellers without explicit binding while still routing per-tenant.
    aircallUserId = fallbackAvailableUserId;
  }

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
    const outcome = await dispatchOneCall(svc, msg, seller, aircallUserId);
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

  // Aircall preflight: pull the list of all users + availability ONCE per
  // tick so each seller's batch can resolve its own user_id without N round
  // trips.
  let aircallUsers: Array<{ id: number; available: boolean }> = [];
  try {
    const usersRes = await fetch("https://api.aircall.io/v1/users?per_page=50", {
      headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
    });
    if (usersRes.ok) {
      const usersData = await usersRes.json();
      aircallUsers = (usersData?.users ?? [])
        .map((u: any) => ({ id: Number(u?.id), available: u?.available === true }))
        .filter((u: any) => Number.isFinite(u.id));
    }
  } catch {}
  const fallbackAvailableUserId = aircallUsers.find(u => u.available)?.id ?? null;

  if (aircallUsers.length === 0 || !fallbackAvailableUserId) {
    // No user is signed in at all → nothing we can dispatch this tick.
    return NextResponse.json({
      ok: true, processed: 0,
      reason: "no Aircall user signed in — skipping tick",
    });
  }
  const availableUserIdSet = new Set(aircallUsers.filter(u => u.available).map(u => u.id));

  const svc = getSupabaseService();

  const { data: sellers } = await svc
    .from("sellers")
    .select("id, name, call_daily_limit, active, aircall_user_id")
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

  // Process every seller's batch in parallel. Each seller resolves its own
  // Aircall user_id via the per-seller resolver inside processSellerBatch.
  const sellerResults = await Promise.all(
    activeSellers.map((s) => processSellerBatch(svc, s, sentCounts[s.id] ?? 0, availableUserIdSet, fallbackAvailableUserId)),
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
    fallback_aircall_user_id: fallbackAvailableUserId,
    sellers: sellerResults.map((r) => ({
      sellerId: r.sellerId,
      sellerName: r.sellerName,
      attempted: r.attempted,
      initiated: r.outcomes.filter((o) => o.kind === "initiated").length,
      blocked: r.blockedReason,
    })),
  });
}
