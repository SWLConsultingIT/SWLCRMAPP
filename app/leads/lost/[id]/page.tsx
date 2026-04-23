import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { notFound } from "next/navigation";
import { C } from "@/lib/design";
import Link from "next/link";
import Anthropic from "@anthropic-ai/sdk";
import Breadcrumb from "@/components/Breadcrumb";
import LostLeadActions from "@/components/LostLeadActions";
import RegenerateLossAnalysis from "@/components/RegenerateLossAnalysis";
import CopyTemplateButton from "@/components/CopyTemplateButton";
import {
  ArrowLeft, Share2, Mail, Phone, Star, Send,
  MessageSquare, XCircle, AlertTriangle, Target, Megaphone,
  User, TrendingDown, Sparkles, Clock, Gauge,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const classColors: Record<string, { color: string; bg: string; label: string }> = {
  positive:       { color: C.green,   bg: C.greenLight, label: "Positive" },
  meeting_intent: { color: C.green,   bg: C.greenLight, label: "Meeting Intent" },
  negative:       { color: C.red,     bg: C.redLight,   label: "Negative" },
  question:       { color: "#D97706", bg: "#FFFBEB",    label: "Question" },
};

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT", color: C.hot, bg: C.hotBg };
  if (score && score >= 50) return { label: "WARM", color: C.warm, bg: C.warmBg };
  return { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

type LossAnalysis = {
  verdict: "lost" | "dormant" | "recoverable";
  confidence: number;
  why_lost: string;
  signals: string[];
  reengage_viability: "high" | "medium" | "low";
  next_touchpoint: { channel: "linkedin" | "email" | "call"; timing: string; angle: string };
  message_template: string;
  watch_for: string;
};

async function generateAndCacheAnalysis(
  leadId: string,
  lead: any,
  campaigns: any[],
  replies: any[],
  calls: any[],
): Promise<LossAnalysis | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

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
    const parsed = JSON.parse(text) as LossAnalysis;

    // Cache it (service key bypasses RLS)
    const svc = getSupabaseService();
    await svc.from("leads")
      .update({ ai_loss_analysis: parsed, ai_loss_analysis_at: new Date().toISOString() })
      .eq("id", leadId);

    return parsed;
  } catch {
    return null;
  }
}

