import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Cron-driven dispatcher for `campaign_messages` rows in `status='queued'`.
//
// Why this exists:
//   /api/campaigns/approve used to write rows in `status='draft'` and never
//   trigger anything — campaigns sat dormant in DB while the LinkedIn Send
//   Action workflow (deactivated 2026-04-30) silently flipped them to 'sent'
//   on every Orquestador tick without ever calling Unipile. Result: 8 ghost
//   "sent" rows for Pathway leads, none of which were on LinkedIn.
//
// This endpoint is the single source of truth for outgoing connection
// requests. It picks ONE queued step-0 message per tick, calls Unipile
// directly, and records the outcome. Throttle = "1 per cron minute" by
// design — LinkedIn flags accounts that send too many invites in a burst.
//
// Auth: Vercel cron passes `Authorization: Bearer ${CRON_SECRET}`. We also
// allow logged-in admins to invoke it manually for testing / dispatching
// from /admin/reliability.

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY!;
const CRON_SECRET = process.env.CRON_SECRET ?? "";

// LinkedIn caps invitation notes at 300 chars when sent via the API. We
// truncate gracefully rather than letting Unipile reject the call.
const NOTE_MAX_LEN = 300;

type QueuedRow = {
  id: string;
  campaign_id: string;
  lead_id: string;
  step_number: number;
  channel: string;
  content: string | null;
  status: string;
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

// Defensive name verification — guards against the bug where a username slug
// collides with a different LinkedIn user (e.g. resolving "fran" to a random
// public account). We require the API-returned first/last names to start with
// the lead's first/last names (case-insensitive, first 3 chars).
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

// Interpolate placeholders in a LinkedIn invite-note or DM. The AI message
// generator regularly emits any of: {{first_name}}, {{last_name}},
// {{full_name}}, {{company}}, {{company_name}}, {{role}}, {{title}},
// {{seller_name}}, {{seller_company}}. Until 2026-05-02 this only handled
// {{first_name}} and {{seller_name}} — Fran's test caught a literal
// "{{company}}" rendered in a sent DM. Mirror the email dispatcher's
// `personalize` so both channels treat placeholders consistently.
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

export async function POST(req: NextRequest) {
  return handle(req);
}

// Allow GET so Vercel cron and manual cURL both work without method confusion.
export async function GET(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (!authorized(req, scope.role ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();

  // 1. Atomically claim ONE queued LinkedIn message (any step): flip status to
  //    'dispatching' so concurrent ticks cannot pick the same row.
  //    We pull a window of 20 candidates and filter to find the first eligible:
  //      - NOT in rate-limit cooldown (4h since last_rate_limit_at)
  //      - metadata.eligible_at <= now (or null) — gates the post-acceptance
  //        wait (5 min for step 1) and the daysAfter waits between steps 2+
  //      - seller's 24h sent count < linkedin_daily_limit
  const { data: claimed } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, step_number, channel, content, status, metadata, campaigns(seller_id, sequence_steps)")
    .eq("status", "queued")
    .eq("channel", "linkedin")
    .order("created_at", { ascending: true })
    .limit(20);

  const RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  // Pre-compute daily sent counts and daily limits for the sellers in our window.
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
        .eq("status", "sent")
        .eq("channel", "linkedin")
        .gte("sent_at", since24h)
        .in("campaigns.seller_id", sellerIds),
      svc.from("sellers")
        .select("id, linkedin_daily_limit")
        .in("id", sellerIds),
    ]);
    for (const row of sentRows ?? []) {
      const sid = (row as any)?.campaigns?.seller_id;
      if (sid) sentCounts[sid] = (sentCounts[sid] ?? 0) + 1;
    }
    for (const s of sellerRows ?? []) {
      dailyLimits[(s as any).id] = (s as any).linkedin_daily_limit ?? 20;
    }
  }

  let blockedByLimit: string[] = [];
  const candidate = (claimed ?? []).find((r: any) => {
    // Eligibility window — step 1 has +5 min after accept, step 2+ has +daysAfter days.
    const eligibleAt = r?.metadata?.eligible_at;
    if (eligibleAt && new Date(eligibleAt).getTime() > nowMs) return false;
    // Cooldown filter (LinkedIn rate-limit)
    const lastRL = r?.metadata?.last_rate_limit_at;
    if (lastRL && nowMs - new Date(lastRL).getTime() <= RATE_LIMIT_COOLDOWN_MS) return false;
    // Daily limit filter
    const sid = r?.campaigns?.seller_id;
    if (!sid) return true; // missing seller_id is caught downstream as failure
    const sent = sentCounts[sid] ?? 0;
    const cap = dailyLimits[sid] ?? 20;
    if (sent >= cap) {
      if (!blockedByLimit.includes(sid)) blockedByLimit.push(sid);
      return false;
    }
    return true;
  }) as QueuedRow | undefined;

  if (!candidate) {
    const totalQueued = claimed?.length ?? 0;
    let reason: string;
    if (totalQueued === 0) reason = "no queued messages";
    else if (blockedByLimit.length > 0) reason = `daily_limit_reached for sellers: ${blockedByLimit.join(",")}`;
    else reason = "all queued rows in rate-limit cooldown";
    return NextResponse.json({ ok: true, processed: 0, reason, blocked_sellers: blockedByLimit });
  }

  // Optimistic concurrency: only proceed if our UPDATE actually flipped the row
  // from queued → dispatching. If another worker won the race, we get 0 rows.
  const { data: lockedRows, error: lockErr } = await svc
    .from("campaign_messages")
    .update({ status: "dispatching" })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select("id");

  if (lockErr || !lockedRows || lockedRows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, reason: "lost race", id: candidate.id });
  }

  // 2. Hydrate the lead + seller + campaign rows we need for the call.
  const [{ data: lead }, { data: campaign }] = await Promise.all([
    svc.from("leads").select("id, primary_first_name, primary_last_name, primary_linkedin_url, linkedin_internal_id, company_name, primary_title_role")
      .eq("id", candidate.lead_id).maybeSingle(),
    svc.from("campaigns").select("id, seller_id, name").eq("id", candidate.campaign_id).maybeSingle(),
  ]);

  if (!lead || !campaign) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "lead or campaign missing");
  }

  if (!campaign.seller_id) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "campaign has no seller_id");
  }

  const { data: seller } = await svc
    .from("sellers")
    .select("id, name, unipile_account_id, linkedin_status")
    .eq("id", campaign.seller_id)
    .maybeSingle();

  if (!seller || !seller.unipile_account_id) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "seller has no unipile_account_id");
  }
  if (seller.linkedin_status === "restricted") {
    return await failMessage(svc, candidate.id, candidate.lead_id, "seller LinkedIn is restricted");
  }

  // 3. Resolve provider_id. Use the cached one on the lead if present; otherwise
  //    look it up on Unipile and verify the returned name matches the lead's
  //    name. The verification step is what would have caught the "fran ↔
  //    Francisca Hernandez" bug from earlier today.
  const slug = extractLinkedinSlug(lead.primary_linkedin_url);
  if (!slug) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "no LinkedIn slug on lead");
  }

  let providerId = lead.linkedin_internal_id ?? null;
  // network_distance from Unipile. Real values seen in production:
  // FIRST_DEGREE / SECOND_DEGREE / THIRD_DEGREE / OUT_OF_NETWORK. The
  // n8n legacy code also accepted DISTANCE_1 (older Unipile schema) so we
  // keep both for backwards compat.
  let networkDistance: string | null = null;
  // Pending invitation tracker — Unipile returns
  //   invitation: { type: "SENT", status: "PENDING" }
  // when there's an unaccepted invite already outstanding from this account.
  // Catches the same condition as the 422 "already sent recently" error
  // but proactively, before we even attempt to send.
  let invitationStatus: string | null = null;

  try {
    // Step 0 ALWAYS re-fetches the user even if provider_id is cached, because
    // we need a fresh network_distance reading. Step 1+ can rely on the cached
    // provider_id (the connection state was already verified at step 0 / via
    // the acceptance webhook).
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
      // Cache provider_id so step 1+ can skip re-resolution. We don't cache
      // network_distance — it can change (lead accepts an invite from another
      // session, gets removed, etc.) and we re-fetch on every step 0.
      if (!lead.linkedin_internal_id) {
        await svc.from("leads").update({ linkedin_internal_id: providerId }).eq("id", lead.id);
      }
    }
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    if (isRateLimitError(errMsg)) {
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, errMsg);
    }
    return await failMessage(svc, candidate.id, candidate.lead_id, errMsg);
  }

  // Step 0 preflight branches — both avoid burning rate-limit budget on a
  // guaranteed 422 and surface the right state in the DB:
  //   1. Lead is already a 1st-degree connection → skip invite, queue step 1.
  //      Production Unipile returns "FIRST_DEGREE"; the legacy n8n code also
  //      accepted "DISTANCE_1" (older schema), so we match both.
  //   2. Lead has a pending SENT invitation already outstanding → mark
  //      step 0 skipped + leave step 1 in draft. The lead will eventually
  //      accept (or LinkedIn auto-expires the invite in ~3 weeks); when they
  //      accept, the Unipile users.relations webhook fires and n8n
  //      BESFOHaqTt2Ki0Vw promotes step 1 through the normal flow.
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

  // 4. Build the personalized message + (for step 0) truncate to LinkedIn's
  //    invite-note 300-char cap. Step 1+ DMs have no such cap (LinkedIn allows
  //    up to ~8000 chars for messages), so we don't truncate there.
  const rawTemplate = candidate.content ?? "";
  const personalized = personalizeNote(rawTemplate, lead as LeadRow, seller as SellerRow).trim();
  let outgoing = personalized;
  let truncated = false;
  if (candidate.step_number === 0 && outgoing.length > NOTE_MAX_LEN) {
    outgoing = outgoing.slice(0, NOTE_MAX_LEN - 1).trimEnd() + "…";
    truncated = true;
  }

  // 5. Send via Unipile. Step 0 = connection invite. Step 1+ = DM.
  let providerMessageId: string | null = null;
  let chatId: string | null = null;
  try {
    if (candidate.step_number === 0) {
      // Connection request with note.
      const inviteResp = await unipilePost(`${UNIPILE_BASE}/api/v1/users/invite`, {
        account_id: seller.unipile_account_id,
        provider_id: providerId,
        message: outgoing || undefined,
      });
      providerMessageId = inviteResp?.invitation_id ?? null;
    } else {
      // Step 1+ DM. For step 1 we always create a fresh chat. For step 2+
      // we reuse the chat_id stored in step 1's metadata so all follow-ups
      // land in the same LinkedIn thread (otherwise the lead sees N chats
      // from the same sender, looks robotic).
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
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, errMsg);
    }
    // Step 0 only — two distinct skip paths depending on the kind of 422:
    //   - already connected → connection effectively exists, queue step 1 now
    //   - already invited (pending) → wait for acceptance webhook, leave step 1 in draft
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

  // 6. Mark this step sent + queue the next step (if any) with eligible_at
  //    set to NOW + daysAfter days from sequence_steps.
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

  // Step 0 → mark lead contacted. Steps 1+ → also update last_step_at on campaign.
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

  // Queue the next step if there's another in the sequence. Step 0 → step 1 is
  // NOT queued here — it's queued by the Unipile accept webhook when the lead
  // accepts. Step 1 → step 2 → step 3 are auto-queued with daysAfter delay.
  if (candidate.step_number >= 1 && nextEligibleAt) {
    updateOps.push(
      svc.from("campaign_messages").update({
        status: "queued",
        metadata: { eligible_at: nextEligibleAt, queued_by: "cron-dispatch-queue" },
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
    chat_id: chatId,
    note_truncated: truncated,
    next_eligible_at: nextEligibleAt,
  });
}

async function failMessage(svc: ReturnType<typeof getSupabaseService>, msgId: string, leadId: string, reason: string) {
  await svc.from("campaign_messages").update({
    status: "failed",
    error_details: reason,
    metadata: { dispatched_by: "cron-dispatch-queue", failed_at: new Date().toISOString() },
  }).eq("id", msgId);
  return NextResponse.json({ ok: false, processed: 0, message_id: msgId, lead_id: leadId, error: reason }, { status: 200 });
}

// Detect Unipile/LinkedIn burst-protection errors. These are NOT permanent
// failures — the account isn't banned, just told to slow down. We treat
// them differently from real failures (name mismatch, missing slug, etc.)
// so the queue doesn't get burned during a temporary cooldown.
function isRateLimitError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("temporary provider limit")
    || r.includes("rate limit")
    || r.includes("rate-limit")
    || r.includes("too many requests")
    || r.includes("429");
}

