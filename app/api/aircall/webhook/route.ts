import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { phoneSuffixMatch, ilikeDigitPattern } from "@/lib/phone-match";

const SB_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const AIRCALL_WEBHOOK_SECRET = process.env.AIRCALL_WEBHOOK_SECRET ?? "";

/**
 * HMAC validation in ENFORCED mode (flipped 2026-05-29 from log-only).
 * If AIRCALL_WEBHOOK_SECRET is unset we still let the request through (so
 * environments that haven't configured the secret yet keep working) but log
 * loudly. If it's set we reject mismatches with 401 — anyone with the
 * webhook URL could otherwise forge `call.ended` / `call.answered` events.
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

// Phone matching (strip-to-digits + trailing overlap) lives in lib/phone-match
// so the webhook and the Aircall sync route stay in lockstep.

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
  if (!AIRCALL_WEBHOOK_SECRET) {
    // Secret not configured — let the request through but flag it loudly so
    // the channel doesn't silently stay open in production.
    console.warn("[aircall-webhook] AIRCALL_WEBHOOK_SECRET unset — signature check skipped");
  } else {
    const sigCheck = verifyAircallSignature(rawBody, req.headers.get("x-aircall-signature"));
    if (!sigCheck.valid) {
      console.warn("[aircall-webhook] rejected — invalid signature:", sigCheck.reason);
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
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

  // Archive the recording into our own Supabase Storage bucket. Aircall's
  // recording URLs are S3 presigned and expire (hours/days), so without
  // this archive step old calls stop playing in the UI. Fire-and-forget —
  // the /play endpoint also has a lazy-archive fallback in case this misses.
  if (updatedRow?.id && update.recording_url && !updatedRow.recording_storage_path) {
    import("@/lib/archive-call-recording")
      .then(m => m.archiveCallRecording(updatedRow.id as string))
      .catch(() => { /* don't fail webhook on archive error */ });
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
    const match = Array.isArray(candidates)
      ? candidates.find((r: { phone_number?: string | null }) =>
          phoneSuffixMatch(r.phone_number, call.raw_digits)
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

    // 2026-06-01: outbound from the Aircall Everywhere SDK (the embed
    // modal) goes through aircall.sdk.dial(), not our /api/aircall/dial
    // endpoint — so there's NO pre-existing initiated row to link.
    // Without this branch, the webhook would write nothing for embed
    // calls and the lead's Calls tab would stay empty even though
    // Aircall recorded everything. Caught 2026-06-01 — Fran made a
    // test call from the embed; 2 rows landed via the sync cron with
    // lead_id=null. Same last-10-digits match as the inbound branch:
    // raw_digits is what the seller dialed (the lead's number), and
    // we already store that in leads.primary_phone.
    if (call.raw_digits) {
      // Phone numbers in lead rows carry their original formatting
      // ("+54 9 11 3394 2012", "'+34 917 37 32 47"), so an ilike on a
      // contiguous digit run never matches — spaces in the trailing group
      // break the substring. ilikeDigitPattern places a wildcard between
      // every digit of the trailing suffix so any spacing survives; the
      // JS phoneSuffixMatch below finalizes strictly.
      const pattern = ilikeDigitPattern(call.raw_digits);
      const lookup = await fetch(
        `${SB_URL}/leads?or=(primary_phone.ilike.${pattern},primary_secondary_phone.ilike.${pattern})&select=id,primary_phone,primary_secondary_phone&limit=200`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      const rows: Array<{ id: string; primary_phone: string | null; primary_secondary_phone: string | null }> = await lookup.json().catch(() => []);
      // Suffix match (not exact last-10) so international format/country-code
      // variants link too — the digit-pattern ilike above is just the prefilter.
      const match = Array.isArray(rows) ? rows.find(r =>
        phoneSuffixMatch(r.primary_phone, call.raw_digits) || phoneSuffixMatch(r.primary_secondary_phone, call.raw_digits)
      ) : null;
      const leadId = match?.id ?? null;
      const insertRes = await fetch(`${SB_URL}/calls?on_conflict=aircall_call_id`, {
        method: "POST",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation,resolution=merge-duplicates",
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
      const insertedRows = await insertRes.json().catch(() => []);
      const inserted = Array.isArray(insertedRows) && insertedRows[0] ? insertedRows[0] : null;
      // Same transcribe + archive triggers as the inbound branch — the
      // recording URL is Aircall's S3 presign and expires within hours.
      if (inserted?.id && (call.recording || call.asset)) {
        const origin = req.nextUrl.origin;
        fetch(`${origin}/api/aircall/transcribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callId: inserted.id }),
        }).catch(() => {});
        import("@/lib/archive-call-recording")
          .then(m => m.archiveCallRecording(inserted.id as string))
          .catch(() => {});
      }
      return NextResponse.json({ ok: true, status, linkedLead: leadId, callId: inserted?.id ?? null });
    }
  }

  if (Array.isArray(updated) && updated.length === 0 && call.direction === "inbound" && call.raw_digits) {
    // Same space-tolerant prefilter as the outbound branch.
    const pattern = ilikeDigitPattern(call.raw_digits);
    const lookup = await fetch(
      `${SB_URL}/leads?or=(primary_phone.ilike.${pattern},primary_secondary_phone.ilike.${pattern})&select=id,primary_phone,primary_secondary_phone&limit=200`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const rowsList: Array<{ id: string; primary_phone: string | null; primary_secondary_phone: string | null }> = await lookup.json().catch(() => []);
    const inboundMatch = Array.isArray(rowsList) ? rowsList.find(r =>
      phoneSuffixMatch(r.primary_phone, call.raw_digits) || phoneSuffixMatch(r.primary_secondary_phone, call.raw_digits)
    ) : null;
    const leadId = inboundMatch?.id ?? null;

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
