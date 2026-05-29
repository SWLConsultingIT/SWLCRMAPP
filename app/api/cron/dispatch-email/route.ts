import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { getInstantlyConfig } from "@/lib/instantly-config";
import { signStepAttachments } from "@/lib/campaign-attachments";

// Cron-driven dispatcher for `campaign_messages` rows in `status='queued'`
// where channel='email'. One mail per tick via Instantly v2.
//
// Architecture notes — IMPORTANT, read before editing.
//
// Instantly v2 is NOT a transactional provider. There is no "send this mail
// now" endpoint. The /emails/send route does not exist. The send model is:
//
//   1. Each tenant has a single Instantly campaign ("<Tenant>-CRM-Outbound")
//      wired to that tenant's inboxes. Its template is one step:
//        subject = {{subject_line}}
//        body    = {{personalization}}
//   2. To send, we POST a lead to /api/v2/leads with:
//        campaign        = company_bios.instantly_campaign_id
//        email           = lead.primary_work_email
//        personalization = the fully personalized body
//        custom_variables.subject_line = the personalized subject
//      Instantly enrolls the lead, dispatches via its inbox-rotation engine
//      (warmup / deliverability included), and the lead is "completed" once
//      the single-step template fires.
//   3. Replies are caught by the existing webhook (n8n EartyXv9hlVVFqvt) which
//      already updates lead_replies + halts the CRM campaign.
//
// What this means in practice:
//   - We don't pick a from-address — Instantly does. The tenant's pool of
//     inboxes is configured ON THE INSTANTLY CAMPAIGN, not here.
//   - There is no per-account daily-cap enforcement here — Instantly enforces
//     it on its side per inbox.
//   - For multi-email-step CRM campaigns (e.g. step 2 and step 4 both email),
//     the second email will need handling — Instantly rejects re-adding the
//     same email to the same campaign. We pass `skip_if_in_workspace: false`
//     to allow it but fall back to a clear error if rejected. Today's CRM
//     campaigns all have ≤ 1 email step so this is not yet a hot path.
//
// Auth: Vercel cron Bearer ${CRON_SECRET} OR admin role.

// API key is resolved per-tenant via getInstantlyConfig (company_bios.instantly_api_key
// with fallback to INSTANTLY_API_KEY env var). Tenants whose inboxes live in
// a separate Instantly account (e.g. Arqy on a different Hypergrowth plan)
// set their own key and the dispatcher routes accordingly.
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

async function instantlyFetch(apiKey: string, method: "POST" | "DELETE", path: string, body?: any): Promise<any> {
  // Instantly v2 rejects requests with `content-type: application/json` and no
  // body — DELETE /leads/:id was failing 400 "Body cannot be empty when
  // content-type is set to 'application/json'", which masked every step ≥ 2
  // email retry as a fatal "stale lead detected but delete failed". Only set
  // content-type when we actually have a body to send.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    accept: "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${INSTANTLY_BASE}${path}`, init);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    const reason = parsed?.detail || parsed?.message || parsed?.error || text || `HTTP ${res.status}`;
    throw new Error(`Instantly ${method} ${path} → ${res.status}: ${reason}`);
  }
  return parsed;
}

async function instantlyPost(apiKey: string, path: string, body: any): Promise<any> {
  return instantlyFetch(apiKey, "POST", path, body);
}

// Enroll a lead in an Instantly campaign with the personalized body.
//
// Instantly's POST /leads has a soft dedupe inside the campaign: if the same
// email is already enrolled, it returns the EXISTING lead's record (200 OK)
// without updating personalization. Detect this by comparing the returned
// `personalization` to the one we sent — if they don't match, the response is
// the stale enrollment. Resolution: DELETE the stale lead, then POST again.
//
// This handles two real cases:
//   1. Retries after a failed dispatch (lead was POSTed once, send failed,
//      we re-queue → next tick the lead still exists in Instantly).
//   2. Multi-step CRM campaigns where a later email step targets the same
//      lead in the same Instantly campaign — we want a fresh send with the
//      new step's body, not Instantly silently no-op'ing.
async function enrollLead(opts: {
  apiKey: string;
  campaignId: string;
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  body: string;
  subject: string;
}): Promise<{ leadId: string; recreated: boolean }> {
  const payload = {
    campaign: opts.campaignId,
    email: opts.email,
    first_name: opts.firstName,
    last_name: opts.lastName,
    company_name: opts.companyName,
    personalization: opts.body,
    custom_variables: { subject_line: opts.subject },
    skip_if_in_workspace: false,
    skip_if_in_campaign: false,
  };
  const first = await instantlyPost(opts.apiKey, "/leads", payload);
  const returnedBody = typeof first?.personalization === "string" ? first.personalization : "";
  const matches = returnedBody === opts.body;
  if (matches) {
    return { leadId: first?.id ?? "", recreated: false };
  }
  // Stale lead returned by dedupe — delete and re-post.
  if (first?.id) {
    try {
      await instantlyFetch(opts.apiKey, "DELETE", `/leads/${first.id}`);
    } catch (e: any) {
      // If the delete itself fails we still want to surface the original
      // problem clearly. The caller will see the duplicate and can retry.
      throw new Error(`stale lead detected (id=${first.id}) but delete failed: ${e?.message ?? e}`);
    }
  }
  const second = await instantlyPost(opts.apiKey, "/leads", payload);
  return { leadId: second?.id ?? "", recreated: true };
}

