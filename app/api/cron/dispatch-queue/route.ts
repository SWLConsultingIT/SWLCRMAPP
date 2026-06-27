import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { mapLimit } from "@/lib/concurrency";
import { fetchStepAttachments } from "@/lib/campaign-attachments";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";
import { renderPlaceholders, findUnresolvedPlaceholders, findSuspiciousPlaceholders, isInvalidSellerName } from "@/lib/placeholders";

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

// Strip diacritics so Iñaki/Inaki, Víctor/Victor, Nogué/Nogue, Peña/Pena
// match. NFD decomposes "í" → "i" + U+0301; the regex drops every combining
// mark. Imported CSVs frequently lose accents while Unipile preserves them —
// without this normalization, every PE Spain Iberian name was a false-
// positive "name mismatch" failure (reliability board 2026-05-29).
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
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
  // Lowercase + strip accents on both sides so the comparison is purely
  // about the underlying letters. Accent presence/absence is presentation,
  // not identity.
  const ef = stripAccents(stripNameNoise(efRaw)).toLowerCase();
  const el = stripAccents(stripNameNoise(elRaw)).toLowerCase();
  const af = stripAccents(afRaw).toLowerCase();
  const al = stripAccents(alRaw).toLowerCase();
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

// renderPlaceholders + findUnresolvedPlaceholders live in lib/placeholders.ts
// as of 2026-05-31 so dispatch-queue (LinkedIn) and dispatch-email (Instantly)
// share one substitution table. Pre-extraction, dispatch-email had its own
// table that was missing the PE-Spain aliases (`fund_name`, camelCase, etc.)
// — that drift shipped a US PE follow-up with literal `{{fund_name}}` on
// 2026-05-31 to Daniel Robin. Single source of truth fixes both halves.
const personalizeNote = (template: string, lead: LeadRow, seller: SellerRow) =>
  renderPlaceholders(template, lead, seller);

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

function isTransientNetworkError(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes(" 504") || r.includes("→ 504")
    || r.includes(" 503") || r.includes("→ 503")
    || r.includes(" 502") || r.includes("→ 502")
    || r.includes("timeout") || r.includes("fetch failed")
    || r.includes("econnreset") || r.includes("etimedout")
    || r.includes("network error");
}

