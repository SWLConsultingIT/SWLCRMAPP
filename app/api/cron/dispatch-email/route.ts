import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Cron-driven dispatcher for `campaign_messages` rows in `status='queued'`
// where channel='email'. Sends one email per tick via Instantly v2.
//
// Design mirrors /api/cron/dispatch-queue (LinkedIn) but adapted for email:
//   - No connection-request concept — every email is one-shot
//   - No provider_id lookup — Instantly addresses by email string
//   - `subject` lives in metadata.subject
//   - From-address comes from a SHARED Instantly account pool (not bound to
//     sellers). Step 0 picks the account with the lowest 24h usage that is
//     still under its daily_limit. Step 1+ reuses whatever address sent the
//     earlier step for the same campaign so the reply thread stays intact.
//     The chosen email is persisted in `campaign_messages.metadata.from_address`.
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
  const role = lead?.primary_title_role ?? "";
  const sellerName = seller?.name ?? "";
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

async function instantlyGet(path: string): Promise<any> {
  const res = await fetch(`${INSTANTLY_BASE}${path}`, {
    headers: { Authorization: `Bearer ${INSTANTLY_KEY}`, accept: "application/json" },
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    const reason = parsed?.detail || parsed?.message || parsed?.error || text || `HTTP ${res.status}`;
    throw new Error(`Instantly GET ${path} → ${res.status}: ${reason}`);
  }
  return parsed;
}

// Module-level cache for the Instantly account pool. Each tick can reuse the
// list for up to 60s — long enough to avoid burning the rate budget on every
// dispatch, short enough that newly-added or warmup-graduated accounts are
// picked up within a minute.
type PoolAccount = { email: string; daily_limit: number };
let poolCache: { accounts: PoolAccount[]; fetchedAt: number } | null = null;
const POOL_TTL_MS = 60_000;

async function getInstantlyPool(): Promise<PoolAccount[]> {
  if (poolCache && Date.now() - poolCache.fetchedAt < POOL_TTL_MS) {
    return poolCache.accounts;
  }
  // status=1 means active in Instantly v2. We additionally require the
  // warmup score to be at 100 so we never send from an account still warming.
  const accounts: PoolAccount[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const path = cursor
      ? `/accounts?limit=100&starting_after=${encodeURIComponent(cursor)}`
      : "/accounts?limit=100";
    const page: any = await instantlyGet(path);
    for (const a of page?.items ?? []) {
      if (a?.status !== 1) continue;
      if ((a?.stat_warmup_score ?? 0) < 100) continue;
      if (typeof a?.email !== "string") continue;
      accounts.push({ email: a.email, daily_limit: typeof a.daily_limit === "number" ? a.daily_limit : 30 });
    }
    cursor = page?.next_starting_after ?? null;
    if (!cursor) break;
  }
  poolCache = { accounts, fetchedAt: Date.now() };
  return accounts;
}

// Step 0: pick the pool account with the lowest 24h send count that's still
// under its daily_limit AND is in the tenant's email_accounts allowlist.
// Step >0: reuse whatever address sent the earliest already-sent step in
// the same campaign so the conversation stays in one thread and the reply
// mailbox is consistent.
//
// Tenant scoping: we share one Instantly org but each tenant only sends from
// the inboxes claimed in its company_bios.email_accounts. Without filtering
// here, a Pathway campaign could rotate to an SWL inbox and vice versa —
// cross-tenant leak in the from-address.
async function pickFromAddress(
  svc: ReturnType<typeof getSupabaseService>,
  campaignId: string,
  stepNumber: number,
  tenantBioId: string | null,
): Promise<{ email: string } | { error: string }> {
  if (stepNumber > 0) {
    const { data: priors } = await svc
      .from("campaign_messages")
      .select("metadata, sent_at")
      .eq("campaign_id", campaignId)
      .eq("channel", "email")
      .eq("status", "sent")
      .lt("step_number", stepNumber)
      .order("sent_at", { ascending: true })
      .limit(1);
    const fromPrior = (priors?.[0]?.metadata as any)?.from_address;
    if (typeof fromPrior === "string" && fromPrior.length > 0) {
      return { email: fromPrior };
    }
    // Fall through to pool-pick if no prior step found (defensive — shouldn't
    // happen for well-formed campaigns).
  }

  if (!tenantBioId) return { error: "campaign has no tenant — cannot resolve email pool" };

  // Resolve the tenant's email allowlist. An empty array means "no inboxes
  // claimed yet" — the tenant must claim some via /accounts before sending.
  const { data: bio } = await svc
    .from("company_bios")
    .select("email_accounts")
    .eq("id", tenantBioId)
    .maybeSingle();
  const tenantEmails = (((bio as any)?.email_accounts as string[] | null) ?? []).map(e => String(e).toLowerCase());
  if (tenantEmails.length === 0) {
    return { error: "tenant has no claimed Instantly inboxes (company_bios.email_accounts empty)" };
  }

  const fullPool = await getInstantlyPool();
  const pool = fullPool.filter(a => tenantEmails.includes(a.email.toLowerCase()));
  if (pool.length === 0) return { error: "no eligible Instantly accounts in pool for this tenant" };

  // Tally usage in last 24h by from_address. metadata is JSONB — we extract
  // the field server-side via PostgREST's `metadata->>from_address` syntax,
  // but the Supabase JS client doesn't accept that in `.select()` easily;
  // simpler to fetch the rows and tally client-side. The window is small
  // enough (~hundreds of rows max) that this is fine.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: sentRows } = await svc
    .from("campaign_messages")
    .select("metadata")
    .eq("channel", "email")
    .eq("status", "sent")
    .gte("sent_at", since24h);
  const usageBy: Record<string, number> = {};
  for (const r of sentRows ?? []) {
    const addr = (r as any)?.metadata?.from_address;
    if (typeof addr === "string") usageBy[addr] = (usageBy[addr] ?? 0) + 1;
  }

  // Sort: lowest used first, then alphabetical for deterministic tie-break.
  const ranked = pool
    .map(a => ({ ...a, used: usageBy[a.email] ?? 0 }))
    .filter(a => a.used < a.daily_limit)
    .sort((a, b) => (a.used - b.used) || a.email.localeCompare(b.email));

  if (ranked.length === 0) {
    return { error: `all ${pool.length} pool accounts at daily_limit` };
  }
  return { email: ranked[0].email };
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
  //    eligibility: not in cooldown, eligible_at met. Per-account daily caps
  //    are enforced later by pickFromAddress against the Instantly pool.
  const { data: claimed } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, step_number, channel, content, status, metadata, campaigns(seller_id)")
    .eq("status", "queued")
    .eq("channel", "email")
    .order("created_at", { ascending: true })
    .limit(20);

  const candidate = (claimed ?? []).find((r: any) => {
    const eligibleAt = r?.metadata?.eligible_at;
    if (eligibleAt && new Date(eligibleAt).getTime() > nowMs) return false;
    const lastRL = r?.metadata?.last_rate_limit_at;
    if (lastRL && nowMs - new Date(lastRL).getTime() <= RATE_LIMIT_COOLDOWN_MS) return false;
    return true;
  }) as QueuedEmail | undefined;

  if (!candidate) {
    const totalQueued = claimed?.length ?? 0;
    const reason = totalQueued === 0
      ? "no queued emails"
      : "all queued rows in cooldown or future-scheduled";
    return NextResponse.json({ ok: true, processed: 0, reason });
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

  // 3. Hydrate lead + campaign. Seller is loaded only for personalization
  //    (the from-address comes from the shared pool, not the seller).
  const [{ data: lead }, { data: campaign }] = await Promise.all([
    svc.from("leads").select("id, primary_first_name, primary_last_name, primary_work_email, company_name, primary_title_role").eq("id", candidate.lead_id).maybeSingle(),
    svc.from("campaigns").select("id, seller_id, sequence_steps").eq("id", candidate.campaign_id).maybeSingle(),
  ]);
  if (!lead || !campaign) return await failMessage(svc, candidate.id, candidate.lead_id, "lead or campaign missing");
  if (!lead.primary_work_email) return await failMessage(svc, candidate.id, candidate.lead_id, "lead has no work email");

  let seller: { id: string; name: string | null; company_bio_id: string | null } | null = null;
  if (campaign.seller_id) {
    const { data: s } = await svc.from("sellers").select("id, name, company_bio_id").eq("id", campaign.seller_id).maybeSingle();
    seller = (s as any) ?? null;
  }

  // 4. Pick the from-address. Step 0 → least-used pool account under cap,
  //    scoped to the tenant's email_accounts allowlist.
  //    Step >0 → reuse whatever sent the earlier step (keeps thread intact).
  const tenantBioId = seller?.company_bio_id ?? null;
  const picked = await pickFromAddress(svc, candidate.campaign_id, candidate.step_number, tenantBioId);
  if ("error" in picked) {
    // Pool exhausted is not a fatal error — requeue with cooldown so the
    // next tick (or tomorrow) can retry.
    return await requeueRateLimited(svc, candidate.id, candidate.lead_id, `pool: ${picked.error}`);
  }
  const fromAddress = picked.email;

  // 5. Build subject + body.
  const meta = (candidate.metadata as Record<string, unknown> | null) ?? {};
  const subjectRaw = (meta.subject as string | undefined) ?? `Quick idea for ${lead.company_name ?? "you"}`;
  const subject = personalize(subjectRaw, lead, seller).slice(0, 200);
  const body = personalize(candidate.content ?? "", lead, seller);
  if (!body.trim()) return await failMessage(svc, candidate.id, candidate.lead_id, "empty body after personalization");

  // 6. Send via Instantly v2 emails endpoint
  let providerMessageId: string | null = null;
  try {
    // Instantly v2 send endpoint is /emails/send — NOT /emails (which is the
    // listing endpoint and rejects POST with 404). Confirmed against the
    // reply handler workflow which has been using /emails/send correctly.
    const resp = await instantlyPost("/emails/send", {
      from_address_email: fromAddress,
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

  // 7. Mark sent + queue next step (if sequence has another)
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
      // from_address persisted so subsequent steps for this campaign reuse
      // the same mailbox (reply thread continuity) and the reply handler
      // can route inbound replies back to the dispatcher correctly.
      metadata: { dispatched_by: "cron-dispatch-email", subject, from_address: fromAddress },
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
    from_address: fromAddress,
    provider_message_id: providerMessageId,
    next_eligible_at: nextEligibleAt,
  });
}
