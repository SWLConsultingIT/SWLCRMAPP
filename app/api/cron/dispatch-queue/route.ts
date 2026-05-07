import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Cron-driven LinkedIn dispatcher.
//
// Why parallel-by-seller instead of "1 message per tick":
//   At scale (multiple tenants × multiple sellers × hundreds of leads each)
//   we can't afford a serial queue. Each tenant's sellers are independent —
//   they have their own Unipile accounts, their own LinkedIn caps, their own
//   rate limits. A 422 on Graeme (Pathway) must NOT block Juan (SWL).
//
//   Each tick the orchestrator calls this endpoint and we:
//     1. List every active seller across every tenant
//     2. Per seller in parallel:
//        - Compute remaining capacity = daily_limit - sent_today
//        - Claim a small BATCH of queued messages for that seller
//        - Dispatch them sequentially (within the seller) to avoid bursting
//          LinkedIn — they still respect the per-account cap
//        - On 422 (rate limit) cascade cooldown to all queued of that seller
//          and stop this seller's batch (other sellers keep going)
//   Tenants are decoupled by virtue of having different sellers; sellers are
//   decoupled by being processed in independent Promise.all branches.
//
// Why a small BATCH and not "send capacity all at once":
//   LinkedIn rate-limits bursts. A seller with cap 50/day shouldn't try to
//   send 50 invites in a single 15-min tick — that triggers 422s and burns
//   the cooldown for hours. We send up to BATCH_SIZE_PER_SELLER per tick,
//   distribute across the day's ticks (96 ticks/day at 15 min), and let
//   the cooldown machinery handle bursts.

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY!;
const CRON_SECRET = process.env.CRON_SECRET ?? "";

// LinkedIn caps invite notes at ~200 chars for non-Premium accounts. Prior
// 300 default tripped 400s on Graeme — confirmed empirically 2026-05-06.
const NOTE_MAX_LEN = 200;
const RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Maximum messages to dispatch per seller per tick. Conservative to avoid
// LinkedIn burst protection. With 96 ticks/day a seller can reach a 50/day
// cap on its own pace.
const BATCH_SIZE_PER_SELLER = 5;

type QueuedRow = {
  id: string;
  campaign_id: string;
  lead_id: string;
  step_number: number;
  channel: string;
  content: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
};

type LeadRow = {
  id: string;
  primary_first_name: string | null;
  primary_last_name: string | null;
  primary_linkedin_url: string | null;
  linkedin_internal_id: string | null;
  company_name: string | null;
  primary_title_role: string | null;
};

type SellerRow = {
  id: string;
  name: string | null;
  unipile_account_id: string | null;
  linkedin_status: string | null;
  linkedin_daily_limit: number | null;
};

