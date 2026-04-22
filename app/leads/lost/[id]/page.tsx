import { getSupabaseServer } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import { C } from "@/lib/design";
import Link from "next/link";
import Anthropic from "@anthropic-ai/sdk";
import Breadcrumb from "@/components/Breadcrumb";
import LostLeadActions from "@/components/LostLeadActions";
import {
  ArrowLeft, Share2, Mail, Phone, Star, Send,
  MessageSquare, XCircle, AlertTriangle, Target, Megaphone,
  User, TrendingDown, Sparkles,
} from "lucide-react";

const gold = "#C9A83A";

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

async function getAIAnalysis(params: {
  name: string; company: string | null; role: string | null;
  lossReason: string; channels: string[]; stepsCompleted: number;
  totalSteps: number; totalCampaigns: number; negReplyText?: string | null;
}): Promise<{ analysis: string; recommendations: string[] } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const prompt = `You are a B2B sales analyst. Analyze why this lead was lost and give re-engagement advice.

Lead: ${params.name}${params.role ? `, ${params.role}` : ""}${params.company ? ` at ${params.company}` : ""}
Loss reason: ${params.lossReason === "negative" ? "Negative reply received" : "No reply after full sequence"}
Campaigns run: ${params.totalCampaigns} · Steps completed: ${params.stepsCompleted}/${params.totalSteps} · Channels: ${params.channels.join(", ")}
${params.negReplyText ? `Negative reply: "${params.negReplyText}"` : ""}

Respond ONLY with valid JSON (no markdown): {"analysis":"2-3 sentence analysis","recommendations":["rec1","rec2","rec3"]}`;

    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function getLostLeadData(leadId: string) {
  const supabase = await getSupabaseServer();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, is_priority, current_channel, icp_profile_id, created_at")
    .eq("id", leadId)
    .single();

  if (!lead) return null;

  const [{ data: campaigns }, { data: replies }, profileResult] = await Promise.all([
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

  const { lead, profile, campaigns, replies, timeline, lossReason, stats } = data;

  const negReply = replies.find((r: any) => r.classification === "negative");
  const aiAnalysis = await getAIAnalysis({
    name: `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim(),
    company: lead.company,
    role: lead.role,
    lossReason,
    channels: stats.channels,
    stepsCompleted: stats.stepsCompleted,
    totalSteps: stats.totalSteps,
    totalCampaigns: stats.totalCampaigns,
    negReplyText: negReply?.reply_text ?? null,
  });
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
              style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
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
            {/* AI recommendations */}
            {aiAnalysis ? (
              <div className="mt-3 rounded-lg border overflow-hidden" style={{ borderColor: "#7C3AED30", backgroundColor: "#F5F3FF" }}>
                <div className="flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: "#7C3AED20", backgroundColor: "#EDE9FE" }}>
                  <Sparkles size={11} style={{ color: "#7C3AED" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#7C3AED" }}>AI Analysis</span>
                </div>
                <div className="px-3 py-2.5 space-y-2.5">
                  <p className="text-[11px] leading-relaxed" style={{ color: "#4C1D95" }}>{aiAnalysis.analysis}</p>
                  <div className="space-y-1.5">
                    {aiAnalysis.recommendations.map((rec, i) => (
                      <div key={i} className="flex gap-2 text-[11px]" style={{ color: "#5B21B6" }}>
                        <span className="shrink-0 font-bold" style={{ color: "#7C3AED" }}>{i + 1}.</span>
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg px-3 py-2.5 border border-dashed" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <p className="text-[10px] font-semibold" style={{ color: C.textDim }}>AI Recommendations</p>
                <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>Add OPENAI_API_KEY to .env.local to enable AI analysis.</p>
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
                      const dotBg = isReply ? (cls?.bg ?? "#F3F4F6") : isCampStart ? `${gold}15` : isCampEnd ? "#F3F4F6" : `${chMeta.color}15`;

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