async function getLostLeadData(leadId: string) {
  const supabase = await getSupabaseServer();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, is_priority, current_channel, icp_profile_id, created_at, ai_loss_analysis, ai_loss_analysis_at")
    .eq("id", leadId)
    .single();

  if (!lead) return null;

  const [{ data: campaigns }, { data: replies }, profileResult, { data: calls }] = await Promise.all([
    supabase.from("campaigns")
      .select("id, name, status, channel, current_step, sequence_steps, last_step_at, created_at, sellers(name)")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true }),
    supabase.from("lead_replies")
      .select("id, classification, channel, reply_text, received_at")
      .eq("lead_id", leadId)
      .order("received_at", { ascending: true }),
    lead.icp_profile_id
      ? supabase.from("icp_profiles").select("id, profile_name, target_industries, target_roles").eq("id", lead.icp_profile_id).single()
      : { data: null },
    supabase.from("calls")
      .select("direction, status, duration, transcript, ai_summary, classification, started_at")
      .eq("lead_id", leadId)
      .order("started_at", { ascending: true }),
  ]);

  // Get message templates from campaign_requests
  const campNames = [...new Set((campaigns ?? []).map(c => c.name))];
  const { data: campRequests } = campNames.length > 0
    ? await supabase.from("campaign_requests").select("name, message_prompts").in("name", campNames)
    : { data: [] };

  const templatesByName: Record<string, any[]> = {};
  for (const cr of campRequests ?? []) {
    templatesByName[cr.name] = cr.message_prompts?.channelMessages?.steps ?? [];
  }

  // Build timeline
  const timeline: { type: string; date: string | null; channel: string; content: string | null; classification?: string; step?: number; meta?: string }[] = [];

  // Add campaign start
  for (const c of campaigns ?? []) {
    timeline.push({ type: "campaign_start", date: c.created_at, channel: c.channel, content: `Campaign "${c.name}" started`, meta: `${Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0} steps · ${(c.sellers as any)?.name ?? "Unassigned"}` });

    // Add sent messages (from templates)
    const templates = templatesByName[c.name] ?? [];
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    const stepsDone = c.current_step ?? 0;

    for (let i = 0; i < Math.min(stepsDone, steps.length); i++) {
      const stepChannel = steps[i]?.channel ?? c.channel;
      const tmpl = templates[i];
      timeline.push({
        type: "message_sent",
        date: null, // we don't have exact dates for template-based messages
        channel: stepChannel,
        content: tmpl?.body ?? null,
        step: i + 1,
        meta: tmpl?.subject ? `Subject: ${tmpl.subject}` : undefined,
      });
    }

    // Add campaign end if completed/failed
    if (c.status === "completed" || c.status === "failed") {
      timeline.push({ type: "campaign_end", date: c.last_step_at, channel: c.channel, content: `Campaign ${c.status}` });
    }
  }

  // Add replies
  for (const r of replies ?? []) {
    timeline.push({ type: "reply", date: r.received_at, channel: r.channel, content: r.reply_text, classification: r.classification });
  }

  // Sort by date (nulls first)
  timeline.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return -1;
    if (!b.date) return 1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  // Determine loss reason
  const negReply = (replies ?? []).find(r => r.classification === "negative");
  const hasCompleted = (campaigns ?? []).some(c => c.status === "completed" || c.status === "failed");
  const lossReason = negReply ? "negative" : hasCompleted ? "no_reply" : "ongoing";

  // Stats
  const totalSteps = (campaigns ?? []).reduce((s, c) => s + (Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0), 0);
  const stepsCompleted = (campaigns ?? []).reduce((s, c) => s + (c.current_step ?? 0), 0);
  const channels = [...new Set((campaigns ?? []).map(c => c.channel))];

  return {
    lead: {
      ...lead,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      email: lead.primary_work_email,
      linkedin: lead.primary_linkedin_url,
      phone: lead.primary_phone,
    },
    profile: profileResult?.data ?? null,
    campaigns: campaigns ?? [],
    replies: replies ?? [],
    calls: calls ?? [],
    timeline,
    lossReason,
    stats: {
      totalCampaigns: (campaigns ?? []).length,
      totalSteps,
      stepsCompleted,
      totalReplies: (replies ?? []).length,
      channels,
      daysSinceCreated: Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000),
    },
  };
}

