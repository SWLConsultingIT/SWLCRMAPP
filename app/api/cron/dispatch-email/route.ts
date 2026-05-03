import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

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

async function instantlyFetch(method: "POST" | "DELETE", path: string, body?: any): Promise<any> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${INSTANTLY_KEY}`,
      accept: "application/json",
      "content-type": "application/json",
    },
  };
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

async function instantlyPost(path: string, body: any): Promise<any> {
  return instantlyFetch("POST", path, body);
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
  const first = await instantlyPost("/leads", payload);
  const returnedBody = typeof first?.personalization === "string" ? first.personalization : "";
  const matches = returnedBody === opts.body;
  if (matches) {
    return { leadId: first?.id ?? "", recreated: false };
  }
  // Stale lead returned by dedupe — delete and re-post.
  if (first?.id) {
    try {
      await instantlyFetch("DELETE", `/leads/${first.id}`);
    } catch (e: any) {
      // If the delete itself fails we still want to surface the original
      // problem clearly. The caller will see the duplicate and can retry.
      throw new Error(`stale lead detected (id=${first.id}) but delete failed: ${e?.message ?? e}`);
    }
  }
  const second = await instantlyPost("/leads", payload);
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

  // 1. Pull window of candidates (channel=email, any step).
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

  // 3. Hydrate lead + campaign + seller (for tenant resolution + personalization).
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

  // 4. Resolve the tenant's Instantly campaign UUID.
  const tenantBioId = seller?.company_bio_id ?? null;
  if (!tenantBioId) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "campaign has no tenant — cannot resolve Instantly campaign");
  }
  const { data: bio } = await svc
    .from("company_bios")
    .select("instantly_campaign_id, company_name")
    .eq("id", tenantBioId)
    .maybeSingle();
  const instantlyCampaignId = (bio as any)?.instantly_campaign_id as string | null | undefined;
  if (!instantlyCampaignId) {
    return await failMessage(
      svc,
      candidate.id,
      candidate.lead_id,
      `tenant "${(bio as any)?.company_name ?? tenantBioId}" has no instantly_campaign_id set — configure it in Settings`,
    );
  }

  // 5. Build subject + body.
  const meta = (candidate.metadata as Record<string, unknown> | null) ?? {};
  const subjectRaw = (meta.subject as string | undefined) ?? `Quick idea for ${lead.company_name ?? "you"}`;
  const subject = personalize(subjectRaw, lead, seller).slice(0, 200);
  const body = personalize(candidate.content ?? "", lead, seller);
  if (!body.trim()) return await failMessage(svc, candidate.id, candidate.lead_id, "empty body after personalization");

  // 6. Enroll the lead in the tenant's Instantly campaign. Instantly takes
  //    over from here — picks an inbox, applies warmup throttle, sends.
  //    `enrollLead` handles the dedupe-by-email gotcha (delete + re-post when
  //    an existing stale lead is returned).
  let providerLeadId: string | null = null;
  let recreated = false;
  try {
    const result = await enrollLead({
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
    if (isRateLimitError(errMsg)) {
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, errMsg);
    }
    if (isDuplicateLeadError(errMsg)) {
      return await failMessage(
        svc,
        candidate.id,
        candidate.lead_id,
        `lead already enrolled in Instantly campaign and could not be replaced: ${errMsg}`,
      );
    }
    return await failMessage(svc, candidate.id, candidate.lead_id, errMsg);
  }

  // 7. Mark sent + queue next step.
  //    NOTE: We mark "sent" at enroll time. Instantly may not send immediately
  //    (its inbox-rotation engine throttles based on the warmup curve), but
  //    from the CRM's perspective the email is committed to the provider.
  //    The reply webhook handles inbound and timing of delivery is opaque.
  const now = new Date().toISOString();
  const sequenceSteps = (campaign as any)?.sequence_steps as Array<{ channel?: string; daysAfter?: number }> | null;
  const nextStepNumber = candidate.step_number + 1;
  const nextStepConfig = Array.isArray(sequenceSteps) ? sequenceSteps[candidate.step_number] : null;
  const nextDaysAfter = typeof nextStepConfig?.daysAfter === "number" ? nextStepConfig.daysAfter : null;
  const nextEligibleAt = nextDaysAfter !== null
    ? new Date(Date.now() + nextDaysAfter * DAY_MS).toISOString()
    : null;

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
      ...(nextEligibleAt === null ? { status: "completed" } : {}),
    }).eq("id", candidate.campaign_id),
  ];

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
    instantly_campaign_id: instantlyCampaignId,
    instantly_lead_id: providerLeadId,
    next_eligible_at: nextEligibleAt,
  });
}
