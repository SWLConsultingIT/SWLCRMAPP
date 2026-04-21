import { NextRequest, NextResponse } from "next/server";

const SB_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

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
  const body = (await req.json()) as AircallEvent;
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

  if (Array.isArray(updated) && updated.length === 0 && call.direction === "inbound" && call.raw_digits) {
    const digits = call.raw_digits.replace(/[^\d+]/g, "");
    const last10 = digits.slice(-10);
    const lookup = await fetch(
      `${SB_URL}/leads?or=(primary_phone.ilike.*${last10},primary_phone.ilike.*${encodeURIComponent(last10)}*)&select=id&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const rows = await lookup.json().catch(() => []);
    const leadId = Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;

    await fetch(`${SB_URL}/calls`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
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
