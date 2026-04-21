import { NextRequest, NextResponse } from "next/server";

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

async function findLeadIdByPhone(raw: string | null): Promise<string | null> {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const last10 = digits.slice(-10);
  const res = await fetch(
    `${SB_URL}/leads?primary_phone=ilike.*${last10}*&select=id&limit=1`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
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
