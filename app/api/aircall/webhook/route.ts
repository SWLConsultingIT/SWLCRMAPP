import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

const SB_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const AIRCALL_WEBHOOK_SECRET = process.env.AIRCALL_WEBHOOK_SECRET ?? "";

/**
 * HMAC validation in LOG-ONLY mode. If AIRCALL_WEBHOOK_SECRET is unset we
 * skip silently (current behavior, pre-2026-05-14). If it's set we compute
 * the expected signature and warn on mismatch — but DO NOT reject the
 * request until we've confirmed via logs that legitimate Aircall traffic
 * carries the header. Once we see clean traffic, flip the early return
 * below from a `console.warn` to a 401 response.
 *
 * Aircall convention: header `X-Aircall-Signature` = hex HMAC-SHA256(body)
 * using the signing key from Aircall Dashboard → Integrations → Public API.
 */
function verifyAircallSignature(rawBody: string, presentedSignature: string | null): { valid: boolean; reason?: string } {
  if (!AIRCALL_WEBHOOK_SECRET) return { valid: true, reason: "no secret configured" };
  if (!presentedSignature) return { valid: false, reason: "missing X-Aircall-Signature header" };
  const expected = crypto.createHmac("sha256", AIRCALL_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(presentedSignature, "hex");
  if (a.length !== b.length) return { valid: false, reason: "length mismatch" };
  return { valid: crypto.timingSafeEqual(a, b), reason: undefined };
}

type AircallCall = {
  id: number;
  direction?: "inbound" | "outbound";
  status?: string;
  started_at?: number | string | null;
  answered_at?: number | string | null;
  ended_at?: number | string | null;
  duration?: number | null;
  raw_digits?: string | null;
  recording?: string | null;
  asset?: string | null;
  voicemail?: string | null;
  missed_call_reason?: string | null;
  transcription?: { content?: string } | null;
  comments?: { content?: string }[];
};

type AircallEvent = {
  event?: string;
  resource?: string;
  data?: AircallCall;
};

function tsToIso(v: number | string | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  const n = Number(v);
  if (!Number.isNaN(n) && String(n) === String(v)) return new Date(n * 1000).toISOString();
  return new Date(v).toISOString();
}

function mapStatus(ev: string | undefined, call: AircallCall): string {
  if (call.voicemail) return "voicemail";
  if (ev === "call.hungup" || ev === "call.ended") {
    if (call.duration && call.duration > 0 && call.answered_at) return "answered";
    if (!call.answered_at) return "missed";
    return "answered";
  }
  if (ev === "call.missed") return "missed";
  if (ev === "call.answered") return "answered";
  if (ev === "call.voicemail_left") return "voicemail";
  return call.status ?? "initiated";
}

export async function POST(req: NextRequest) {
  // Read raw body once so we can verify the HMAC and then parse it. Doing
  // `req.json()` first would consume the stream and leave us unable to
  // re-hash the original bytes.
  const rawBody = await req.text();
  const sigCheck = verifyAircallSignature(rawBody, req.headers.get("x-aircall-signature"));
  if (!sigCheck.valid) {
    // LOG-ONLY mode: log + keep processing so we don't break legitimate
    // Aircall traffic if their header format differs from our assumption.
    // Flip this to `return NextResponse.json({ error: "bad signature" },
    // { status: 401 })` once logs confirm 100% valid traffic.
    console.warn("[aircall-webhook] invalid signature (log-only mode):", sigCheck.reason);
  }

  let body: AircallEvent;
  try {
    body = JSON.parse(rawBody) as AircallEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const call = body.data;
  if (!call?.id) return NextResponse.json({ ignored: true });

  const status = mapStatus(body.event, call);
  const notes = (call.comments ?? []).map(c => c.content).filter(Boolean).join("\n\n") || null;

  const update: Record<string, unknown> = {
    status,
    direction: call.direction ?? undefined,
    duration: call.duration ?? null,
    started_at: tsToIso(call.started_at),
    ended_at: tsToIso(call.ended_at),
    recording_url: call.recording ?? call.asset ?? call.voicemail ?? null,
    transcript: call.transcription?.content ?? null,
    notes,
    phone_number: call.raw_digits ?? undefined,
  };
  Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);

  const patchRes = await fetch(`${SB_URL}/calls?aircall_call_id=eq.${call.id}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(update),
  });

  const updated = await patchRes.json().catch(() => []);

  // Kick off Whisper transcription if a recording just arrived. Fire-and-forget
  // — the webhook should return 200 quickly so Aircall doesn't retry. The
  // transcribe endpoint is idempotent so duplicate triggers (e.g., from
  // call.ended + a later call.created update) are safe.
  const updatedRow = Array.isArray(updated) && updated[0] ? updated[0] : null;
  if (updatedRow?.id && update.recording_url && !updatedRow.transcript) {
    const origin = req.nextUrl.origin;
    fetch(`${origin}/api/aircall/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: updatedRow.id }),
    }).catch(() => { /* don't fail the webhook on transcription error */ });
  }

  // Outbound reconciliation: the /api/aircall/dial endpoint inserts a row
  // BEFORE Aircall returns (their POST /v1/users/{id}/calls returns 204 with
  // no body, so we never learn the aircall_call_id at dial time). When the
  // webhook later fires with the assigned id, the PATCH-by-aircall_call_id
  // misses, and unless we link the rows here we end up with duplicates:
  //   - "initiated" row from dial: has lead_id, aircall_call_id=null
  //   - whatever the sync cron inserts later: has aircall_call_id, no lead_id
  // The fix is to match the recent dial-created row by phone digits (last 10
  // because formatting differs — Aircall returns "+44115...", we may have
  // stored "+44 115 ..." with spaces from the lead's primary_phone). One-time
  // pass; if no match, fall through to the existing inbound-create branch.
  if (
    Array.isArray(updated) && updated.length === 0
    && call.direction === "outbound"
    && call.raw_digits
  ) {
    const sinceIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recentRes = await fetch(
      `${SB_URL}/calls?aircall_call_id=is.null&direction=eq.outbound&started_at=gte.${sinceIso}&select=id,phone_number&order=started_at.desc&limit=20`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const candidates = await recentRes.json().catch(() => []);
    const wantDigits = call.raw_digits.replace(/[^\d]/g, "").slice(-10);
    const match = Array.isArray(candidates)
      ? candidates.find((r: { phone_number?: string | null }) =>
          ((r.phone_number ?? "").replace(/[^\d]/g, "").slice(-10) === wantDigits)
        )
      : null;
    if (match?.id) {
      await fetch(`${SB_URL}/calls?id=eq.${match.id}`, {
        method: "PATCH",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ aircall_call_id: call.id, ...update }),
      });
      return NextResponse.json({ ok: true, status, linked: match.id });
    }
  }

  if (Array.isArray(updated) && updated.length === 0 && call.direction === "inbound" && call.raw_digits) {
    const digits = call.raw_digits.replace(/[^\d+]/g, "");
    const last10 = digits.slice(-10);
    const lookup = await fetch(
      `${SB_URL}/leads?or=(primary_phone.ilike.*${last10},primary_phone.ilike.*${encodeURIComponent(last10)}*)&select=id&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const rows = await lookup.json().catch(() => []);
    const leadId = Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;

    // Upsert on aircall_call_id (UNIQUE partial index, migration 018) so a
    // retried Aircall webhook (normal behavior) doesn't create duplicate
    // rows. `resolution=merge-duplicates` makes PostgREST treat a UNIQUE
    // collision as an UPDATE on the conflicting row instead of 23505 error.
    await fetch(`${SB_URL}/calls?on_conflict=aircall_call_id`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        aircall_call_id: call.id,
        lead_id: leadId,
        direction: call.direction,
        status,
        phone_number: call.raw_digits,
        duration: call.duration ?? null,
        started_at: tsToIso(call.started_at),
        ended_at: tsToIso(call.ended_at),
        recording_url: call.recording ?? call.asset ?? call.voicemail ?? null,
        transcript: call.transcription?.content ?? null,
        notes,
      }),
    });
  }

  return NextResponse.json({ ok: true, status });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "aircall-webhook" });
}