export default async function LostLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getLostLeadData(id);
  if (!data) notFound();

  const { lead, profile, campaigns, replies, calls, timeline, lossReason, stats } = data;

  // Use cached analysis if present; otherwise generate and cache (blocks first render once)
  let aiAnalysis: LossAnalysis | null = (lead.ai_loss_analysis as LossAnalysis) ?? null;
  if (!aiAnalysis) {
    aiAnalysis = await generateAndCacheAnalysis(lead.id, lead, campaigns, replies, calls);
  }
  const analyzedAt = lead.ai_loss_analysis_at ? new Date(lead.ai_loss_analysis_at) : null;
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
  const badge = scoreBadge(lead.lead_score, lead.is_priority);

  return (
    <div className="p-6 w-full max-w-4xl mx-auto">
      <Breadcrumb crumbs={[{ label: "Leads & Campaigns", href: "/leads" }, { label: "Lost Leads" }, { label: name }]} />

      {/* ═══ HEADER CARD ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderLeftWidth: 4, borderLeftColor: C.red }}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
              {((lead.company ?? name)[0] ?? "?").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold" style={{ color: C.textPrimary }}>{name}</h1>
                {lead.is_priority && <Star size={14} fill={gold} stroke={gold} />}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
              </div>
              <p className="text-sm" style={{ color: C.textMuted }}>
                {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: C.textDim }}>
                {lead.email && <span>{lead.email}</span>}
                {lead.phone && <span>{lead.phone}</span>}
              </div>
            </div>

            {/* Loss reason */}
            <div className="shrink-0 text-right">
              {lossReason === "negative" ? (
                <div className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold" style={{ backgroundColor: C.redLight, color: C.red }}>
                  <XCircle size={16} /> Negative Reply
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold" style={{ backgroundColor: "#F3F4F6", color: C.textMuted }}>
                  <AlertTriangle size={16} /> No Reply
                </div>
              )}
              <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                Lead created {formatDate(lead.created_at)} · {stats.daysSinceCreated}d ago
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ STATS ROW ═══ */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: "Campaigns", value: stats.totalCampaigns, color: gold },
          { label: "Steps Done", value: `${stats.stepsCompleted}/${stats.totalSteps}`, color: C.blue },
          { label: "Channels", value: stats.channels.length, color: "#7C3AED" },
          { label: "Replies", value: stats.totalReplies, color: lossReason === "negative" ? C.red : C.textDim },
          { label: "Days Active", value: stats.daysSinceCreated, color: C.textBody },
        ].map(s => (
          <div key={s.label} className="rounded-xl border p-3 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <p className="text-lg font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* ═══ TWO COLUMNS ═══ */}
      <div className="grid grid-cols-5 gap-6 mb-6">
        {/* LEFT: Context (2 cols) */}
        <div className="col-span-2 space-y-4">
          {/* Profile */}
          {profile && (
            <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Target size={12} style={{ color: gold }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: gold }}>Lead Miner Profile</span>
              </div>
              <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{profile.profile_name}</p>
              <p className="text-xs mt-1" style={{ color: C.textDim }}>
                {[...(profile.target_industries ?? []), ...(profile.target_roles ?? [])].slice(0, 4).join(", ")}
              </p>
            </div>
          )}

          {/* Campaigns used */}
          <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="flex items-center gap-1.5 mb-3">
              <Megaphone size={12} style={{ color: gold }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: gold }}>Campaigns Attempted</span>
            </div>
            {campaigns.length === 0 ? (
              <p className="text-xs" style={{ color: C.textDim }}>No campaigns</p>
            ) : (
              <div className="space-y-2">
                {campaigns.map(c => {
                  const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
                  const pct = steps.length > 0 ? Math.round(((c.current_step ?? 0) / steps.length) * 100) : 0;
                  const chMeta = channelMeta[c.channel] ?? channelMeta.email;
                  const ChIcon = chMeta.icon;
                  return (
                    <Link key={c.id} href={`/campaigns/${c.id}`}
                      className="block rounded-lg border p-3 transition-colors hover:bg-black/[0.015]"
                      style={{ borderColor: C.border }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{c.name}</span>
                        <span className="flex items-center gap-1 text-[10px]" style={{ color: chMeta.color }}>
                          <ChIcon size={10} /> {chMeta.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                          <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: C.textMuted }} />
                        </div>
                        <span className="text-[9px] tabular-nums" style={{ color: C.textDim }}>{c.current_step ?? 0}/{steps.length} steps</span>
                      </div>
                      <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                        {c.status} · {(c.sellers as any)?.name ?? "Unassigned"} · Started {formatDate(c.created_at)}
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Loss analysis placeholder */}
          <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.red}` }}>
            <div className="flex items-center gap-1.5 mb-3">
              <TrendingDown size={12} style={{ color: C.red }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.red }}>Loss Analysis</span>
            </div>
            {lossReason === "negative" ? (
              <div>
                <p className="text-xs font-semibold mb-1" style={{ color: C.textBody }}>Lead replied negatively</p>
                <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
                  After {stats.stepsCompleted} touchpoints across {stats.channels.length} channel{stats.channels.length > 1 ? "s" : ""} ({stats.channels.join(", ")}),
                  the lead responded with a negative reply. The full sequence was {stats.stepsCompleted === stats.totalSteps ? "completed" : `${stats.stepsCompleted}/${stats.totalSteps} steps in`} before receiving the response.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-semibold mb-1" style={{ color: C.textBody }}>No response received</p>
                <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
                  The complete sequence of {stats.totalSteps} steps across {stats.channels.length} channel{stats.channels.length > 1 ? "s" : ""} ({stats.channels.join(", ")}) was executed over {stats.daysSinceCreated} days with no reply from the lead.
                </p>
              </div>
            )}
            {/* AI recovery plan */}
            {aiAnalysis ? (
              <AIRecoveryPanel analysis={aiAnalysis} leadId={lead.id} firstName={lead.first_name} analyzedAt={analyzedAt} />
            ) : (
              <div className="mt-3 rounded-lg px-3 py-2.5 border border-dashed" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <p className="text-[10px] font-semibold" style={{ color: C.textDim }}>AI Recovery Plan</p>
                <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>Add ANTHROPIC_API_KEY to .env.local to enable AI analysis.</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Timeline (3 cols) */}
        <div className="col-span-3">
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Outreach Timeline</h2>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Complete history of interactions with this lead</p>
            </div>

            <div className="p-5">
              {timeline.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: C.textDim }}>No interactions recorded</p>
              ) : (
                <div className="relative">
                  {/* Vertical line */}
                  <div className="absolute left-[15px] top-2 bottom-2 w-px" style={{ backgroundColor: C.border }} />

                  <div className="space-y-4">
                    {timeline.map((item, i) => {
                      const isReply = item.type === "reply";
                      const isCampStart = item.type === "campaign_start";
                      const isCampEnd = item.type === "campaign_end";
                      const isMsg = item.type === "message_sent";
                      const chMeta = channelMeta[item.channel] ?? channelMeta.email;
                      const cls = isReply && item.classification ? classColors[item.classification] : null;
                      const dotBg = isReply ? (cls?.bg ?? "#F3F4F6") : isCampStart ? `color-mix(in srgb, ${gold} 8%, transparent)` : isCampEnd ? "#F3F4F6" : `${chMeta.color}15`;

                      return (
                        <div key={i} className="flex gap-3 relative">
                          {/* Dot */}
                          <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 z-10"
                            style={{ backgroundColor: dotBg }}>
                            {isCampStart && <Megaphone size={12} style={{ color: gold }} />}
                            {isCampEnd && <XCircle size={12} style={{ color: C.textMuted }} />}
                            {isMsg && <Send size={12} style={{ color: chMeta.color }} />}
                            {isReply && <MessageSquare size={12} style={{ color: cls?.color ?? C.textDim }} />}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 pb-1">
                            {/* Header */}
                            <div className="flex items-center gap-2 mb-0.5">
                              {isMsg && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${chMeta.color}12`, color: chMeta.color }}>
                                  Step {item.step} · {chMeta.label}
                                </span>
                              )}
                              {isReply && cls && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: cls.bg, color: cls.color }}>
                                  {cls.label}
                                </span>
                              )}
                              {isCampStart && <span className="text-[10px] font-bold" style={{ color: gold }}>Campaign Started</span>}
                              {isCampEnd && <span className="text-[10px] font-bold" style={{ color: C.textMuted }}>Campaign Ended</span>}
                              {item.date && <span className="text-[9px] ml-auto" style={{ color: C.textDim }}>{formatDate(item.date)}</span>}
                            </div>

                            {/* Subject */}
                            {item.meta && (
                              <p className="text-[10px] font-semibold" style={{ color: C.textBody }}>{item.meta}</p>
                            )}

                            {/* Body */}
                            {item.content && (
                              <div className="rounded-lg px-3 py-2 mt-1 border"
                                style={{
                                  backgroundColor: isReply ? (cls?.bg ?? "#F3F4F6") : C.bg,
                                  borderColor: isReply ? (cls?.color ?? C.textDim) + "20" : C.border,
                                }}>
                                <p className="text-[11px] leading-relaxed whitespace-pre-line line-clamp-6" style={{ color: C.textBody }}>
                                  {isReply ? `"${item.content}"` : item.content}
                                </p>
                              </div>
                            )}

                            {isMsg && !item.content && (
                              <p className="text-[10px] italic mt-1" style={{ color: C.textDim }}>Message sent via {chMeta.label}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Link href="/leads" className="text-xs font-medium hover:underline flex items-center gap-1" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} /> Back to Leads & Campaigns
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/leads/${lead.id}`}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80 border"
            style={{ backgroundColor: C.card, color: C.textBody, borderColor: C.border }}>
            <User size={12} /> View Full Profile
          </Link>
          <LostLeadActions leadId={lead.id} />
        </div>
      </div>
    </div>
  );
}

// ─── AI Recovery Panel ──────────────────────────────────────────────────────
const viabilityColor = { high: "#16A34A", medium: "#D97706", low: C.red };
const viabilityBg = { high: "#DCFCE7", medium: "#FFFBEB", low: C.redLight };
const verdictMeta: Record<LossAnalysis["verdict"], { label: string; color: string; bg: string }> = {
  recoverable: { label: "Recoverable",  color: "#16A34A", bg: "#DCFCE7" },
  dormant:     { label: "Dormant",      color: "#D97706", bg: "#FFFBEB" },
  lost:        { label: "Lost",         color: C.red,     bg: C.redLight },
};
const channelIcon: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

function AIRecoveryPanel({
  analysis, leadId, firstName, analyzedAt,
}: {
  analysis: LossAnalysis;
  leadId: string;
  firstName: string | null;
  analyzedAt: Date | null;
}) {
  const verdict = verdictMeta[analysis.verdict] ?? verdictMeta.lost;
  const v = analysis.reengage_viability;
  const vColor = viabilityColor[v] ?? C.textMuted;
  const vBg = viabilityBg[v] ?? "#F3F4F6";
  const tp = analysis.next_touchpoint;
  const ChMeta = channelIcon[tp?.channel ?? "email"] ?? channelIcon.email;
  const ChIcon = ChMeta.icon;
  const filledTemplate = (analysis.message_template ?? "").replace(/\{\{first_name\}\}/g, firstName ?? "there");

  return (
    <div className="mt-3 rounded-lg border overflow-hidden" style={{ borderColor: "#7C3AED30", backgroundColor: "#F5F3FF" }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b" style={{ borderColor: "#7C3AED20", backgroundColor: "#EDE9FE" }}>
        <div className="flex items-center gap-1.5">
          <Sparkles size={11} style={{ color: "#7C3AED" }} />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#7C3AED" }}>AI Recovery Plan</span>
        </div>
        <div className="flex items-center gap-2">
          {analyzedAt && (
            <span className="text-[9px]" style={{ color: "#7C3AED99" }}>
              {analyzedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
            </span>
          )}
          <RegenerateLossAnalysis leadId={leadId} />
        </div>
      </div>

      <div className="px-3 py-3 space-y-3">
        {/* Verdict + confidence */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: verdict.bg, color: verdict.color }}>
            {verdict.label}
          </span>
          <span className="text-[10px] font-medium" style={{ color: "#6B7280" }}>
            <Gauge size={9} className="inline mr-0.5" /> {analysis.confidence}% confidence
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded ml-auto" style={{ backgroundColor: vBg, color: vColor }}>
            Re-engage: {v}
          </span>
        </div>

        {/* Why lost */}
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "#7C3AED" }}>Why lost</p>
          <p className="text-[11px] leading-relaxed" style={{ color: "#4C1D95" }}>{analysis.why_lost}</p>
        </div>

        {/* Signals */}
        {analysis.signals?.length > 0 && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "#7C3AED" }}>Signals</p>
            <div className="space-y-1">
              {analysis.signals.map((s, i) => (
                <div key={i} className="flex gap-2 text-[11px]" style={{ color: "#5B21B6" }}>
                  <span className="shrink-0" style={{ color: "#A78BFA" }}>•</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Next touchpoint */}
        {tp && (
          <div className="rounded-lg border p-2.5" style={{ borderColor: "#DDD6FE", backgroundColor: "#FAFAFF" }}>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#7C3AED" }}>Next Touchpoint</p>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${ChMeta.color}15`, color: ChMeta.color }}>
                <ChIcon size={9} /> {ChMeta.label}
              </div>
              <span className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: "#6B7280" }}>
                <Clock size={9} /> {tp.timing}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: "#5B21B6" }}><strong>Angle:</strong> {tp.angle}</p>
          </div>
        )}

        {/* Message template */}
        {analysis.message_template && (
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "#DDD6FE" }}>
            <div className="flex items-center justify-between px-2.5 py-1.5" style={{ backgroundColor: "#7C3AED0A" }}>
              <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#7C3AED" }}>Ready-to-send message</p>
              <CopyTemplateButton text={filledTemplate} />
            </div>
            <p className="text-[11px] leading-relaxed px-2.5 py-2 whitespace-pre-wrap" style={{ color: "#4C1D95", backgroundColor: "#FAFAFF" }}>
              {filledTemplate}
            </p>
          </div>
        )}

        {/* Watch for */}
        {analysis.watch_for && (
          <div className="flex gap-2 text-[11px] pt-1 border-t" style={{ borderColor: "#DDD6FE", color: "#5B21B6" }}>
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider pt-1" style={{ color: "#7C3AED" }}>Watch for:</span>
            <span className="pt-0.5">{analysis.watch_for}</span>
          </div>
        )}
      </div>
    </div>
  );
}
