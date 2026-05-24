import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { mapLimit } from "@/lib/concurrency";
import { fetchStepAttachments } from "@/lib/campaign-attachments";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

// Hard cap on parallel seller batches in a single tick. Each seller's batch
// opens ~3 DB connections (list queued, hydrate lead+campaign, update on
// completion). At 60 direct conns on Micro, 5 workers × 3 = 15 conns is a
// comfortable share that leaves room for other API traffic and Realtime.
// If sellers ever grow >>5, we still process all of them in this tick — just
// pipelined through the 5 worker slots.
const MAX_PARALLEL_SELLERS = 5;

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
// Maximum messages to dispatch per seller per tick. Set to 1 because firing
// multiple invites within the same ~30s tick is the #1 detection trigger
// for LinkedIn — what matters is the inter-request spacing, not the daily
// total. With BATCH=1 and a 15-min tick, each seller sends at most 1 invite
// every 15 min (~96 opportunities/day, clipped by linkedin_daily_limit).
// Different sellers are decoupled (different Unipile accounts → different
// LinkedIn rate-limit pools), so they can each fire 1 per tick in parallel
// without burst-flagging any single account.
const BATCH_SIZE_PER_SELLER = 1;
// Hard floor on the spacing between consecutive successful invites/DMs from
// the SAME seller. Independent of BATCH_SIZE — if BATCH ever gets bumped or
// a manual reset claims many messages at once, this guard still prevents
// burst. We use the seller's most recent sent_at to enforce it.
const MIN_INTER_SEND_MS = 3 * 60 * 1000;

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

// Credentials people append to their LinkedIn display name (academic, legal,
// engineering, accounting, medical, honours). Stripped before name matching so
// "Hiral Shah ACA" still matches "Hiral Shah" on file. Match is case-insensitive
// against tokens already lowercased.
const NAME_SUFFIX_TOKENS = new Set([
  // academic
  "bsc", "ba", "beng", "ma", "msc", "mba", "meng", "mphil", "phd", "dphil", "edd", "msci",
  // legal
  "llb", "llm", "jd", "barrister",
  // engineering
  "ceng", "ieng", "engtech", "miet", "mice", "mimeche", "mistructe", "fiet", "fice", "fimeche",
  // accounting/finance/insurance
  "aca", "fca", "acma", "fcma", "acca", "fcca", "cpa", "cfa", "cima", "fsidip", "afa", "acii", "fcii", "cipfa", "aat",
  // medical
  "md", "mbbs", "mbchb", "mrcp", "frcp", "mrcs", "frcs", "mrcgp", "bds", "rgn", "rmn",
  // honours / awards
  "hons", "obe", "mbe", "cbe", "dbe", "kbe", "kcmg", "gcmg", "qc", "kc",
  // hr / misc
  "chartered", "fchartered", "mcipd", "fcipd", "mipm", "fmaat",
]);

