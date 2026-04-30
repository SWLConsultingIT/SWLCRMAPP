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

function personalizeNote(template: string, lead: LeadRow, seller: SellerRow): string {
  const first = lead.primary_first_name ?? "there";
  const sellerName = seller.name ?? "";
  return template
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{seller_name}}", sellerName);
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

  // 1. Atomically claim ONE queued step-0 message: flip status to 'dispatching'
  //    so concurrent ticks (or admin manual triggers) cannot pick the same row.
  //    We pull a window of 10 candidates and filter to find the first eligible:
  //      - NOT in rate-limit cooldown (4h since last_rate_limit_at)
  //      - seller's 24h sent count < linkedin_daily_limit
  const { data: claimed } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, step_number, channel, content, status, metadata, campaigns(seller_id)")
    .eq("status", "queued")
    .eq("step_number", 0)
    .eq("channel", "linkedin")
    .order("created_at", { ascending: true })
    .limit(10);

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
    // Cooldown filter
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
    svc.from("leads").select("id, primary_first_name, primary_last_name, primary_linkedin_url, linkedin_internal_id")
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

  try {
    if (!providerId) {
      const userResp = await unipileGet(
        `${UNIPILE_BASE}/api/v1/users/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(seller.unipile_account_id)}`,
      );
      providerId = userResp?.provider_id ?? null;
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
      // Cache so the next step (the post-acceptance message) doesn't have to
      // re-resolve and re-verify.
      await svc.from("leads").update({ linkedin_internal_id: providerId }).eq("id", lead.id);
    }
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    if (isRateLimitError(errMsg)) {
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, errMsg);
    }
    return await failMessage(svc, candidate.id, candidate.lead_id, errMsg);
  }

  // 4. Build the personalized note + truncate to LinkedIn's API cap.
  const rawTemplate = candidate.content ?? "";
  let note = personalizeNote(rawTemplate, lead as LeadRow, seller as SellerRow).trim();
  let truncated = false;
  if (note.length > NOTE_MAX_LEN) {
    note = note.slice(0, NOTE_MAX_LEN - 1).trimEnd() + "…";
    truncated = true;
  }

  // 5. Send the actual invitation.
  let invitationId: string | null = null;
  try {
    const inviteResp = await unipilePost(`${UNIPILE_BASE}/api/v1/users/invite`, {
      account_id: seller.unipile_account_id,
      provider_id: providerId,
      message: note || undefined, // omit empty notes — LinkedIn-friendly
    });
    invitationId = inviteResp?.invitation_id ?? null;
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    // LinkedIn/Unipile burst protection: don't burn the message as failed —
    // revert to queued and timestamp the cooldown so the next tick skips it.
    if (isRateLimitError(errMsg)) {
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, errMsg);
    }
    return await failMessage(svc, candidate.id, candidate.lead_id, errMsg);
  }

  // 6. Mark success: message → sent, lead → contacted, persist invitation_id.
  const now = new Date().toISOString();
  await Promise.all([
    svc.from("campaign_messages").update({
      status: "sent",
      sent_at: now,
      provider_message_id: invitationId,
      error_details: null,
      metadata: { dispatched_by: "cron-dispatch-queue", truncated_note: truncated },
    }).eq("id", candidate.id),
    svc.from("leads").update({
      status: "contacted",
      current_channel: "linkedin",
    }).eq("id", lead.id),
  ]);

  return NextResponse.json({
    ok: true,
    processed: 1,
    message_id: candidate.id,
    lead_id: lead.id,
    invitation_id: invitationId,
    note_truncated: truncated,
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