async function requeueTransient(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
): Promise<DispatchOutcome> {
  const { data: existing } = await svc
    .from("campaign_messages").select("metadata").eq("id", msgId).maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  const prevCount = typeof prevMeta.transient_error_count === "number" ? prevMeta.transient_error_count : 0;
  if (prevCount >= 3) {
    return await failMessage(svc, msgId, leadId, `transient error after ${prevCount} retries: ${reason}`);
  }
  await svc.from("campaign_messages").update({
    status: "queued",
    dispatching_since: null,
    error_details: null,
    metadata: {
      ...prevMeta,
      dispatched_by: "cron-dispatch-queue",
      last_transient_error_at: new Date().toISOString(),
      last_transient_error_reason: reason.slice(0, 400),
      transient_error_count: prevCount + 1,
    },
  }).eq("id", msgId);
  return { kind: "rate_limited", msgId, leadId, reason, cascadedCount: 0 };
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

// Skip a LinkedIn send without flagging it as a failure — used when the
// lead simply has no LinkedIn URL stored. That's a data-state issue, not
// a delivery failure, and clutters /admin/reliability if treated as one.
async function skipMessage(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
): Promise<DispatchOutcome> {
  const { data: existing } = await svc
    .from("campaign_messages").select("metadata").eq("id", msgId).maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  await svc.from("campaign_messages").update({
    status: "skipped",
    error_details: reason,
    metadata: {
      ...prevMeta,
      dispatched_by: "cron-dispatch-queue",
      skipped_at: new Date().toISOString(),
    },
  }).eq("id", msgId);
  return { kind: "skipped_invited", msgId, leadId };
}

// Like skipMessage but also advances current_step and queues the next step,
// so a data-state skip (no LinkedIn slug) doesn't FREEZE the flow. Mirrors
// dispatch-email.skipAndAdvance. Without this, a slug-less lead stalls forever
// at current_step with every later step stuck in `draft` — the same class of
// bug that froze ~150 Pathway campaigns (those were skipped on the email step
// before that path was fixed 2026-06-18; this closes the LinkedIn path too).
// Do NOT use for "campaign stopped / lead replied / terminal" skips.
async function skipAndAdvance(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
  candidate: QueuedRow,
  sequenceSteps: Array<{ daysAfter?: number }> | null | undefined,
): Promise<DispatchOutcome> {
  const result = await skipMessage(svc, msgId, leadId, reason);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nextStepNumber = candidate.step_number + 1;
  const nextStepConfig = Array.isArray(sequenceSteps) ? sequenceSteps[candidate.step_number] : null;
  const nextDaysAfter = typeof nextStepConfig?.daysAfter === "number" ? nextStepConfig.daysAfter : null;
  const nextEligibleAt = nextDaysAfter !== null ? new Date(Date.now() + nextDaysAfter * DAY_MS).toISOString() : null;
  await Promise.all([
    // current_step only ADVANCES (the `.lt` guard) — never drag the cursor back.
    svc.from("campaigns").update({ current_step: candidate.step_number })
      .eq("id", candidate.campaign_id).lt("current_step", candidate.step_number),
    ...(nextEligibleAt ? [
      svc.from("campaign_messages").update({
        status: "queued",
        metadata: { eligible_at: nextEligibleAt, queued_by: "cron-dispatch-queue-skip" },
      }).eq("campaign_id", candidate.campaign_id).eq("step_number", nextStepNumber).eq("status", "draft"),
    ] : []),
  ]);
  return result;
}

async function failMessage(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, reason: string,
): Promise<DispatchOutcome> {
  // Merge metadata instead of overwriting. Pre-2026-05-29 this clobbered
  // existing fields like eligible_at, awaiting_acceptance, parked_since,
  // and rate_limit_count — which then made re-queued rows (e.g., via the
  // admin retry endpoint) impossible to audit ("how did this get stuck?").
  const { data: existing } = await svc
    .from("campaign_messages").select("metadata").eq("id", msgId).maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  await svc.from("campaign_messages").update({
    status: "failed",
    error_details: reason,
    metadata: {
      ...prevMeta,
      dispatched_by: "cron-dispatch-queue",
      failed_at: new Date().toISOString(),
    },
  }).eq("id", msgId);
  return { kind: "failed", msgId, leadId, reason };
}

async function skipAlreadyConnected(
  svc: ReturnType<typeof getSupabaseService>,
  msgId: string, leadId: string, campaignId: string, stepNumber: number, reason: string,
): Promise<DispatchOutcome> {
  const now = new Date().toISOString();
  const eligibleAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: existing } = await svc
    .from("campaign_messages").select("metadata").eq("id", msgId).maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  await Promise.all([
    svc.from("campaign_messages").update({
      status: "skipped",
      sent_at: now,
      error_details: null,
      metadata: {
        ...prevMeta,
        dispatched_by: "cron-dispatch-queue",
        skipped_reason: reason,
        skipped_at: now,
      },
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
  const { data: existing } = await svc
    .from("campaign_messages").select("metadata").eq("id", msgId).maybeSingle();
  const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  await svc.from("campaign_messages").update({
    status: "skipped",
    sent_at: null,
    error_details: null,
    metadata: {
      ...prevMeta,
      dispatched_by: "cron-dispatch-queue",
      skipped_reason: reason,
      skipped_at: now,
      awaiting_acceptance: true,
    },
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
    dispatching_since: null,
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
  stepNumber: number,
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

  // CLASS-SCOPED CASCADE (2026-06-19). LinkedIn meters connection INVITES
  // (POST /users/invite, our step 0) and MESSAGES (POST /chats, our step ≥ 1)
  // under SEPARATE quotas. Before this fix the cascade froze every queued
  // LinkedIn row for the seller for 4h — so a 422 on a cold connection invite
  // also froze the First DM to a lead who had ALREADY ACCEPTED, leaving warm
  // conversations stuck for days (client complaint: accepted lead waited a full
  // week for step 2). Now we only cascade within the SAME class as the row that
  // hit the limit: an invite-limit pauses other invites (step 0); a messaging
  // limit pauses other DMs (step ≥ 1). The other class keeps flowing.
  const isInviteLimit = reason.includes("/users/invite") || stepNumber === 0;
  let cascadedCount = 0;
  if (sellerId) {
    let q = svc
      .from("campaign_messages")
      .select("id, metadata, campaigns!inner(seller_id)")
      .eq("status", "queued")
      .eq("channel", "linkedin")
      .eq("campaigns.seller_id", sellerId)
      .neq("id", msgId);
    // Scope by class: invites → step 0 only; messages → step ≥ 1 only.
    q = isInviteLimit ? q.eq("step_number", 0) : q.gte("step_number", 1);
    const { data: sellerQueued } = await q;
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
    svc.from("leads").select("id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, primary_linkedin_url, linkedin_internal_id, linkedin_connected, company_name, primary_title_role, responded, status")
      .eq("id", candidate.lead_id).maybeSingle(),
    svc.from("campaigns").select("id, seller_id, name, sequence_steps, status, stop_reason, metadata").eq("id", candidate.campaign_id).maybeSingle(),
  ]);
  if (!rawLead || !campaign) {
    return await failMessage(svc, candidate.id, candidate.lead_id, "lead or campaign missing");
  }

  // ── Stop-condition guard (2026-06-03) ──────────────────────────────────
  // NEVER send to a lead who already responded, or whose campaign is no longer
  // active. A queued step can outlive the reply that closed the campaign — the
  // reply handler marks the campaign completed but a step that was already
  // queued stays queued, and a later tick would send it (Diego @ Lanai got a
  // step-2 DM ~18h after replying positive). The dispatcher must re-check state
  // at send time, not trust that the queue was cleaned.
  const leadStatus = (rawLead as { status?: string | null }).status ?? "";
  const campaignActive = (campaign as { status?: string | null }).status === "active";
  // Fran 2026-06-03 (per seller): a lead who replied AT ALL stops the flow
  // COMPLETELY — no auto-resume. Once the lead engages, the seller takes over
  // manually; the sequence must never re-fire on its own. Any lead_replies row
  // = full stop.
  //
  // EXCEPTION — automatic re-engagement (the "SWL - CRM - Re-engagement Nudge"
  // workflow): after N business days of silence following our reply it sends a
  // nudge; after N more it re-opens the flow by setting campaign.metadata
  // { reengaged:true, reengaged_at }. When that flag is set, the OLD reply (the
  // one that originally stopped the flow) no longer blocks — only a reply
  // received AFTER reengaged_at counts as fresh engagement and re-stops it.
  // closed_lost / closed_won / qualified stay hard-terminal regardless.
  const campMeta = ((campaign as { metadata?: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>;
  const reengaged = campMeta.reengaged === true;
  const reengagedAt = typeof campMeta.reengaged_at === "string" ? (campMeta.reengaged_at as string) : null;
  const hardTerminal = ["qualified", "closed_won", "closed_lost"].includes(leadStatus);
  const respondedTerminal = !reengaged
    && ((rawLead as { responded?: boolean | null }).responded === true || leadStatus === "responded");
  const leadTerminal = hardTerminal || respondedTerminal;
  let replyQuery = svc.from("lead_replies").select("id, classification").eq("lead_id", candidate.lead_id);
  if (reengaged && reengagedAt) replyQuery = replyQuery.gt("received_at", reengagedAt);
  const { data: anyReply } = await replyQuery;
  // A polite reply to the Connection Request before any DM ("gracias por
  // conectar / un gusto / lindo día") is NOT real engagement and must NOT stop
  // the sequence — the flow keeps going to the First DM (Fran 2026-06-03). The
  // LinkedIn handler tags these 'connection_greeting'. Any OTHER reply blocks.
  const NON_BLOCKING_REPLY = new Set(["connection_greeting"]);
  const hasReplied = Array.isArray(anyReply)
    && anyReply.some(r => !NON_BLOCKING_REPLY.has(((r as { classification?: string | null }).classification) ?? ""));
  if (!campaignActive || leadTerminal || hasReplied) {
    return await skipMessage(
      svc, candidate.id, candidate.lead_id,
      `stopped — campaign ${(campaign as { status?: string | null }).status}${leadTerminal ? " / lead terminal" : hasReplied ? " / lead replied (flow stopped)" : ""}`,
    );
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
    // Data-state, not a delivery failure. Skip without flagging as failed
    // (would otherwise show up in /admin/reliability as ops noise) — but
    // ADVANCE so the next step (email / call) still runs. A bare skip here
    // froze the flow at current_step forever (see skipAndAdvance above).
    return await skipAndAdvance(
      svc, candidate.id, candidate.lead_id, "no LinkedIn slug on lead",
      candidate, (campaign as any)?.sequence_steps ?? null,
    );
  }

  let providerId = lead.linkedin_internal_id ?? null;
  let networkDistance: string | null = null;
  let invitationStatus: string | null = null;

  try {
    // Always fetch the user — networkDistance is needed by the step ≥ 1
    // parking gate below. The previous "skip fetch when providerId is
    // cached" optimization left networkDistance at null for every step
    // 1+ DM, which made the gate park every message regardless of the
    // lead's actual connection state. The fetch also re-verifies identity
    // before each send.
    const needsFetch = true;
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
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, seller.id, errMsg, candidate.step_number);
    }
    if (isTransientNetworkError(errMsg)) {
      return await requeueTransient(svc, candidate.id, candidate.lead_id, errMsg);
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
  //
  // Fallback: Unipile's /users endpoint occasionally returns network_distance=null
  // even for genuine 1st-degree connections (transient bug). When that happens
  // but lead.linkedin_connected is true — set by step 0's "already-connected"
  // skip or by the accept webhook — trust the persisted flag and send anyway
  // rather than parking a perfectly deliverable DM for 21 days.
  const distanceOk = networkDistance === "FIRST_DEGREE" || networkDistance === "DISTANCE_1";
  const linkedinConnected = (lead as any).linkedin_connected === true;
  if (candidate.step_number >= 1 && !distanceOk && !linkedinConnected) {
    return await parkAwaitingAcceptance(
      svc, candidate.id, candidate.lead_id, candidate.campaign_id, candidate.step_number,
      (campaign as any)?.sequence_steps ?? null,
      networkDistance,
    );
  }

  const rawTemplate = candidate.content ?? "";

  // First, refuse-on-foreign-syntax — `[First Name]`, `{First Name}`,
  // `<<First Name>>`, `%FIRST_NAME%`, `__first_name__`. These never get
  // substituted (the dispatcher only knows {{snake_case}}) so they would
  // ship raw if we didn't catch them here. 2026-05-31: a LinkedIn DM
  // shipped to Craig Wilson with literal `[First Name]` because nothing
  // upstream was scanning for foreign syntaxes — only {{…}} was checked.
  const suspicious = findSuspiciousPlaceholders(rawTemplate);
  if (suspicious.length > 0) {
    const tokens = suspicious.map(s => s.token).join(", ");
    return await failMessage(
      svc, candidate.id, candidate.lead_id,
      `Template contains foreign placeholder syntax (${tokens}) that the dispatcher cannot render. Open the flow and fix the template — use {{first_name}}, {{company_name}}, etc.`,
    );
  }

  if (isInvalidSellerName(seller.name)) {
    return await failMessage(
      svc, candidate.id, candidate.lead_id,
      `Seller name "${seller.name ?? ""}" looks like a system default — update sellers.name in Settings → Sellers before dispatching.`,
    );
  }

  const personalized = personalizeNote(rawTemplate, lead as LeadRow, seller).trim();

  // Belt-and-braces: if any `{{...}}` slipped through (typo, unknown alias,
  // new placeholder no one taught the dispatcher), we MUST refuse to send.
  // Mark the row failed with a clear error so it shows up in /queue or the
  // failures audit and the seller can fix the template before re-running.
  // Without this guard the 2026-05-27 PE Spain incident — 8 mails shipped
  // with raw `{{firstName}}` and `{{fund_name}}` — repeats every time a
  // template author types a placeholder we don't support.
  const leftover = findUnresolvedPlaceholders(personalized);
  if (leftover.length > 0) {
    return await failMessage(
      svc, candidate.id, candidate.lead_id,
      `Unsupported placeholders in template — refusing to send: ${leftover.join(", ")}. Update the wizard copy to use a supported placeholder (see lib/placeholders.ts).`,
    );
  }

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
      return await requeueRateLimited(svc, candidate.id, candidate.lead_id, seller.id, errMsg, candidate.step_number);
    }
    if (isTransientNetworkError(errMsg)) {
      return await requeueTransient(svc, candidate.id, candidate.lead_id, errMsg);
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
  // Always update lead+campaign after a successful CR/DM send:
  //   - Lead status flips to "contacted" once step 0 fires (parity with
  //     the previous behavior).
  //   - Campaign cursor advances so the next dispatcher tick sees this
  //     step as done and won't re-pick the same row.
  if (candidate.step_number === 0) {
    updateOps.push(
      svc.from("leads").update({ status: "contacted", current_channel: "linkedin" }).eq("id", lead.id),
    );
  }
  updateOps.push(
    svc.from("campaigns").update({
      last_step_at: now,
      // Mirror the eligible_at of the next queued step onto the campaign so
      // the UI ("Next step: ..." label in CampaignJourney + inbox stage) has
      // a date to render. Pre-2026-05-29 this column was always NULL across
      // every active campaign because nothing wrote it.
      next_step_due_at: nextEligibleAt,
      ...(nextEligibleAt === null ? { status: "completed" } : {}),
    }).eq("id", candidate.campaign_id),
  );
  // current_step only ADVANCES — never let a late lower-step send drag the
  // cursor backwards. A step-0 CR dispatched AFTER the step-1 email (multi-
  // channel flows that start with email but still carry a LinkedIn CR) used
  // to reset current_step 1→0, which froze the whole flow: skip-stale-calls
  // keys off current_step+1, so it looked for the call at step 1 (email) and
  // never advanced. Pathway had 342 campaigns frozen at current_step=0 with
  // step 1 already sent (2026-06-12). The `.lt` guard makes the write a no-op
  // when the cursor is already at/past this step.
  updateOps.push(
    svc.from("campaigns").update({ current_step: candidate.step_number })
      .eq("id", candidate.campaign_id).lt("current_step", candidate.step_number),
  );
  // Boss 2026-05-29: ALWAYS queue the next step, regardless of channel and
  // regardless of whether this was step 0 or a later step. The previous
  // "step 0 → step 1 is queued by the accept webhook" rule stalled every
  // flow whose lead never accepted (PE Spain: 100 CRs sent, 0 accepts,
  // 139 leads parked at current_step=0 with email step 1 in `draft`
  // forever). The new rule:
  //   - Queue the next step's draft → queued with eligible_at = now +
  //     daysAfter so it fires on schedule.
  //   - If the next step is a LinkedIn DM and the lead hasn't accepted,
  //     dispatch-queue's distance gate at line ~663 calls
  //     parkAwaitingAcceptance, which parks the DM (21d window) AND
  //     queues the step AFTER it. So the non-LinkedIn track keeps
  //     moving regardless of acceptance.
  if (nextEligibleAt) {
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

  // TWO-TIER PRIORITY FETCH (2026-06-19). A lead who already ACCEPTED our
  // connection request and is waiting for the First DM (LinkedIn step ≥ 1) is a
  // warm, time-sensitive conversation — every day it sits behind cold CRs
  // (step 0) is a reply we're losing. The seller's daily LinkedIn cap is the
  // scarce resource; it must go to warm leads first. (Fran 2026-06-19: client
  // got a step-2 DM a full week late because cold CRs ate the daily cap while
  // accepted leads waited.)
  //
  // Why TWO queries instead of one ordered fetch: with a single
  // `.order(step DESC).limit(100)` query, a seller with >100 warm DMs could
  // push the OLDEST step-1 DMs out of the window (higher steps sort first),
  // so the lead who accepted longest ago would wait behind newer deep-funnel
  // ones. Fetching the warm tier on its own, ordered by eligible_at ASC,
  // guarantees we always serve the oldest-waiting accepted lead first,
  // regardless of backlog size. Cold CRs are only fetched when NO warm DM is
  // eligible — so a warm backlog transparently pauses new CRs until it drains
  // (self-correcting: warm DMs are bounded by acceptances). This holds for
  // multichannel flows too: LinkedIn DMs always live at step ≥ 1 (step 0 is
  // always the CR), no matter how many email/call steps interleave.
  const nowMs = Date.now();
  const isEligible = (r: any): boolean => {
    const eligibleAt = r?.metadata?.eligible_at;
    if (eligibleAt && new Date(eligibleAt).getTime() > nowMs) return false;
    const lastRL = r?.metadata?.last_rate_limit_at;
    if (lastRL && nowMs - new Date(lastRL).getTime() <= RATE_LIMIT_COOLDOWN_MS) return false;
    return true;
  };
  const SELECT_COLS = "id, campaign_id, lead_id, step_number, channel, content, status, metadata, campaigns!inner(seller_id)";

  // Tier 1 — warm: post-acceptance DMs (step ≥ 1), oldest-eligible first.
  const { data: warmRows } = await svc
    .from("campaign_messages")
    .select(SELECT_COLS)
    .eq("status", "queued")
    .eq("channel", "linkedin")
    .eq("campaigns.seller_id", seller.id)
    .gte("step_number", 1)
    .order("metadata->>eligible_at", { ascending: true, nullsFirst: true })
    .limit(100);
  let eligible = (warmRows ?? []).filter(isEligible);
  let fetchedCount = warmRows?.length ?? 0;

  // Tier 2 — cold CRs (step 0), only when no warm DM is eligible this tick.
  if (eligible.length === 0) {
    const { data: coldRows } = await svc
      .from("campaign_messages")
      .select(SELECT_COLS)
      .eq("status", "queued")
      .eq("channel", "linkedin")
      .eq("campaigns.seller_id", seller.id)
      .eq("step_number", 0)
      .order("metadata->>eligible_at", { ascending: true, nullsFirst: true })
      .limit(100);
    eligible = (coldRows ?? []).filter(isEligible);
    fetchedCount += coldRows?.length ?? 0;
  }

  if (eligible.length === 0) {
    result.blockedReason = fetchedCount === 0 ? "no queued for seller" : "all in cooldown / future-scheduled";
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

  // 2. Pre-compute 24h INVITE counts per seller in one query.
  //    linkedin_daily_limit is a CONNECTION-REQUEST cap (that's what LinkedIn
  //    rate-limits), so we count ONLY step_number=0 (the invite), NOT the
  //    follow-up DMs (step 1+) which go to already-accepted 1st-degree
  //    connections and aren't invite-limited. Counting DMs here used to make
  //    the cap mean "invites + DMs", so the number set in /accounts never
  //    matched the invites actually sent (boss 2026-06-11: "no se respetan
  //    los topes"). Now the /accounts number == invites/day, exactly.
  const sellerIds = activeSellers.map((s) => s.id);
  const { data: sentRows } = await svc
    .from("campaign_messages")
    .select("id, campaigns!inner(seller_id)")
    .eq("status", "sent")
    .eq("channel", "linkedin")
    .eq("step_number", 0)
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
