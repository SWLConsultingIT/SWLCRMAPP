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
  const { data: claimed } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, step_number, channel, content, status")
    .eq("status", "queued")
    .eq("step_number", 0)
    .eq("channel", "linkedin")
    .order("created_at", { ascending: true })
    .limit(1);

  const candidate = (claimed ?? [])[0] as QueuedRow | undefined;
  if (!candidate) {
    return NextResponse.json({ ok: true, processed: 0, reason: "no queued messages" });
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
    return await failMessage(svc, candidate.id, candidate.lead_id, e?.message ?? String(e));
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
    return await failMessage(svc, candidate.id, candidate.lead_id, e?.message ?? String(e));
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
