import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Cron-driven dispatcher for `campaign_messages` rows in `status='queued'`
// where channel='email'. Sends one email per tick via Instantly v2.
//
// Design mirrors /api/cron/dispatch-queue (LinkedIn) but adapted for email:
//   - No connection-request concept — every email is one-shot
//   - No provider_id lookup — Instantly addresses by email string
//   - `subject` lives in metadata.subject (or message.subject if present)
//   - From-address resolved from sellers.instantly_email
//   - To-address from leads.primary_work_email
//
// Auth: same pattern — Vercel cron Bearer ${CRON_SECRET} OR admin role.

const INSTANTLY_KEY = process.env.INSTANTLY_API_KEY ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

type QueuedEmail = {
  id: string;
  campaign_id: string;
  lead_id: string;
  step_number: number;
  channel: string;
  content: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

function authorized(req: NextRequest, scopeRole: string | null): boolean {
  if (scopeRole === "admin") return true;
  if (!CRON_SECRET) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${CRON_SECRET}`;
}

function personalize(template: string, lead: any, seller: any): string {
  const first = lead?.primary_first_name ?? "there";
  const last = lead?.primary_last_name ?? "";
  const full = `${first} ${last}`.trim();
  const company = lead?.company_name ?? "";
  const sellerName = seller?.name ?? "";
  return (template ?? "")
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{last_name}}", last)
    .replaceAll("{{full_name}}", full)
    .replaceAll("{{company_name}}", company)
    .replaceAll("{{company}}", company)
    .replaceAll("{{seller_name}}", sellerName);
}

async function instantlyPost(path: string, body: any): Promise<any> {
  const res = await fetch(`${INSTANTLY_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INSTANTLY_KEY}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    const reason = parsed?.detail || parsed?.message || parsed?.error || text || `HTTP ${res.status}`;
    throw new Error(`Instantly POST ${path} → ${res.status}: ${reason}`);
  }
  return parsed;
}

function isRateLimitError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("rate limit") || r.includes("rate-limit") || r.includes("too many requests") || r.includes("429");
}

async function failMessage(svc: ReturnType<typeof getSupabaseService>, msgId: string, leadId: string, reason: string) {
  await svc.from("campaign_messages").update({
    status: "failed",
    error_details: reason,
    metadata: { dispatched_by: "cron-dispatch-email", failed_at: new Date().toISOString() },
  }).eq("id", msgId);
  return NextResponse.json({ ok: false, processed: 0, message_id: msgId, lead_id: leadId, error: reason }, { status: 200 });
}