// Lead is ALREADY a connection — DM via /chats will work. Safe to skip
// step 0 and immediately promote step 1.
function isAlreadyConnectedError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("already connected") || r.includes("already a contact");
}

// Lead has a PENDING invite (sent earlier, not yet accepted). They are
// NOT yet connected, so step 1 (DM) would fail because LinkedIn requires
// the connection before opening a chat. Skip step 0 but leave step 1 in
// draft — when the lead eventually accepts, the Unipile users.relations
// webhook fires and n8n BESFOHaqTt2Ki0Vw promotes step 1 through the
// normal acceptance flow.
function isAlreadyInvitedError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("already sent") || r.includes("invitation has already");
}

// Step 0 (connection request) hit a "already connected" / "already sent
// recently" error. Treat it as a successful skip:
//   - mark this row status='skipped' with the original reason in metadata
//   - flip lead.linkedin_connected = true (the connection effectively exists)
//   - promote step 1 (the first DM) from 'draft' to 'queued' with
//     eligible_at = NOW + 5 min, mirroring the post-acceptance flow
//   - bump campaign.current_step + last_step_at
// Net effect: the campaign continues straight into the DM phase instead of
// stalling on a permanent 'failed' that needs manual cleanup.
async function skipAlreadyConnected(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string,
  leadId: string,
  campaignId: string,
  stepNumber: number,
  reason: string,
) {
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
  return NextResponse.json({
    ok: true, processed: 1, skipped: true, reason: "already_connected",
    message_id: msgId, lead_id: leadId, next_step_eligible_at: eligibleAt,
  });
}

