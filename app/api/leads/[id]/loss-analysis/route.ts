import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  const { id } = await params;
  const svc = getSupabaseService();

  const { data: lead } = await svc
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, icp_profile_id")
    .eq("id", id)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const [{ data: campaigns }, { data: replies }, { data: calls }] = await Promise.all([
    svc.from("campaigns")
      .select("name, channel, current_step, sequence_steps, status, sellers(name)")
      .eq("lead_id", id),
    svc.from("lead_replies")
      .select("classification, channel, reply_text, received_at")
      .eq("lead_id", id)
      .order("received_at", { ascending: true }),
    svc.from("calls")
      .select("direction, status, duration, transcript, ai_summary, classification, started_at")
      .eq("lead_id", id)
      .order("started_at", { ascending: true }),
  ]);

  const analysis = await generate({ lead, campaigns: campaigns ?? [], replies: replies ?? [], calls: calls ?? [], apiKey });
  if (!analysis) return NextResponse.json({ error: "AI call failed" }, { status: 500 });

  await svc.from("leads")
    .update({ ai_loss_analysis: analysis, ai_loss_analysis_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, analysis });
}

async function generate({ lead, campaigns, replies, calls, apiKey }: any) {
  const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
  const negReply = replies.find((r: any) => r.classification === "negative");
  const stepsCompleted = campaigns.reduce((s: number, c: any) => s + (c.current_step ?? 0), 0);
  const totalSteps = campaigns.reduce((s: number, c: any) => s + (Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0), 0);
  const channels = [...new Set(campaigns.map((c: any) => c.channel))];
  const callTranscripts = calls
    .filter((c: any) => c.transcript || c.ai_summary)
    .map((c: any, i: number) => `Call ${i + 1} (${c.status}, ${c.direction}): ${c.ai_summary ?? c.transcript?.slice(0, 400)}`)
    .join("\n");

  const prompt = `You are a senior B2B sales strategist. A prospect has been marked as lost. Give a focused, actionable recovery plan.

PROSPECT
- ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}${lead.company_name ? ` at ${lead.company_name}` : ""}

OUTREACH HISTORY
- Campaigns: ${campaigns.length} · Steps completed: ${stepsCompleted}/${totalSteps} · Channels: ${channels.join(", ") || "—"}
- Replies received: ${replies.length}
${negReply ? `- Negative reply text: "${negReply.reply_text}"` : "- No reply received"}
${callTranscripts ? `\nCALLS\n${callTranscripts}` : ""}

TASK
Output STRICT JSON (no markdown, no code fences) with this exact shape:
{
  "verdict": "lost" | "dormant" | "recoverable",
  "confidence": 0-100,
  "why_lost": "1-2 sentences with the most likely root cause — be specific",
  "signals": ["2-4 concrete signals from the data that support the verdict"],
  "reengage_viability": "high" | "medium" | "low",
  "next_touchpoint": {
    "channel": "linkedin" | "email" | "call",
    "timing": "e.g. 'wait 30 days' or 'try now'",
    "angle": "what fresh angle or hook to use — be specific"
  },
  "message_template": "Ready-to-send message (2-4 sentences). Use {{first_name}} as placeholder. Match the channel chosen in next_touchpoint. No filler.",
  "watch_for": "1 sentence: what trigger event would make it worth trying again"
}`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    return JSON.parse(text);
  } catch {
    return null;
  }
}