function isRateLimitError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("rate limit") || r.includes("rate-limit") || r.includes("too many requests") || r.includes("429");
}

function isDuplicateLeadError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("already exist") || r.includes("duplicate") || r.includes("already in campaign");
}

// Max emails to dispatch in a single cron tick. Unlike LinkedIn (1/tick to
// avoid burst detection on a real social account), Instantly manages its own
// send throttle — we just enroll leads and it picks the right inbox + timing.
// 20/tick @ 15 min intervals = up to 80/hour, well inside any Instantly plan.
const BATCH_SIZE = 20;

type EmailResult =
  | { kind: "sent"; msgId: string; leadId: string; instantlyCampaignId: string; providerLeadId: string | null; nextEligibleAt: string | null }
  | { kind: "failed"; msgId: string; leadId: string; reason: string }
  | { kind: "skipped"; msgId: string; leadId: string; reason: string }
  | { kind: "rate_limited"; msgId: string; leadId: string; reason: string }
  | { kind: "lost_race"; msgId: string; leadId: string };

async function failMessage(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
): Promise<EmailResult> {
  // Merge metadata — see dispatch-queue.failMessage for context.
  const { data: existing } = await svc
    .from("campaign_messages").select("metadata").eq("id", msgId).maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  await svc.from("campaign_messages").update({
    status: "failed",
    error_details: reason,
    metadata: {
      ...prevMeta,
      dispatched_by: "cron-dispatch-email",
      failed_at: new Date().toISOString(),
    },
  }).eq("id", msgId);
  return { kind: "failed", msgId, leadId, reason };
}

// Skip an email send without flagging it as a failure — used when the lead's
// address is known-bad up front (verified invalid, catch-all domain). The
// alternative was to fail the message, but that inflates the dispatcher's
// error count and triggers ops noise for an outcome we already expected.
// Bounce-after-send is a separate concern (still a TODO — when Instantly
// returns a bounce we should advance the step, not just keep retrying).
async function skipMessage(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
): Promise<EmailResult> {
  const { data: existing } = await svc
    .from("campaign_messages").select("metadata").eq("id", msgId).maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  await svc.from("campaign_messages").update({
    status: "skipped",
    error_details: reason,
    metadata: {
      ...prevMeta,
      dispatched_by: "cron-dispatch-email",
      skipped_at: new Date().toISOString(),
    },
  }).eq("id", msgId);
  return { kind: "skipped", msgId, leadId, reason };
}

async function requeueRateLimited(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
): Promise<EmailResult> {
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
  return { kind: "rate_limited", msgId, leadId, reason };
}