// Strip emoji, parenthesised content, and trailing credential tokens (FSIDip,
// LLB (Hons), ACA, MBE, 💚, etc) from a name so identity matching survives the
// vanity suffixes people add on LinkedIn.
function stripNameNoise(raw: string): string {
  // 1. Drop emoji + symbols + parens content + commas
  let s = raw
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[,;|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 2. Repeatedly strip credential tokens from the END
  const isSuffix = (tok: string) => {
    const t = tok.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (!t) return true; // pure punctuation token
    if (NAME_SUFFIX_TOKENS.has(t)) return true;
    // All-uppercase short token (2-6 chars, no digits) — almost always a credential
    if (/^[A-Z]{2,6}$/.test(tok) && tok === tok.toUpperCase()) return true;
    return false;
  };
  for (;;) {
    const parts = s.split(" ");
    if (parts.length <= 1) break;
    if (isSuffix(parts[parts.length - 1])) {
      parts.pop();
      s = parts.join(" ").trim();
    } else break;
  }
  // Strip trailing punctuation (e.g. "N." → "N")
  return s.replace(/[.]+$/, "");
}

function nameMatches(
  expectedFirst: string | null,
  expectedLast: string | null,
  apiFirst: string,
  apiLast: string,
  slug: string,
): boolean {
  const efRaw = (expectedFirst ?? "").trim();
  const elRaw = (expectedLast ?? "").trim();
  const afRaw = stripNameNoise(apiFirst);
  const alRaw = stripNameNoise(apiLast);
  const ef = stripNameNoise(efRaw).toLowerCase();
  const el = stripNameNoise(elRaw).toLowerCase();
  const af = afRaw.toLowerCase();
  const al = alRaw.toLowerCase();
  if (!ef || !el || !af || !al) return false;

  // Slug with a unique random suffix (7+ chars + digit) guarantees the URL points to
  // exactly one profile — identity is proven by the URL itself regardless of display name.
  const tail = slug.split("-").pop() ?? "";
  const slugUnique = tail.length >= 6 && /\d/.test(tail);

  // Last name matching — LinkedIn has 3 known presentation variants beyond exact match:
  //   1. Privacy abbreviation: "Riya P." → al="p" (3rd-degree connections hide full surname)
  //   2. Compound/prefixed: "de Boinville" contains expected word "boinville"
  //   3. Extended with credential: stripped "Poulton-Midani" ≠ stored "anaea" → rely on slugUnique
  const alWords = al.split(/[\s-]+/).filter(w => w.length >= 2);
  const elWords = el.split(/[\s-]+/).filter(w => w.length >= 2);
  const lastNameOk =
    al === el ||
    (al.length === 1 && el.startsWith(al)) ||                         // "P." → "Patel"
    alWords.some(w => w.length >= 3 && elWords.some(ew =>             // word-level overlap
      ew.length >= 3 && (w === ew || w.includes(ew) || ew.includes(w))));

  if (!lastNameOk && !slugUnique) return false;

  // First name: bidirectional 3-char prefix covers most variants (Jen↔Jennifer, Mike↔Michael).
  if (af.startsWith(ef.slice(0, 3)) || ef.startsWith(af.slice(0, 3))) return true;

  // First name diverges (James↔Jim) — only pass if slug guarantees identity.
  return slugUnique;
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

// Multipart POST for chat-message endpoints that carry file attachments.
// Unipile expects native multipart/form-data with one `attachments` field per
// file plus the text fields; the regular JSON POST helper above can't express
// that. Pulled into its own helper so the dispatcher stays readable and we
// don't end up with two different fetch-and-parse patterns drifting.
type UnipileFile = { name: string; mimeType: string; data: Buffer };
async function unipileMultipartPost(url: string, fields: Record<string, string>, files: { name: string; file: UnipileFile }[]): Promise<any> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const { name, file } of files) {
    // Blob is the cross-runtime way to attach binary data to a FormData entry
    // in modern fetch (Node 18+ / Edge / browser). We pass the original
    // filename so LinkedIn shows it to the recipient.
    fd.append(name, new Blob([file.data as unknown as ArrayBuffer], { type: file.mimeType }), file.name);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" },
    body: fd,
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
  | { kind: "parked_awaiting_acceptance"; msgId: string; leadId: string; nextEligibleAt: string }
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

// Park a LinkedIn DM (step ≥ 1) when the lead is not yet 1st-degree. Two
// effects:
//   1. The message stays `queued` but its eligible_at is pushed 21 days into
//      the future so the dispatcher stops retrying immediately. LinkedIn
//      invites auto-expire after ~21 days, so anything still parked at that
//      point is a genuine "no acceptance" and gets swept by an expiry cron.
//   2. The campaign cursor advances past this LinkedIn step so non-LinkedIn
//      steps (email, call) fire on their normal schedule. The unpark cron
//      (unpark-linkedin-on-accept) flips eligible_at to now() the moment
//      lead.linkedin_connected becomes true, so the dispatcher catches up
//      the parked DM out-of-order on the next tick.
async function parkAwaitingAcceptance(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, campaignId: string, stepNumber: number,
  sequenceSteps: Array<{ channel?: string; daysAfter?: number }> | null,
  networkDistance: string | null,
): Promise<DispatchOutcome> {
  const now = new Date().toISOString();
  // 21 days = LinkedIn's own invite expiration. Past this point the invite
  // is dead on LinkedIn's side and the parked DM is unreachable.
  const eligibleAt = new Date(Date.now() + 21 * 86400000).toISOString();

  // 1. Park the LinkedIn DM.
  await svc.from("campaign_messages").update({
    status: "queued",
    metadata: {
      dispatched_by: "cron-dispatch-queue",
      awaiting_acceptance: true,
      parked_since: now,
      eligible_at: eligibleAt,
      network_distance: networkDistance,
    },
  }).eq("id", msgId);

  // 2. Advance the campaign cursor and queue the next step so non-LinkedIn
  //    channels (email/call) keep firing. The next message is in `draft` →
  //    we flip it to `queued` with eligible_at = now() so the appropriate
  //    dispatcher picks it up immediately. If the next step IS also a
  //    LinkedIn DM, that's fine — the dispatch-queue will park it too on
  //    the next tick, and we'll keep advancing until we hit a non-LI step
  //    or the end of the sequence.
  const steps = Array.isArray(sequenceSteps) ? sequenceSteps : [];
  const nextIdx = stepNumber + 1;
  if (nextIdx <= steps.length) {
    await Promise.all([
      svc.from("campaigns").update({
        current_step: stepNumber,
        last_step_at: now,
      }).eq("id", campaignId).eq("current_step", stepNumber - 1),
      svc.from("campaign_messages").update({
        status: "queued",
        metadata: { eligible_at: now, queued_by: "cron-dispatch-queue:parked-linkedin-advance" },
      }).eq("campaign_id", campaignId).eq("step_number", nextIdx).eq("status", "draft"),
    ]);
  }
  return { kind: "parked_awaiting_acceptance", msgId, leadId, nextEligibleAt: eligibleAt };
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
    .update({ status: "dispatching", dispatching_since: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select("id");
  if (lockErr || !lockedRows || lockedRows.length === 0) {
    return { kind: "lost_race", msgId: candidate.id, leadId: candidate.lead_id };
  }

  // Hydrate the lead + campaign rows we need. source + encrypted_payload +
  // company_bio_id are pulled so client-uploaded leads (where the PII columns
  // sit inside encrypted_payload instead of the plain columns) can be
  // decrypted before we read primary_linkedin_url. Without this the
  // dispatcher fails every client-source lead with "no LinkedIn slug" even
  // though the slug exists — encrypted.
  const [{ data: rawLead }, { data: campaign }] = await Promise.all([
    svc.from("leads").select("id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, primary_linkedin_url, linkedin_internal_id, company_name, primary_title_role")
      .eq("id", candidate.lead_id).maybeSingle(),
    svc.from("campaigns").select("id, seller_id, name, sequence_steps").eq("id", candidate.campaign_id).maybeSingle(),
  ]);
  if (!rawLead || !campaign) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "lead or campaign missing");
  }

  // Decrypt PII columns for client-source leads. Keep the plain row when
  // decryption fails so the failure surfaces as the actual problem (bad
  // ciphertext / missing tenant key) instead of a misleading "no LinkedIn
  // slug" downstream. log + continue is acceptable here — failMessage will
  // run a few lines down with the real reason.
  let lead = rawLead as LeadRow & { source: string | null; encrypted_payload: unknown; company_bio_id: string | null };
  if (rawLead.source === "client" && rawLead.encrypted_payload && rawLead.company_bio_id) {
    try {
      const { key } = await resolveTenantKey(rawLead.company_bio_id);
      const blob = bufferFromSupabaseBytea(rawLead.encrypted_payload);
      const decrypted = decryptWithResolvedKey(blob, key);
      lead = { ...lead, ...decrypted } as typeof lead;
    } catch (err) {
      console.error("[dispatch-queue] decrypt failed for lead", rawLead.id, err);
    }
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
      if (!nameMatches(lead.primary_first_name, lead.primary_last_name, apiFirst, apiLast, slug)) {
        return await failMessage(
          svc, candidate.id, candidate.lead_id,
          `name mismatch — expected "${lead.primary_first_name} ${lead.primary_last_name}", Unipile returned "${apiFirst} ${apiLast}" for slug "${slug}"`,
        );
      }
      if (!providerId) {
        return await failMessage(svc, candidate.id, candidate.lead_id, "Unipile did not return a provider_id");
      }
      // Identity confirmed. If the lead's first_name differs from what LinkedIn shows
      // (e.g., CRM has "James" but profile is "Jim"), auto-correct so the outgoing
      // note addresses them by the name they actually use.
      const apiFirstTrim = apiFirst.trim();
      if (apiFirstTrim && apiFirstTrim.toLowerCase() !== (lead.primary_first_name ?? "").trim().toLowerCase()) {
        await svc.from("leads").update({ primary_first_name: apiFirstTrim }).eq("id", lead.id);
        lead.primary_first_name = apiFirstTrim;
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

  // Step ≥ 1 LinkedIn DM gate. Multi-channel campaigns (CR → email → call →
  // LI DM → email → …) reach the second LinkedIn step regardless of whether
  // the CR was accepted, because email/call advance the campaign on their
  // own schedule. Before 2026-05-24 we'd hit Unipile here, get a 422
  // "Recipient appears not to be first degree connection", and burn the
  // message. Now we PARK the DM (21d window) and advance non-LinkedIn steps
  // in parallel. If the lead accepts within 21d, the unpark cron makes the
  // DM eligible and we send it out-of-sequence — better than dropping it.
  if (candidate.step_number >= 1 &&
      networkDistance !== "FIRST_DEGREE" &&
      networkDistance !== "DISTANCE_1") {
    return await parkAwaitingAcceptance(
      svc, candidate.id, candidate.lead_id, candidate.campaign_id, candidate.step_number,
      (campaign as any)?.sequence_steps ?? null,
      networkDistance,
    );
  }

  const rawTemplate = candidate.content ?? "";
  const personalized = personalizeNote(rawTemplate, lead as LeadRow, seller).trim();

  // Per-step attachments. LinkedIn connection requests (step_number=0) can't
  // carry files — the invite note body is the only payload LinkedIn accepts,
  // so we silently drop attachments there (the wizard already warns the user).
  // For follow-up DMs (step_number ≥ 1) we re-upload each file to Unipile as
  // a real multipart attachment so it renders inline in LinkedIn just like
  // any other DM file — recipients see a paperclip + preview, not a text URL.
  const sequenceStepsForAttach = (campaign as any)?.sequence_steps as Array<{ attachments?: unknown }> | null;
  const stepCfg = Array.isArray(sequenceStepsForAttach) ? sequenceStepsForAttach[candidate.step_number - 1] : null;
  let dmAttachments: Array<{ name: string; mimeType: string; data: Buffer }> = [];
  if (candidate.step_number >= 1) {
    try {
      dmAttachments = await fetchStepAttachments(stepCfg?.attachments);
    } catch (e: any) {
      return await failMessage(svc, candidate.id, candidate.lead_id, `attachment fetch failed: ${e?.message ?? e}`);
    }
  }
  const outgoing = personalized;
  const truncated = false;
  if (candidate.step_number === 0 && outgoing.length > NOTE_MAX_LEN) {
    // Pre-2026-05-11: silent slice-and-ellipsis. Two problems with that:
    //   1. The lead receives a mid-sentence cut with an ellipsis — looks broken.
    //   2. Manual_override bodies that escaped the Sanitize Output validator
    //      in V7 Pro arrive here oversize and we used to ship them anyway.
    // Now: refuse to send, mark for human review, surface in /admin/reliability.
    // Templates regenerated by V7 Pro v2 cap at 195 chars projected, so this
    // path should only fire for legacy rows or manual_overrides with no critic.
    await failMessage(
      svc,
      candidate.id,
      candidate.lead_id,
      `manual_override_oversize: post-interpolation length ${outgoing.length} > ${NOTE_MAX_LEN}. Regenerate the connection request copy in the wizard (cap 195 chars template).`,
    );
    return {
      kind: "failed",
      msgId: candidate.id,
      leadId: candidate.lead_id,
      reason: `connection note ${outgoing.length} chars exceeds ${NOTE_MAX_LEN}`,
    };
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
      // When the step carries attachments we switch the upstream call to
      // multipart so Unipile uploads each file as a native LinkedIn DM
      // attachment. The JSON branch stays for the (more common) text-only
      // case so we don't pay the multipart serialization cost for every
      // step in the sequence.
      const hasFiles = dmAttachments.length > 0;
      if (prevChatId) {
        const msgResp = hasFiles
          ? await unipileMultipartPost(
              `${UNIPILE_BASE}/api/v1/chats/${encodeURIComponent(prevChatId)}/messages`,
              { text: outgoing },
              dmAttachments.map((f) => ({ name: "attachments", file: f })),
            )
          : await unipilePost(`${UNIPILE_BASE}/api/v1/chats/${encodeURIComponent(prevChatId)}/messages`, {
              text: outgoing,
            });
        chatId = prevChatId;
        providerMessageId = msgResp?.id ?? msgResp?.message_id ?? null;
      } else {
        const chatResp = hasFiles
          ? await unipileMultipartPost(
              `${UNIPILE_BASE}/api/v1/chats`,
              {
                account_id: seller.unipile_account_id,
                attendees_ids: providerId ?? "",
                text: outgoing,
              },
              dmAttachments.map((f) => ({ name: "attachments", file: f })),
            )
          : await unipilePost(`${UNIPILE_BASE}/api/v1/chats`, {
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
      // Merge with prior metadata so accept-flow markers (queued_by,
      // accepted_at, eligible_at) survive the dispatch. The webhook sets
      // those in metadata before we send; clobbering them here erases the
      // engagement signal that the Queue page relies on.
      metadata: {
        ...(candidate.metadata ?? {}),
        dispatched_by: "cron-dispatch-queue",
        truncated_note: truncated,
        rendered_content: outgoing,
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

  // Min-spacing guard: if this seller sent any LinkedIn message within the
  // last MIN_INTER_SEND_MS, skip this tick entirely. Defends against:
  //   - Future BATCH_SIZE_PER_SELLER bumps
  //   - Manual resets that flood the queue (e.g., reassigning 8 leads to
  //     a fresh seller — what happened today with Nathan)
  //   - Concurrent ticks racing on the same seller
  const sinceMinSpacing = new Date(Date.now() - MIN_INTER_SEND_MS).toISOString();
  const { data: recentSends } = await svc
    .from("campaign_messages")
    .select("id, sent_at, campaigns!inner(seller_id)")
    .eq("status", "sent")
    .eq("channel", "linkedin")
    .eq("campaigns.seller_id", seller.id)
    .gte("sent_at", sinceMinSpacing)
    .limit(1);
  if (recentSends && recentSends.length > 0) {
    const ageSec = Math.round((Date.now() - new Date((recentSends[0] as any).sent_at).getTime()) / 1000);
    result.blockedReason = `min-spacing guard: last send was ${ageSec}s ago (need ${MIN_INTER_SEND_MS / 1000}s)`;
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
  // already pauses the rest of this seller's queue for 4h). For batches
  // larger than 1 (currently never, but defensive), wait MIN_INTER_SEND_MS
  // between consecutive sends so they look human-paced.
  for (let i = 0; i < batch.length; i += 1) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, MIN_INTER_SEND_MS));
    }
    result.attempted += 1;
    const outcome = await dispatchOneMessage(svc, batch[i], seller);
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

  // 3. Process every seller's batch in parallel, but capped at
  //    MAX_PARALLEL_SELLERS so we don't fan out N DB conns when N gets
  //    large. Different tenants' sellers are still independent — one
  //    rate-limited account doesn't slow down anyone else, we just
  //    pipeline through worker slots instead of one big Promise.all.
  const sellerResults = await mapLimit(activeSellers, MAX_PARALLEL_SELLERS,
    (s) => processSellerBatch(svc, s, sentCounts[s.id] ?? 0),
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