function authorized(req: NextRequest, scopeRole: string | null): boolean {
  if (scopeRole === "admin") return true;
  if (!CRON_SECRET) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${CRON_SECRET}`;
}

function extractLinkedinSlug(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/in\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function nameMatches(
  expectedFirst: string | null,
  expectedLast: string | null,
  apiFirst: string,
  apiLast: string,
): boolean {
  const ef = (expectedFirst ?? "").trim().toLowerCase();
  const el = (expectedLast ?? "").trim().toLowerCase();
  const af = apiFirst.trim().toLowerCase();
  const al = apiLast.trim().toLowerCase();
  if (!ef || !el || !af || !al) return false;
  return af.startsWith(ef.slice(0, 3)) && al.startsWith(el.slice(0, 3));
}

function personalizeNote(template: string, lead: LeadRow, seller: SellerRow): string {
  const first = lead.primary_first_name ?? "there";
  const last = lead.primary_last_name ?? "";
  const full = `${first} ${last}`.trim();
  const company = lead.company_name ?? "";
  const role = lead.primary_title_role ?? "";
  const sellerName = seller.name ?? "";
  return (template ?? "")
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{last_name}}", last)
    .replaceAll("{{full_name}}", full)
    .replaceAll("{{company_name}}", company)
    .replaceAll("{{company}}", company)
    .replaceAll("{{role}}", role)
    .replaceAll("{{title}}", role)
    .replaceAll("{{seller_name}}", sellerName)
    .replaceAll("{{seller_company}}", "");
}

async function unipileGet(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" },
  });
  const body = await res.text();
  let parsed: any = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = parsed?.detail || parsed?.message || body || `HTTP ${res.status}`;
    throw new Error(`Unipile GET ${url} → ${res.status}: ${err}`);
  }
  return parsed;
}

async function unipilePost(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-KEY": UNIPILE_KEY,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = parsed?.detail || parsed?.title || parsed?.message || text || `HTTP ${res.status}`;
    throw new Error(`Unipile POST ${url} → ${res.status}: ${err}`);
  }
  return parsed;
}

function isRateLimitError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("temporary provider limit")
    || r.includes("rate limit")
    || r.includes("rate-limit")
    || r.includes("too many requests")
    || r.includes("429");
}

function isAlreadyConnectedError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("already connected") || r.includes("already a contact");
}

function isAlreadyInvitedError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("already sent") || r.includes("invitation has already");
}

// ────── Per-message outcome shape (no NextResponse — caller aggregates) ──────

type DispatchOutcome =
  | { kind: "sent"; msgId: string; leadId: string; providerMessageId: string | null; chatId: string | null; step: number; nextEligibleAt: string | null; truncated: boolean }
  | { kind: "skipped_connected"; msgId: string; leadId: string; nextEligibleAt: string }
  | { kind: "skipped_invited"; msgId: string; leadId: string }
  | { kind: "failed"; msgId: string; leadId: string; reason: string }
  | { kind: "rate_limited"; msgId: string; leadId: string; reason: string; cascadedCount: number }
  | { kind: "lost_race"; msgId: string; leadId: string };

// ────── DB helpers — mutate state, return shape (no NextResponse) ──────

async function failMessage(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
): Promise<DispatchOutcome> {
  await svc.from("campaign_messages").update({
    status: "failed",
    error_details: reason,
    metadata: { dispatched_by: "cron-dispatch-queue", failed_at: new Date().toISOString() },
  }).eq("id", msgId);
  return { kind: "failed", msgId, leadId, reason };
}

async function skipAlreadyConnected(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, campaignId: string, stepNumber: number, reason: string,
): Promise<DispatchOutcome> {
  const now = new Date().toISOString();
  const eligibleAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await Promise.all([
    svc.from("campaign_messages").update({
      status: "skipped",
      sent_at: now,
      error_details: null,
      metadata: { dispatched_by: "cron-dispatch-queue", skipped_reason: reason, skipped_at: now },
    }).eq("id", msgId),
    svc.from("leads").update({ linkedin_connected: true, updated_at: now }).eq("id", leadId),
    svc.from("campaigns").update({
      current_step: stepNumber,
      last_step_at: now,
    }).eq("id", campaignId),
    svc.from("campaign_messages").update({
      status: "queued",
      metadata: { eligible_at: eligibleAt, queued_by: "cron-dispatch-queue:already-connected" },
    }).eq("campaign_id", campaignId).eq("step_number", stepNumber + 1).eq("status", "draft"),
  ]);
  return { kind: "skipped_connected", msgId, leadId, nextEligibleAt: eligibleAt };
}

async function markAlreadyInvited(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
): Promise<DispatchOutcome> {
  const now = new Date().toISOString();
  await svc.from("campaign_messages").update({
    status: "skipped",
    sent_at: null,
    error_details: null,
    metadata: { dispatched_by: "cron-dispatch-queue", skipped_reason: reason, skipped_at: now, awaiting_acceptance: true },
  }).eq("id", msgId);
  return { kind: "skipped_invited", msgId, leadId };
}

async function requeueRateLimited(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, sellerId: string | null, reason: string,
): Promise<DispatchOutcome> {
  const cooldownAt = new Date().toISOString();
  const { data: existing } = await svc
    .from("campaign_messages").select("metadata").eq("id", msgId).maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  const prevCount = typeof prevMeta.rate_limit_count === "number" ? prevMeta.rate_limit_count : 0;
  await svc.from("campaign_messages").update({
    status: "queued",
    error_details: null,
    metadata: {
      ...prevMeta,
      dispatched_by: "cron-dispatch-queue",
      last_rate_limit_at: cooldownAt,
      last_rate_limit_reason: reason,
      rate_limit_count: prevCount + 1,
    },
  }).eq("id", msgId);

  let cascadedCount = 0;
  if (sellerId) {
    const { data: sellerQueued } = await svc
      .from("campaign_messages")
      .select("id, metadata, campaigns!inner(seller_id)")
      .eq("status", "queued")
      .eq("channel", "linkedin")
      .eq("campaigns.seller_id", sellerId)
      .neq("id", msgId);
    if (sellerQueued && sellerQueued.length > 0) {
      await Promise.all((sellerQueued as any[]).map((row) => {
        const meta = (row.metadata as Record<string, unknown> | null) ?? {};
        return svc.from("campaign_messages").update({
          metadata: {
            ...meta,
            last_rate_limit_at: cooldownAt,
            last_rate_limit_reason: `cascade from ${msgId}: ${reason}`,
          },
        }).eq("id", row.id);
      }));
      cascadedCount = sellerQueued.length;
    }
  }
  return { kind: "rate_limited", msgId, leadId, reason, cascadedCount };
}

// ────── Per-message dispatcher ──────

async function dispatchOneMessage(
  svc: ReturnType<typeof getSupabaseService>,
  candidate: QueuedRow,
  seller: SellerRow,
): Promise<DispatchOutcome> {
  // Optimistic concurrency: only proceed if our UPDATE flips the row from
  // queued → dispatching. Concurrent ticks (or parallel seller branches) race
  // here; only one wins.
  const { data: lockedRows, error: lockErr } = await svc
    .from("campaign_messages")
    .update({ status: "dispatching" })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select("id");
  if (lockErr || !lockedRows || lockedRows.length === 0) {
    return { kind: "lost_race", msgId: candidate.id, leadId: candidate.lead_id };
  }

  // Hydrate the lead + campaign rows we need.
  const [{ data: lead }, { data: campaign }] = await Promise.all([
    svc.from("leads").select("id, primary_first_name, primary_last_name, primary_linkedin_url, linkedin_internal_id, company_name, primary_title_role")
      .eq("id", candidate.lead_id).maybeSingle(),
    svc.from("campaigns").select("id, seller_id, name, sequence_steps").eq("id", candidate.campaign_id).maybeSingle(),
  ]);
  if (!lead || !campaign) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "lead or campaign missing");
  }

  if (!seller.unipile_account_id) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "seller has no unipile_account_id");
  }
  if (seller.linkedin_status === "restricted") {
    return await failMessage(svc, candidate.id, candidate.lead_id, "seller LinkedIn is restricted");
  }

  const slug = extractLinkedinSlug(lead.primary_linkedin_url);
  if (!slug) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "no LinkedIn slug on lead");
  }

  let providerId = lead.linkedin_internal_id ?? null;
  let networkDistance: string | null = null;
  let invitationStatus: string | null = null;

  try {
    const needsFetch = !providerId || candidate.step_number === 0;
    if (needsFetch) {
      const userResp = await unipileGet(
        `${UNIPILE_BASE}/api/v1/users/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(seller.unipile_account_id)}`,
      );
      providerId = userResp?.provider_id ?? providerId;
      networkDistance = userResp?.network_distance ?? null;
      invitationStatus = userResp?.invitation?.status ?? null;
      const apiFirst = userResp?.first_name ?? "";
      const apiLast = userResp?.last_name ?? "";
      if (!nameMatches(lead.primary_first_name, lead.primary_last_name, apiFirst, apiLast)) {
        return await failMessage(
          svc, candidate.id, candidate.lead_id,
          `name mismatch — expected "${lead.primary_first_name} ${lead.primary_last_name}", Unipile returned "${apiFirst} ${apiLast}" for slug "${slug}"`,
        );
      }
      if (!providerId) {
        return await failMessage(svc, candidate.id, candidate.lead_id, "Unipile did not return a provider_id");
      }
      if (!lead.linkedin_internal_id) {
        await svc.from("leads").update({ linkedin_internal_id: providerId }).eq("id", lead.id);
      }
    }
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    if (isRateLimitError(errMsg)) {
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, seller.id, errMsg);
    }
    return await failMessage(svc, candidate.id, candidate.lead_id, errMsg);
  }

  // Step 0 preflight branches
  if (candidate.step_number === 0) {
    if (networkDistance === "FIRST_DEGREE" || networkDistance === "DISTANCE_1") {
      return await skipAlreadyConnected(
        svc, candidate.id, candidate.lead_id, candidate.campaign_id, candidate.step_number,
        `preflight: lead is already a 1st-degree connection (network_distance=${networkDistance})`,
      );
    }
    if (invitationStatus === "PENDING") {
      return await markAlreadyInvited(
        svc, candidate.id, candidate.lead_id,
        "preflight: lead has a pending SENT invitation outstanding (invitation.status=PENDING)",
      );
    }
  }

  const rawTemplate = candidate.content ?? "";
  const personalized = personalizeNote(rawTemplate, lead as LeadRow, seller).trim();
  let outgoing = personalized;
  let truncated = false;
  if (candidate.step_number === 0 && outgoing.length > NOTE_MAX_LEN) {
    outgoing = outgoing.slice(0, NOTE_MAX_LEN - 1).trimEnd() + "…";
    truncated = true;
  }

  let providerMessageId: string | null = null;
  let chatId: string | null = null;
  try {
    if (candidate.step_number === 0) {
      const inviteResp = await unipilePost(`${UNIPILE_BASE}/api/v1/users/invite`, {
        account_id: seller.unipile_account_id,
        provider_id: providerId,
        message: outgoing || undefined,
      });
      providerMessageId = inviteResp?.invitation_id ?? null;
    } else {
      let prevChatId: string | null = null;
      if (candidate.step_number > 1) {
        const { data: prevMsg } = await svc
          .from("campaign_messages")
          .select("metadata")
          .eq("campaign_id", candidate.campaign_id)
          .eq("step_number", candidate.step_number - 1)
          .maybeSingle();
        prevChatId = (prevMsg?.metadata as Record<string, unknown> | null)?.chat_id as string ?? null;
      }
      if (prevChatId) {
        const msgResp = await unipilePost(`${UNIPILE_BASE}/api/v1/chats/${encodeURIComponent(prevChatId)}/messages`, {
          text: outgoing,
        });
        chatId = prevChatId;
        providerMessageId = msgResp?.id ?? msgResp?.message_id ?? null;
      } else {
        const chatResp = await unipilePost(`${UNIPILE_BASE}/api/v1/chats`, {
          account_id: seller.unipile_account_id,
          attendees_ids: [providerId],
          text: outgoing,
        });
        chatId = chatResp?.chat_id ?? chatResp?.id ?? null;
        providerMessageId = chatResp?.message_id ?? chatResp?.id ?? null;
      }
    }
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    if (isRateLimitError(errMsg)) {
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, seller.id, errMsg);
    }
    if (candidate.step_number === 0) {
      if (isAlreadyConnectedError(errMsg)) {
        return await skipAlreadyConnected(
          svc, candidate.id, candidate.lead_id, candidate.campaign_id, candidate.step_number, errMsg,
        );
      }
      if (isAlreadyInvitedError(errMsg)) {
        return await markAlreadyInvited(svc, candidate.id, candidate.lead_id, errMsg);
      }
    }
    return await failMessage(svc, candidate.id, candidate.lead_id, errMsg);
  }

  const now = new Date().toISOString();
  const sequenceSteps = (campaign as any)?.sequence_steps as Array<{ channel?: string; daysAfter?: number }> | null;
  const nextStepNumber = candidate.step_number + 1;
  const nextStepConfig = Array.isArray(sequenceSteps) ? sequenceSteps[candidate.step_number] : null;
  const nextDaysAfter = typeof nextStepConfig?.daysAfter === "number" ? nextStepConfig.daysAfter : null;
  const nextEligibleAt = nextDaysAfter !== null
    ? new Date(Date.now() + nextDaysAfter * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const updateOps: Array<Promise<unknown>> = [
    svc.from("campaign_messages").update({
      status: "sent",
      sent_at: now,
      provider_message_id: providerMessageId,
      error_details: null,
      metadata: {
        dispatched_by: "cron-dispatch-queue",
        truncated_note: truncated,
        ...(chatId ? { chat_id: chatId } : {}),
      },
    }).eq("id", candidate.id),
  ];
  if (candidate.step_number === 0) {
    updateOps.push(
      svc.from("leads").update({ status: "contacted", current_channel: "linkedin" }).eq("id", lead.id),
    );
  } else {
    updateOps.push(
      svc.from("campaigns").update({
        current_step: candidate.step_number,
        last_step_at: now,
        ...(nextEligibleAt === null ? { status: "completed" } : {}),
      }).eq("id", candidate.campaign_id),
    );
  }
  if (candidate.step_number >= 1 && nextEligibleAt) {
    updateOps.push(
      svc.from("campaign_messages").update({
        status: "queued",
        metadata: { eligible_at: nextEligibleAt, queued_by: "cron-dispatch-queue" },
      }).eq("campaign_id", candidate.campaign_id).eq("step_number", nextStepNumber).eq("status", "draft"),
    );
  }
  await Promise.all(updateOps);

  return {
    kind: "sent",
    msgId: candidate.id,
    leadId: lead.id,
    providerMessageId,
    chatId,
    step: candidate.step_number,
    nextEligibleAt,
    truncated,
  };
}

// ────── Per-seller batch processor ──────

type SellerBatchResult = {
  sellerId: string;
  sellerName: string;
  capacity: number;
  attempted: number;
  outcomes: DispatchOutcome[];
  blockedReason: string | null;
};

async function processSellerBatch(
  svc: ReturnType<typeof getSupabaseService>,
  seller: SellerRow,
  sentCount: number,
): Promise<SellerBatchResult> {
  const result: SellerBatchResult = {
    sellerId: seller.id,
    sellerName: seller.name ?? "(unnamed)",
    capacity: 0,
    attempted: 0,
    outcomes: [],
    blockedReason: null,
  };

  if (!seller.unipile_account_id) {
    result.blockedReason = "no unipile_account_id";
    return result;
  }
  if (seller.linkedin_status === "restricted") {
    result.blockedReason = "linkedin_status=restricted";
    return result;
  }

  const dailyLimit = seller.linkedin_daily_limit ?? 20;
  const remaining = dailyLimit - sentCount;
  result.capacity = Math.max(0, remaining);
  if (remaining <= 0) {
    result.blockedReason = `daily_cap_reached (${sentCount}/${dailyLimit})`;
    return result;
  }

  const batchSize = Math.min(remaining, BATCH_SIZE_PER_SELLER);

  // Pull a window of queued messages for this seller, filter eligible.
  const { data: candidates } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, step_number, channel, content, status, metadata, campaigns!inner(seller_id)")
    .eq("status", "queued")
    .eq("channel", "linkedin")
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

  // Sequential dispatch within seller. Stop on rate_limit (the cascade
  // already pauses the rest of this seller's queue for 4h).
  for (const msg of batch) {
    result.attempted += 1;
    const outcome = await dispatchOneMessage(svc, msg, seller);
    result.outcomes.push(outcome);
    if (outcome.kind === "rate_limited") break;
  }
  return result;
}

// ────── HTTP handler ──────

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (!authorized(req, scope.role ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();
  const nowMs = Date.now();
  const since24h = new Date(nowMs - DAY_MS).toISOString();

  // 1. List active sellers across ALL tenants.
  const { data: sellers } = await svc
    .from("sellers")
    .select("id, name, unipile_account_id, linkedin_status, linkedin_daily_limit, active")
    .eq("active", true);
  const activeSellers = (sellers ?? []) as SellerRow[];

  if (activeSellers.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sellers: [], reason: "no active sellers" });
  }

  // 2. Pre-compute 24h sent counts per seller in one query.
  const sellerIds = activeSellers.map((s) => s.id);
  const { data: sentRows } = await svc
    .from("campaign_messages")
    .select("id, campaigns!inner(seller_id)")
    .eq("status", "sent")
    .eq("channel", "linkedin")
    .gte("sent_at", since24h)
    .in("campaigns.seller_id", sellerIds);
  const sentCounts: Record<string, number> = {};
  for (const row of sentRows ?? []) {
    const sid = (row as any)?.campaigns?.seller_id as string | undefined;
    if (sid) sentCounts[sid] = (sentCounts[sid] ?? 0) + 1;
  }

  // 3. Process every seller's batch in parallel. Different tenants' sellers
  //    are completely independent — one rate-limited account doesn't slow
  //    down anyone else.
  const sellerResults = await Promise.all(
    activeSellers.map((s) => processSellerBatch(svc, s, sentCounts[s.id] ?? 0)),
  );

  // 4. Aggregate.
  let processed = 0;
  let rateLimited = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of sellerResults) {
    for (const o of r.outcomes) {
      if (o.kind === "sent") processed += 1;
      else if (o.kind === "rate_limited") rateLimited += 1;
      else if (o.kind === "failed") failed += 1;
      else if (o.kind === "skipped_connected" || o.kind === "skipped_invited") skipped += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    rate_limited: rateLimited,
    failed,
    skipped,
    sellers: sellerResults.map((r) => ({
      sellerId: r.sellerId,
      sellerName: r.sellerName,
      capacity: r.capacity,
      attempted: r.attempted,
      sent: r.outcomes.filter((o) => o.kind === "sent").length,
      blocked: r.blockedReason,
    })),
  });
}
