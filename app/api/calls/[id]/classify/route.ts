import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseServer } from "@/lib/supabase-server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

// 2026-06-01: aligned with the 4 outcomes the post-call popup exposes.
// `wrong_number` is the new fourth value — it also flips the lead's
// allow_call flag off and skips queued call-channel campaign messages,
// matching what /api/leads/[id]/call-outcome does.
const VALID = ["positive", "negative", "follow_up", "wrong_number", null] as const;
type Classification = typeof VALID[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: callId } = await params;
  const body = (await req.json()) as { classification: Classification; note?: string };
  const { classification, note } = body;

  if (!VALID.includes(classification)) {
    return NextResponse.json({ error: "Invalid classification" }, { status: 400 });
  }

  // 1. Get the call
  const callRes = await fetch(
    `${SB_URL}/rest/v1/calls?id=eq.${callId}&select=id,lead_id,started_at,transcript,classification&limit=1`,
    { headers }
  );
  const [call] = (await callRes.json().catch(() => [])) as Array<{
    id: string;
    lead_id: string | null;
    started_at: string | null;
    transcript: string | null;
    classification: string | null;
  }>;

  if (!call || !call.lead_id) {
    return NextResponse.json({ error: "Call or lead not found" }, { status: 404 });
  }

  // 2. Update call with classification (manual = ai_confidence 1)
  await fetch(`${SB_URL}/rest/v1/calls?id=eq.${callId}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      classification,
      ai_confidence: classification ? 1 : null,
      ai_summary: note ?? null,
    }),
  });

  // 2b. Persist the after-call note as a "Call note" in the lead's notes log
  //     so it shows up in the lead's Notes tab. Best-effort — never blocks the
  //     classify flow.
  if (note?.trim()) {
    try {
      const scope = await getUserScope();
      const sb = await getSupabaseServer();
      const { data: { user } } = await sb.auth.getUser();
      const m = (user?.user_metadata ?? {}) as Record<string, unknown>;
      const authorName = (m.full_name as string) ?? (m.display_name as string) ?? (m.name as string)
        ?? (user?.email as string | undefined)?.split("@")[0] ?? "Call note";
      await fetch(`${SB_URL}/rest/v1/lead_notes`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          lead_id: call.lead_id,
          content: note.trim(),
          created_by: scope.userId,
          author_name: authorName,
          note_type: "call",
        }),
      });
    } catch { /* best-effort */ }
  }

  // 3. wrong_number — disable the call channel on the lead + skip every
  //    queued/draft call message so the dispatcher unblocks the next
  //    non-call step. Mirrors /api/leads/[id]/call-outcome's wrong_number
  //    branch so the two entry points (per-call popup + per-call list
  //    button) converge on the same effect.
  if (classification === "wrong_number") {
    const now = new Date().toISOString();
    await fetch(`${SB_URL}/rest/v1/leads?id=eq.${call.lead_id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ allow_call: false, updated_at: now }),
    });
    // Skip queued/draft call messages for this lead.
    const callMsgsRes = await fetch(
      `${SB_URL}/rest/v1/campaign_messages?lead_id=eq.${call.lead_id}&channel=eq.call&status=in.(queued,draft)&select=id`,
      { headers }
    );
    const callMsgs = (await callMsgsRes.json().catch(() => [])) as Array<{ id: string }>;
    if (callMsgs.length > 0) {
      const idsCsv = callMsgs.map(m => m.id).join(",");
      await fetch(`${SB_URL}/rest/v1/campaign_messages?id=in.(${idsCsv})`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "skipped",
          error_details: "wrong_number — channel disabled for lead",
          metadata: { skipped_by: "call-classify-wrong-number", skipped_at: now },
        }),
      });
    }
    return NextResponse.json({ ok: true, action: "wrong_number" });
  }

  // 4. If classification is null (undo) or follow_up → don't touch campaign/lead
  if (!classification || classification === "follow_up") {
    return NextResponse.json({ ok: true, action: classification === "follow_up" ? "marked_follow_up" : "cleared" });
  }

  // 4. Positive/Negative → create lead_reply so Response Handler fires
  const replyText = note
    ? `[Call outcome] ${note}`
    : `[Call outcome] Lead marked as ${classification === "positive" ? "POSITIVE" : "NEGATIVE"} via phone call.`;

  const campRes = await fetch(
    `${SB_URL}/rest/v1/campaigns?lead_id=eq.${call.lead_id}&order=started_at.desc&limit=1&select=id`,
    { headers }
  );
  const camps = (await campRes.json().catch(() => [])) as Array<{ id: string }>;
  const campaignId = camps[0]?.id ?? null;

  const replyInsert = await fetch(`${SB_URL}/rest/v1/lead_replies`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      lead_id: call.lead_id,
      campaign_id: campaignId,
      channel: "call",
      reply_text: replyText,
      classification,
      ai_confidence: 1,
      requires_human_review: false,
      received_at: new Date().toISOString(),
    }),
  });

  if (!replyInsert.ok) {
    const err = await replyInsert.text();
    return NextResponse.json({ error: `Failed to create reply: ${err}` }, { status: 500 });
  }

  // 5. Pause / fail campaign
  if (campaignId) {
    const campaignPatch = classification === "positive"
      ? { status: "paused", paused_until: null, completed_at: new Date().toISOString() }
      : { status: "failed", completed_at: new Date().toISOString() };

    await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${campaignId}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(campaignPatch),
    });
  }

  // 6. Lead status
  const leadStatus = classification === "positive" ? "qualified" : "closed_lost";
  await fetch(`${SB_URL}/rest/v1/leads?id=eq.${call.lead_id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ status: leadStatus, updated_at: new Date().toISOString() }),
  });

  return NextResponse.json({ ok: true, classification, campaignId });
}