async function dispatchOneEmail(
  svc: ReturnType<typeof getSupabaseService>,
  candidate: QueuedEmail,
): Promise<EmailResult> {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Atomic claim.
  const { data: lockedRows, error: lockErr } = await svc
    .from("campaign_messages")
    .update({ status: "dispatching", dispatching_since: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select("id");
  if (lockErr || !lockedRows || lockedRows.length === 0) {
    return { kind: "lost_race", msgId: candidate.id, leadId: candidate.lead_id };
  }

  const [{ data: lead }, { data: campaign }] = await Promise.all([
    svc.from("leads").select("id, primary_first_name, primary_last_name, primary_work_email, primary_email_status, company_bio_id, company_name, primary_title_role").eq("id", candidate.lead_id).maybeSingle(),
    svc.from("campaigns").select("id, seller_id, sequence_steps").eq("id", candidate.campaign_id).maybeSingle(),
  ]);
  if (!lead || !campaign) return await failMessage(svc, candidate.id, candidate.lead_id, "lead or campaign missing");
  if (!lead.primary_work_email) return await failMessage(svc, candidate.id, candidate.lead_id, "lead has no work email");

  // Pre-send hygiene: skip leads whose work email is known-bad. Set by the
  // Instantly /email-verification pass (or any future verifier we wire up).
  // 'invalid' = mailbox definitely doesn't exist. 'catch_all' = the domain
  // accepts everything in SMTP handshake but the inner mailbox usually
  // bounces silently — burning these against the inbox warmup is what put
  // Arqy's campaign into Instantly status -2 on 2026-05-26.
  const emailStatus = (lead as any).primary_email_status as string | null;
  if (emailStatus === "invalid" || emailStatus === "catch_all") {
    return await skipMessage(svc, candidate.id, candidate.lead_id, `email status: ${emailStatus}`);
  }

  let seller: { id: string; name: string | null; company_bio_id: string | null } | null = null;
  if (campaign.seller_id) {
    const { data: s } = await svc.from("sellers").select("id, name, company_bio_id").eq("id", campaign.seller_id).maybeSingle();
    seller = (s as any) ?? null;
  }

  // Resolve tenant from lead first (handles shared-seller cross-tenant routing).
  const tenantBioId = (lead as any)?.company_bio_id ?? seller?.company_bio_id ?? null;
  if (!tenantBioId) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "campaign has no tenant — cannot resolve Instantly campaign");
  }
  const config = await getInstantlyConfig(tenantBioId);
  if (!config) {
    return await failMessage(svc, candidate.id, candidate.lead_id, `tenant ${tenantBioId} has no Instantly API key`);
  }
  const instantlyCampaignId = config.campaignId;
  if (!instantlyCampaignId) {
    const { data: bio } = await svc.from("company_bios").select("company_name").eq("id", tenantBioId).maybeSingle();
    return await failMessage(svc, candidate.id, candidate.lead_id, `tenant "${(bio as any)?.company_name ?? tenantBioId}" has no instantly_campaign_id set`);
  }

  const meta = (candidate.metadata as Record<string, unknown> | null) ?? {};
  const subjectRaw = (meta.subject as string | undefined) ?? `Quick idea for ${lead.company_name ?? "you"}`;
  const subject = personalize(subjectRaw, lead, seller).slice(0, 200);
  let body = personalize(candidate.content ?? "", lead, seller);
  if (!body.trim()) return await failMessage(svc, candidate.id, candidate.lead_id, "empty body after personalization");

  // Per-step attachments. Instantly v2 passthrough campaigns don't expose
  // per-lead attachments (attachments live on the campaign object, but we
  // share one Instantly campaign per tenant). The workable model is to
  // append signed download links to the body, which lets the recipient
  // grab the same PDF/flyer without us multiplying Instantly campaigns
  // per step. Signed URLs live 5 minutes — by then Instantly has handed
  // the message off to the inbox and the recipient will receive a relayed
  // link, not the raw signed URL.
  const sequenceStepsForAttach = (campaign as any)?.sequence_steps as Array<{ attachments?: unknown }> | null;
  const stepCfg = Array.isArray(sequenceStepsForAttach) ? sequenceStepsForAttach[candidate.step_number - 1] : null;
  let attachmentLinks: Array<{ name: string; signedUrl: string }> = [];
  try {
    attachmentLinks = await signStepAttachments(stepCfg?.attachments);
  } catch (e: any) {
    return await failMessage(svc, candidate.id, candidate.lead_id, `attachment sign failed: ${e?.message ?? e}`);
  }
  if (attachmentLinks.length > 0) {
    const list = attachmentLinks
      .map((a) => `• ${a.name}: ${a.signedUrl}`)
      .join("\n");
    body = `${body.trimEnd()}\n\n— Attachments —\n${list}`;
  }

  let providerLeadId: string | null = null;
  let recreated = false;
  try {
    const result = await enrollLead({
      apiKey: config.apiKey,
      campaignId: instantlyCampaignId,
      email: lead.primary_work_email,
      firstName: lead.primary_first_name ?? "",
      lastName: lead.primary_last_name ?? "",
      companyName: lead.company_name ?? "",
      body,
      subject,
    });
    providerLeadId = result.leadId;
    recreated = result.recreated;
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    if (isRateLimitError(errMsg)) return await requeueRateLimited(svc, candidate.id, candidate.lead_id, errMsg);
    if (isDuplicateLeadError(errMsg)) return await failMessage(svc, candidate.id, candidate.lead_id, `duplicate lead, could not replace: ${errMsg}`);
    return await failMessage(svc, candidate.id, candidate.lead_id, errMsg);
  }

  const now = new Date().toISOString();
  const sequenceSteps = (campaign as any)?.sequence_steps as Array<{ channel?: string; daysAfter?: number }> | null;
  const nextStepNumber = candidate.step_number + 1;
  const nextStepConfig = Array.isArray(sequenceSteps) ? sequenceSteps[candidate.step_number] : null;
  const nextDaysAfter = typeof nextStepConfig?.daysAfter === "number" ? nextStepConfig.daysAfter : null;
  const nextEligibleAt = nextDaysAfter !== null ? new Date(Date.now() + nextDaysAfter * DAY_MS).toISOString() : null;

  const updateOps: Array<PromiseLike<unknown>> = [
    svc.from("campaign_messages").update({
      status: "sent",
      sent_at: now,
      provider_message_id: providerLeadId,
      error_details: null,
      metadata: {
        dispatched_by: "cron-dispatch-email",
        subject,
        instantly_campaign_id: instantlyCampaignId,
        instantly_lead_id: providerLeadId,
        ...(recreated ? { instantly_lead_recreated: true } : {}),
      },
    }).eq("id", candidate.id),
    svc.from("campaigns").update({
      current_step: candidate.step_number,
      last_step_at: now,
      // See dispatch-queue/route.ts — mirror eligible_at onto the campaign so
      // the "Next step: ..." UI label has a date to render.
      next_step_due_at: nextEligibleAt,
      ...(nextEligibleAt === null ? { status: "completed" } : {}),
    }).eq("id", candidate.campaign_id),
  ];

  // Boss 2026-05-29: queue the next step regardless of channel. The
  // previous "skip queuing if next is LinkedIn" rule existed because
  // dispatch-queue would try to DM a lead that hadn't accepted yet and
  // fail every tick. That's no longer the case: dispatch-queue's
  // distance gate now calls parkAwaitingAcceptance, which parks the DM
  // (21d window) AND queues the step AFTER it. So queueing a LinkedIn
  // next step here is safe — it parks itself if the lead isn't
  // connected, and the non-LinkedIn track keeps moving via the
  // post-park queue advance.
  if (nextEligibleAt) {
    updateOps.push(
      svc.from("campaign_messages").update({
        status: "queued",
        metadata: { eligible_at: nextEligibleAt, queued_by: "cron-dispatch-email" },
      }).eq("campaign_id", candidate.campaign_id).eq("step_number", nextStepNumber).eq("status", "draft"),
    );
  }

  await Promise.all(updateOps);
  return { kind: "sent", msgId: candidate.id, leadId: lead.id, instantlyCampaignId, providerLeadId, nextEligibleAt };
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (!authorized(req, scope.role ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();
  const RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
  const nowMs = Date.now();

  // Pull a window larger than the batch so eligibility filtering leaves enough.
  // Order by metadata.eligible_at ASC — see dispatch-queue for context. The
  // created_at order would push later steps of older campaigns ahead of step
  // 0 from newer ones, starving the newer cohort. Bumped the limit too so
  // future-scheduled rows don't crowd out the eligible ones.
  const { data: claimed } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, step_number, channel, content, status, metadata, campaigns(seller_id)")
    .eq("status", "queued")
    .eq("channel", "email")
    .order("metadata->>eligible_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(BATCH_SIZE * 5, 100));

  const eligible = (claimed ?? []).filter((r: any) => {
    const eligibleAt = r?.metadata?.eligible_at;
    if (eligibleAt && new Date(eligibleAt).getTime() > nowMs) return false;
    const lastRL = r?.metadata?.last_rate_limit_at;
    if (lastRL && nowMs - new Date(lastRL).getTime() <= RATE_LIMIT_COOLDOWN_MS) return false;
    return true;
  }).slice(0, BATCH_SIZE) as QueuedEmail[];

  if (eligible.length === 0) {
    const totalQueued = claimed?.length ?? 0;
    return NextResponse.json({ ok: true, processed: 0, reason: totalQueued === 0 ? "no queued emails" : "all in cooldown or future-scheduled" });
  }

  // Dispatch all eligible in parallel — Instantly handles its own send throttle.
  const results = await Promise.all(eligible.map((c) => dispatchOneEmail(svc, c)));

  const sent = results.filter((r) => r.kind === "sent").length;
  const failed = results.filter((r) => r.kind === "failed").length;
  const skipped = results.filter((r) => r.kind === "skipped").length;
  const rateLimited = results.filter((r) => r.kind === "rate_limited").length;
  const lostRace = results.filter((r) => r.kind === "lost_race").length;

  return NextResponse.json({
    ok: true,
    processed: sent,
    attempted: eligible.length,
    failed,
    skipped,
    rate_limited: rateLimited,
    lost_race: lostRace,
    results: results.map((r) => ({ kind: r.kind, msgId: r.msgId, leadId: r.leadId })),
  });
}