async function requeueRateLimited(svc: ReturnType<typeof getSupabaseService>, msgId: string, leadId: string, reason: string) {
  const { data: existing } = await svc.from("campaign_messages").select("metadata").eq("id", msgId).maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  const prevCount = typeof prevMeta.rate_limit_count === "number" ? prevMeta.rate_limit_count : 0;
  await svc.from("campaign_messages").update({
    status: "queued",
    error_details: null,
    metadata: {
      ...prevMeta,
      dispatched_by: "cron-dispatch-email",
      last_rate_limit_at: new Date().toISOString(),
      last_rate_limit_reason: reason,
      rate_limit_count: prevCount + 1,
    },
  }).eq("id", msgId);
  return NextResponse.json({
    ok: false, processed: 0, requeued: true,
    message_id: msgId, lead_id: leadId, error: reason,
  }, { status: 200 });
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (!authorized(req, scope.role ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!INSTANTLY_KEY) {
    return NextResponse.json({ error: "INSTANTLY_API_KEY not configured" }, { status: 500 });
  }

  const svc = getSupabaseService();
  const RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  // 1. Pull window of candidates (channel=email, any step). Filter by
  //    eligibility: not in cooldown, eligible_at met, seller under cap.
  const { data: claimed } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, step_number, channel, content, status, metadata, campaigns(seller_id)")
    .eq("status", "queued")
    .eq("channel", "email")
    .order("created_at", { ascending: true })
    .limit(20);

  // Pre-compute daily counts + limits for the sellers in our window.
  const sellerIds = Array.from(new Set(
    (claimed ?? []).map((r: any) => r?.campaigns?.seller_id).filter(Boolean) as string[],
  ));

  const sentCounts: Record<string, number> = {};
  const dailyLimits: Record<string, number> = {};
  if (sellerIds.length > 0) {
    const since24h = new Date(nowMs - DAY_MS).toISOString();
    const [{ data: sentRows }, { data: sellerRows }] = await Promise.all([
      svc.from("campaign_messages")
        .select("id, campaigns!inner(seller_id)")
        .eq("status", "sent").eq("channel", "email")
        .gte("sent_at", since24h)
        .in("campaigns.seller_id", sellerIds),
      svc.from("sellers").select("id, email_daily_limit").in("id", sellerIds),
    ]);
    for (const row of sentRows ?? []) {
      const sid = (row as any)?.campaigns?.seller_id;
      if (sid) sentCounts[sid] = (sentCounts[sid] ?? 0) + 1;
    }
    for (const s of sellerRows ?? []) {
      dailyLimits[(s as any).id] = (s as any).email_daily_limit ?? 40;
    }
  }

  let blockedByLimit: string[] = [];
  const candidate = (claimed ?? []).find((r: any) => {
    const eligibleAt = r?.metadata?.eligible_at;
    if (eligibleAt && new Date(eligibleAt).getTime() > nowMs) return false;
    const lastRL = r?.metadata?.last_rate_limit_at;
    if (lastRL && nowMs - new Date(lastRL).getTime() <= RATE_LIMIT_COOLDOWN_MS) return false;
    const sid = r?.campaigns?.seller_id;
    if (!sid) return true;
    const sent = sentCounts[sid] ?? 0;
    const cap = dailyLimits[sid] ?? 40;
    if (sent >= cap) {
      if (!blockedByLimit.includes(sid)) blockedByLimit.push(sid);
      return false;
    }
    return true;
  }) as QueuedEmail | undefined;

  if (!candidate) {
    const totalQueued = claimed?.length ?? 0;
    let reason: string;
    if (totalQueued === 0) reason = "no queued emails";
    else if (blockedByLimit.length > 0) reason = `daily_limit_reached for sellers: ${blockedByLimit.join(",")}`;
    else reason = "all queued rows in cooldown or future-scheduled";
    return NextResponse.json({ ok: true, processed: 0, reason, blocked_sellers: blockedByLimit });
  }

  // 2. Atomic claim
  const { data: lockedRows, error: lockErr } = await svc
    .from("campaign_messages")
    .update({ status: "dispatching" })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select("id");
  if (lockErr || !lockedRows || lockedRows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, reason: "lost race", id: candidate.id });
  }

  // 3. Hydrate lead + seller + campaign
  const [{ data: lead }, { data: campaign }] = await Promise.all([
    svc.from("leads").select("id, primary_first_name, primary_last_name, primary_work_email, company_name").eq("id", candidate.lead_id).maybeSingle(),
    svc.from("campaigns").select("id, seller_id, sequence_steps").eq("id", candidate.campaign_id).maybeSingle(),
  ]);
  if (!lead || !campaign) return await failMessage(svc, candidate.id, candidate.lead_id, "lead or campaign missing");
  if (!lead.primary_work_email) return await failMessage(svc, candidate.id, candidate.lead_id, "lead has no work email");
  if (!campaign.seller_id) return await failMessage(svc, candidate.id, candidate.lead_id, "campaign has no seller_id");

  const { data: seller } = await svc
    .from("sellers")
    .select("id, name, instantly_email")
    .eq("id", campaign.seller_id)
    .maybeSingle();
  if (!seller || !seller.instantly_email) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "seller has no instantly_email configured");
  }

  // 4. Build subject + body. Subject can come from metadata (set by approve)
  //    or from lead/campaign defaults. Body is the message content with
  //    placeholders interpolated.
  const meta = (candidate.metadata as Record<string, unknown> | null) ?? {};
  const subjectRaw = (meta.subject as string | undefined) ?? `Quick idea for ${lead.company_name ?? "you"}`;
  const subject = personalize(subjectRaw, lead, seller).slice(0, 200);
  const body = personalize(candidate.content ?? "", lead, seller);
  if (!body.trim()) return await failMessage(svc, candidate.id, candidate.lead_id, "empty body after personalization");

  // 5. Send via Instantly v2 emails endpoint
  let providerMessageId: string | null = null;
  try {
    const resp = await instantlyPost("/emails", {
      from_address_email: seller.instantly_email,
      to_address_email_list: lead.primary_work_email,
      subject,
      body: { html: body.replace(/\n/g, "<br/>") },
    });
    providerMessageId = resp?.id ?? resp?.message_id ?? null;
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    if (isRateLimitError(errMsg)) {
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, errMsg);
    }
    return await failMessage(svc, candidate.id, candidate.lead_id, errMsg);
  }

  // 6. Mark sent + queue next step (if sequence has another)
  const now = new Date().toISOString();
  const sequenceSteps = (campaign as any)?.sequence_steps as Array<{ channel?: string; daysAfter?: number }> | null;
  const nextStepNumber = candidate.step_number + 1;
  const nextStepConfig = Array.isArray(sequenceSteps) ? sequenceSteps[candidate.step_number] : null;
  const nextDaysAfter = typeof nextStepConfig?.daysAfter === "number" ? nextStepConfig.daysAfter : null;
  const nextEligibleAt = nextDaysAfter !== null
    ? new Date(Date.now() + nextDaysAfter * DAY_MS).toISOString()
    : null;

  const updateOps: Array<Promise<unknown>> = [
    svc.from("campaign_messages").update({
      status: "sent",
      sent_at: now,
      provider_message_id: providerMessageId,
      error_details: null,
      metadata: { dispatched_by: "cron-dispatch-email", subject },
    }).eq("id", candidate.id),
    svc.from("campaigns").update({
      current_step: candidate.step_number,
      last_step_at: now,
      ...(nextEligibleAt === null ? { status: "completed" } : {}),
    }).eq("id", candidate.campaign_id),
  ];

  // Queue next step if sequence has more
  if (nextEligibleAt) {
    updateOps.push(
      svc.from("campaign_messages").update({
        status: "queued",
        metadata: { eligible_at: nextEligibleAt, queued_by: "cron-dispatch-email" },
      }).eq("campaign_id", candidate.campaign_id).eq("step_number", nextStepNumber).eq("status", "draft"),
    );
  }

  await Promise.all(updateOps);

  return NextResponse.json({
    ok: true,
    processed: 1,
    step: candidate.step_number,
    message_id: candidate.id,
    lead_id: lead.id,
    provider_message_id: providerMessageId,
    next_eligible_at: nextEligibleAt,
  });
}