// Step 0 hit "already sent recently" — there's a pending invite from a
// previous session that hasn't been accepted. Mark step 0 skipped so the
// dispatcher stops retrying, but DO NOT promote step 1 and DO NOT flip
// linkedin_connected — they aren't connected yet. When the lead finally
// accepts the pending invite, Unipile's users.relations webhook fires
// and n8n BESFOHaqTt2Ki0Vw runs the normal acceptance flow which queues
// step 1 with eligible_at = NOW + 5 min.
async function markAlreadyInvited(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string,
  leadId: string,
  reason: string,
) {
  const now = new Date().toISOString();
  await svc.from("campaign_messages").update({
    status: "skipped",
    sent_at: null,
    error_details: null,
    metadata: { dispatched_by: "cron-dispatch-queue", skipped_reason: reason, skipped_at: now, awaiting_acceptance: true },
  }).eq("id", msgId);
  return NextResponse.json({
    ok: true, processed: 1, skipped: true, reason: "pending_invite_awaiting_acceptance",
    message_id: msgId, lead_id: leadId,
  });
}

// Revert a 'dispatching' row back to 'queued' and stamp metadata so future
// dispatch ticks (and the orquestador) skip this row for the cooldown window.
async function requeueRateLimited(svc: ReturnType<typeof getSupabaseService>, msgId: string, leadId: string, reason: string) {
  const { data: existing } = await svc
    .from("campaign_messages")
    .select("metadata")
    .eq("id", msgId)
    .maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  const prevCount = typeof prevMeta.rate_limit_count === "number" ? prevMeta.rate_limit_count : 0;
  await svc.from("campaign_messages").update({
    status: "queued",
    error_details: null,
    metadata: {
      ...prevMeta,
      dispatched_by: "cron-dispatch-queue",
      last_rate_limit_at: new Date().toISOString(),
      last_rate_limit_reason: reason,
      rate_limit_count: prevCount + 1,
    },
  }).eq("id", msgId);
  return NextResponse.json({
    ok: false, processed: 0, requeued: true,
    message_id: msgId, lead_id: leadId, error: reason,
    reason: "rate_limited — message returned to queue, will retry after cooldown",
  }, { status: 200 });
}
