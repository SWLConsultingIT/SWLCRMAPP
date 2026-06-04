import { NextRequest, NextResponse } from "next/server";
import { phoneSuffixMatch, ilikeDigitPattern } from "@/lib/phone-match";

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
).toString("base64");
const SB_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

type AircallCall = {
  id: number;
  direction: "inbound" | "outbound";
  status: string;
  started_at: number | null;
  answered_at: number | null;
  ended_at: number | null;
  duration: number | null;
  raw_digits: string | null;
  recording: string | null;
  asset: string | null;
  voicemail: string | null;
  missed_call_reason: string | null;
  transcription?: { content?: string } | null;
  comments?: { content?: string }[];
};

function tsToIso(v: number | null): string | null {
  return v == null ? null : new Date(v * 1000).toISOString();
}

function mapStatus(c: AircallCall): string {
  if (c.voicemail) return "voicemail";
  if (c.missed_call_reason) return "missed";
  if (c.duration && c.duration > 0 && c.answered_at) return "answered";
  if (c.ended_at && !c.answered_at) return "missed";
  return "initiated";
}

// Format-tolerant lead lookup. The old `ilike.*<last10>*` never matched a
// phone stored with spaces in its trailing group ("...37 32 47"), so every
// ES/IT-formatted number landed lead_id=null. Pull candidates with a
// per-digit wildcard pattern (survives any spacing) then finalize with a
// strict digit-suffix compare in JS.
async function findLeadIdByPhone(raw: string | null): Promise<string | null> {
  const pattern = ilikeDigitPattern(raw);
  if (!pattern) return null;
  const res = await fetch(
    `${SB_URL}/leads?or=(primary_phone.ilike.${pattern},primary_secondary_phone.ilike.${pattern})&select=id,primary_phone,primary_secondary_phone&limit=200`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const rows: Array<{ id: string; primary_phone: string | null; primary_secondary_phone: string | null }> = await res.json().catch(() => []);
  const match = Array.isArray(rows)
    ? rows.find(r => phoneSuffixMatch(r.primary_phone, raw) || phoneSuffixMatch(r.primary_secondary_phone, raw))
    : null;
  return match?.id ?? null;
}

// Reconcile against an existing dial-marker / dial row. /api/aircall/dial-marker
// (and the legacy /dial) insert an outbound row (status=initiated,
// aircall_call_id=null) the instant the seller clicks Call. When Aircall later
// reports the real call, we must REUSE that row — it already carries the
// seller_id and the lead_id. Without this the sync inserted a brand-new
// lead_id=null orphan, leaving the recording detached from the lead and the
// marker stuck "initiated" forever (boss flagged missing recordings 2026-06-04).
async function findMarkerId(raw: string | null): Promise<string | null> {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `${SB_URL}/calls?aircall_call_id=is.null&direction=eq.outbound&started_at=gte.${sinceIso}&select=id,phone_number&order=started_at.desc&limit=50`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const rows: Array<{ id: string; phone_number: string | null }> = await res.json().catch(() => []);
  const match = Array.isArray(rows) ? rows.find(r => phoneSuffixMatch(r.phone_number, raw)) : null;
  return match?.id ?? null;
}

export async function POST(req: NextRequest) {
  const { limit = 50 } = await req.json().catch(() => ({ limit: 50 }));

  const res = await fetch(`https://api.aircall.io/v1/calls?per_page=${limit}&order=desc`, {
    headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
  });
  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }
  const { calls = [] } = (await res.json()) as { calls: AircallCall[] };

  let updated = 0;
  let inserted = 0;

  for (const c of calls) {
    const status = mapStatus(c);
    const notes = (c.comments ?? []).map(x => x.content).filter(Boolean).join("\n\n") || null;
    const base = {
      status,
      direction: c.direction,
      duration: c.duration ?? null,
      started_at: tsToIso(c.started_at),
      ended_at: tsToIso(c.ended_at),
      recording_url: c.recording ?? c.asset ?? c.voicemail ?? null,
      transcript: c.transcription?.content ?? null,
      notes,
      phone_number: c.raw_digits,
    };

    const patchRes = await fetch(`${SB_URL}/calls?aircall_call_id=eq.${c.id}`, {
      method: "PATCH",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(base),
    });
    const rows = await patchRes.json().catch(() => []);

    if (Array.isArray(rows) && rows.length > 0) {
      updated += rows.length;
      continue;
    }

    // Reuse the dial-marker row for this call if one exists (keeps seller_id +
    // lead_id and prevents a duplicate orphan). Only adopt the marker's
    // lead_id; don't clobber it to null when the phone lookup misses.
    const markerId = c.direction === "outbound" ? await findMarkerId(c.raw_digits) : null;
    if (markerId) {
      await fetch(`${SB_URL}/calls?id=eq.${markerId}`, {
        method: "PATCH",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ aircall_call_id: c.id, ...base }),
      });
      updated++;
      continue;
    }

    const leadId = await findLeadIdByPhone(c.raw_digits);
    await fetch(`${SB_URL}/calls`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ aircall_call_id: c.id, lead_id: leadId, ...base }),
    });
    inserted++;
  }

  return NextResponse.json({ ok: true, fetched: calls.length, updated, inserted });
}
