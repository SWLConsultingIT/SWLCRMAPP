import { getSupabaseServer } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import { C } from "@/lib/design";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, Star, ExternalLink,
  Target, Megaphone,
} from "lucide-react";
import OpportunityStagePanel from "@/components/OpportunityStagePanel";
import Breadcrumb from "@/components/Breadcrumb";

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

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT", color: C.hot, bg: C.hotBg };
  if (score && score >= 50) return { label: "WARM", color: C.warm, bg: C.warmBg };
  return { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

async function getOpportunityData(id: string) {
  const supabase = await getSupabaseServer();
  // Try as campaign ID first, then as lead ID
  let pivotName: string | null = null;
  let campaignId = id;
  let isLeadOnly = false;

  const { data: pivot } = await supabase.from("campaigns").select("id, name").eq("id", id).single();
  if (pivot) {
    pivotName = pivot.name;
  } else {
    // Fallback: id might be a lead_id — find their campaign
    const { data: leadCamp } = await supabase
      .from("campaigns")
      .select("id, name")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (leadCamp) {
      pivotName = leadCamp.name;
      campaignId = leadCamp.id;
    } else {
      // No campaign at all — check if lead exists with positive reply
      const { data: lead } = await supabase.from("leads").select("id").eq("id", id).single();
      if (!lead) return null;
      isLeadOnly = true;
    }
  }
  if (!pivotName && !isLeadOnly) return null;

  // Lead-only path: lead has positive reply but no campaign
  if (isLeadOnly) {
    const [{ data: lead }, { data: replies }] = await Promise.all([
      supabase.from("leads")
        .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, lead_score, is_priority, current_channel, transferred_to_odoo_at, icp_profile_id, opportunity_stage, opportunity_notes, opportunity_next_action")
        .eq("id", id).single(),
      supabase.from("lead_replies")
        .select("id, lead_id, classification, channel, reply_text, received_at")
        .eq("lead_id", id)
        .order("received_at", { ascending: true }),
    ]);
    if (!lead) return null;
    const winReply = (replies ?? []).find((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
    const leadName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";

    const profileId = lead.icp_profile_id;
    const { data: profile } = profileId
      ? await supabase.from("icp_profiles").select("id, profile_name").eq("id", profileId).single()
      : { data: null };

    return {
      name: `${leadName} — ${lead.company_name ?? "Direct"}`,
      campaignId: null,
      totalLeads: 1,
      converted: winReply ? 1 : 0,
      transferred: lead.transferred_to_odoo_at ? 1 : 0,
      conversionRate: winReply ? 100 : 0,
      avgSteps: 0,
      channelBreakdown: winReply ? [{ channel: winReply.channel, total: 1, converted: 1, rate: 100 }] : [],
      sequence: [],
      connectionNote: null,
      convertedLeads: [{
        id: lead.id,
        name: leadName,
        company: lead.company_name,
        role: lead.primary_title_role,
        score: lead.lead_score,
        is_priority: lead.is_priority,
        channel: winReply?.channel ?? "email",
        transferred: !!lead.transferred_to_odoo_at,
        winReplyText: winReply?.reply_text ?? null,
        winReplyDate: winReply?.received_at ?? null,
        winClassification: winReply?.classification ?? "positive",
        stepsToConvert: 0,
        totalSteps: 0,
        allReplies: replies ?? [],
      }],
      profile: profile ?? null,
      seller: null,
      stageLeadId: lead.id,
      opportunityStage: (lead as any).opportunity_stage ?? null,
      opportunityNotes: (lead as any).opportunity_notes ?? null,
      opportunityNextAction: (lead as any).opportunity_next_action ?? null,
    };
  }

  // Campaign path: normal flow grouped by campaign name
  const { data: allCampaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, created_at, lead_id, sellers(name)")
    .eq("name", pivotName!)
    .order("created_at", { ascending: false });

  const leadIds = (allCampaigns ?? []).map(c => c.lead_id).filter(Boolean);
  if (leadIds.length === 0) return null;

  const [{ data: leads }, { data: allReplies }, { data: campRequests }] = await Promise.all([
    supabase.from("leads")
      .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, lead_score, is_priority, current_channel, transferred_to_odoo_at, icp_profile_id, opportunity_stage, opportunity_notes, opportunity_next_action")
      .in("id", leadIds),
    supabase.from("lead_replies")
      .select("id, lead_id, classification, channel, reply_text, received_at")
      .in("lead_id", leadIds)
      .order("received_at", { ascending: true }),
    supabase.from("campaign_requests")
      .select("name, message_prompts")
      .eq("name", pivotName!)
      .limit(1)
      .maybeSingle(),
  ]);

  // Profile
  const profileId = (leads ?? [])[0]?.icp_profile_id;
  const { data: profile } = profileId
    ? await supabase.from("icp_profiles").select("id, profile_name").eq("id", profileId).single()
    : { data: null };

  // Lookups
  const leadsMap: Record<string, any> = {};
  for (const l of leads ?? []) leadsMap[l.id] = l;

  const repliesByLead: Record<string, any[]> = {};
  for (const r of allReplies ?? []) {
    if (!repliesByLead[r.lead_id]) repliesByLead[r.lead_id] = [];
    repliesByLead[r.lead_id].push(r);
  }

  const positiveLeadIds = new Set(
    (allReplies ?? []).filter(r => r.classification === "positive" || r.classification === "meeting_intent").map(r => r.lead_id)
  );

  // Templates
  const templates = campRequests?.message_prompts?.channelMessages?.steps ?? [];
  const connectionNote = campRequests?.message_prompts?.channelMessages?.connectionRequest ?? null;

  // Channel breakdown
  const channelStats: Record<string, { total: Set<string>; converted: Set<string> }> = {};
  for (const c of allCampaigns ?? []) {
    if (!channelStats[c.channel]) channelStats[c.channel] = { total: new Set(), converted: new Set() };
    if (c.lead_id) {
      channelStats[c.channel].total.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) channelStats[c.channel].converted.add(c.lead_id);
    }
  }
  const channelBreakdown = Object.entries(channelStats).map(([ch, s]) => ({
    channel: ch,
    total: s.total.size,
    converted: s.converted.size,
    rate: s.total.size > 0 ? Math.round((s.converted.size / s.total.size) * 100) : 0,
  }));

  // Build lead details
  const totalLeads = (allCampaigns ?? []).length;
  const convertedLeads = [...positiveLeadIds].map(lid => {
    const lead = leadsMap[lid];
    if (!lead) return null;
    const replies = repliesByLead[lid] ?? [];
    const winReply = replies.find((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
    const camp = (allCampaigns ?? []).find(c => c.lead_id === lid);
    return {
      id: lead.id,
      name: `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown",
      company: lead.company_name,
      role: lead.primary_title_role,
      score: lead.lead_score,
      is_priority: lead.is_priority,
      channel: winReply?.channel ?? camp?.channel ?? "email",
      transferred: !!lead.transferred_to_odoo_at,
      winReplyText: winReply?.reply_text ?? null,
      winReplyDate: winReply?.received_at ?? null,
      winClassification: winReply?.classification ?? "positive",
      stepsToConvert: camp?.current_step ?? 0,
      totalSteps: Array.isArray(camp?.sequence_steps) ? camp.sequence_steps.length : 0,
      allReplies: replies,
    };
  }).filter(Boolean);

  // Sequence info
  const seqSteps = (allCampaigns ?? [])[0]?.sequence_steps ?? [];
  const sequence = (Array.isArray(seqSteps) ? seqSteps : []).map((s: any, i: number) => ({
    channel: s.channel ?? "email",
    daysAfter: s.daysAfter ?? 0,
    body: templates[i]?.body ?? null,
    subject: templates[i]?.subject ?? null,
  }));

  const avgSteps = convertedLeads.length > 0
    ? Math.round(convertedLeads.reduce((s, l: any) => s + l.stepsToConvert, 0) / convertedLeads.length * 10) / 10
    : 0;

  const firstConverted = convertedLeads[0] as any;
  return {
    name: pivotName,
    campaignId,
    totalLeads,
    converted: convertedLeads.length,
    transferred: convertedLeads.filter((l: any) => l.transferred).length,
    conversionRate: totalLeads > 0 ? Math.round((convertedLeads.length / totalLeads) * 100) : 0,
    avgSteps,
    channelBreakdown,
    sequence,
    connectionNote,
    convertedLeads,
    profile: profile ?? null,
    seller: ((allCampaigns ?? [])[0]?.sellers as any)?.name ?? null,
    stageLeadId: firstConverted?.id ?? null,
    opportunityStage: firstConverted ? (leadsMap[firstConverted.id]?.opportunity_stage ?? null) : null,
    opportunityNotes: firstConverted ? (leadsMap[firstConverted.id]?.opportunity_notes ?? null) : null,
    opportunityNextAction: firstConverted ? (leadsMap[firstConverted.id]?.opportunity_next_action ?? null) : null,
  };
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getOpportunityData(id);
  if (!data) notFound();

  return (
    <div className="p-6 w-full max-w-5xl mx-auto">
      <Breadcrumb crumbs={[{ label: "Opportunities", href: "/opportunities" }, { label: data.name ?? "Detail" }]} />

      {/* ═══ HEADER ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.green }}>Opportunity Analysis</p>
          <h1 className="text-2xl font-bold mb-2" style={{ color: C.textPrimary }}>{data.name}</h1>
          <div className="flex items-center gap-3 text-xs" style={{ color: C.textMuted }}>
            {data.profile && (
              <span className="flex items-center gap-1"><Target size={10} style={{ color: gold }} /> {data.profile.profile_name}</span>
            )}
            {data.seller && <span>· Seller: {data.seller}</span>}
            <span>· {data.sequence.length} steps</span>
          </div>
        </div>

        {/* Stats row */}
        <div className="border-t grid grid-cols-5 divide-x" style={{ borderColor: C.border }}>
          {[
            { label: "Total Leads", value: data.totalLeads, color: C.textBody },
            { label: "Converted", value: data.converted, color: C.green },
            { label: "Conversion Rate", value: `${data.conversionRate}%`, color: data.conversionRate >= 20 ? C.green : "#D97706" },
            { label: "Avg Steps", value: data.avgSteps > 0 ? `${data.avgSteps}` : "—", color: gold },
            { label: "Transferred", value: data.transferred, color: C.accent },
          ].map(s => (
            <div key={s.label} className="px-5 py-4 text-center" style={{ borderColor: C.border }}>
              <p className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ TWO COLUMNS ═══ */}
      <div className="grid grid-cols-5 gap-6 mb-6">

        {/* LEFT: Stage + Channel + Sequence (2 cols) */}
        <div className="col-span-2 space-y-6">
          {data.stageLeadId && (
            <OpportunityStagePanel
              leadId={data.stageLeadId}
              initialStage={data.opportunityStage}
              initialNotes={data.opportunityNotes}
              initialNextAction={data.opportunityNextAction}
            />
          )}
          {/* Channel breakdown */}
          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Conversion by Channel</h2>
            <div className="space-y-4">
              {data.channelBreakdown.map(ch => {
                const meta = channelMeta[ch.channel] ?? channelMeta.email;
                const Icon = meta.icon;
                return (
                  <div key={ch.channel}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: meta.color }}>
                        <Icon size={13} /> {meta.label}
                      </span>
                      <span className="text-xs" style={{ color: C.textBody }}>
                        <span className="font-bold">{ch.converted}</span>/{ch.total}
                        <span className="ml-1 font-bold" style={{ color: ch.rate >= 20 ? C.green : "#D97706" }}>({ch.rate}%)</span>
                      </span>
                    </div>
                    <div className="h-3 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                      <div className="h-3 rounded-full" style={{ width: `${ch.rate}%`, backgroundColor: meta.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Outreach sequence */}
          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>
              Outreach Sequence ({data.sequence.length} steps)
            </h2>
            {data.connectionNote && (
              <div className="rounded-lg px-3 py-2.5 mb-3 border" style={{ backgroundColor: C.bg, borderColor: "#0A66C2" + "30" }}>
                <p className="text-[10px] font-semibold mb-1 flex items-center gap-1" style={{ color: "#0A66C2" }}>
                  <Share2 size={10} /> Connection Request
                </p>
                <p className="text-[11px] leading-relaxed line-clamp-3" style={{ color: C.textBody }}>{data.connectionNote}</p>
              </div>
            )}
            <div className="space-y-2">
              {data.sequence.map((step: any, i: number) => {
                const meta = channelMeta[step.channel] ?? channelMeta.email;
                const Icon = meta.icon;
                return (
                  <div key={i} className="rounded-lg border px-3 py-2.5" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>{i + 1}</span>
                      <Icon size={11} style={{ color: meta.color }} />
                      <span className="text-[10px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                      {step.daysAfter > 0 && <span className="text-[10px] ml-auto" style={{ color: C.textDim }}>+{step.daysAfter}d</span>}
                    </div>
                    {step.subject && <p className="text-[10px] font-semibold mt-1" style={{ color: C.textBody }}>Subject: {step.subject}</p>}
                    {step.body ? (
                      <p className="text-[11px] mt-1 line-clamp-4 leading-relaxed whitespace-pre-line" style={{ color: C.textMuted }}>{step.body}</p>
                    ) : (
                      <p className="text-[10px] mt-0.5 italic" style={{ color: C.textDim }}>Message sent via {meta.label}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: Converted leads (3 cols) */}
        <div className="col-span-3">
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Converted Leads ({data.convertedLeads.length})</h2>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Leads that responded positively</p>
            </div>

            {data.convertedLeads.map((lead: any, i: number) => {
              const badge = scoreBadge(lead.score, lead.is_priority);
              const chMeta = channelMeta[lead.channel] ?? channelMeta.email;
              const ChIcon = chMeta.icon;
              const cls = classColors[lead.winClassification] ?? classColors.positive;

              return (
                <div key={lead.id} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
                  <div className="px-5 py-4">
                    {/* Lead header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ background: `linear-gradient(135deg, ${C.green}, #34D399)`, color: "#fff" }}>
                        {(lead.name[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Link href={`/leads/${lead.id}`} className="text-sm font-bold hover:underline" style={{ color: C.textPrimary }}>
                            {lead.name}
                          </Link>
                          {lead.is_priority && <Star size={11} fill={gold} stroke={gold} />}
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
                        </div>
                        <p className="text-xs" style={{ color: C.textMuted }}>
                          {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {lead.transferred ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md"
                            style={{ backgroundColor: C.greenLight, color: C.green }}>
                            <ExternalLink size={10} /> In CRM
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2.5 py-1 rounded-md"
                            style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>Pending Transfer</span>
                        )}
                      </div>
                    </div>

                    {/* Conversion details */}
                    <div className="flex items-center gap-4 mb-3 text-[10px]" style={{ color: C.textDim }}>
                      <span className="flex items-center gap-1" style={{ color: chMeta.color }}>
                        <ChIcon size={10} /> Converted via {chMeta.label}
                      </span>
                      <span>Step {lead.stepsToConvert}/{lead.totalSteps}</span>
                      {lead.winReplyDate && <span>{timeAgo(lead.winReplyDate)}</span>}
                    </div>

                    {/* Winning reply */}
                    {lead.winReplyText && (
                      <div className="rounded-lg px-4 py-3 border" style={{ backgroundColor: C.greenLight, borderColor: C.green + "25" }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold" style={{ color: C.green }}>Winning Reply</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: cls.bg, color: cls.color }}>{cls.label}</span>
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>&ldquo;{lead.winReplyText}&rdquo;</p>
                      </div>
                    )}

                    {/* All replies from this lead */}
                    {lead.allReplies.length > 1 && (
                      <div className="mt-3">
                        <p className="text-[10px] font-semibold mb-2" style={{ color: C.textMuted }}>Full Reply History ({lead.allReplies.length})</p>
                        <div className="space-y-1.5">
                          {lead.allReplies.map((r: any) => {
                            const rCls = classColors[r.classification] ?? { color: C.textMuted, bg: "#F3F4F6", label: r.classification };
                            const rCh = channelMeta[r.channel] ?? channelMeta.email;
                            return (
                              <div key={r.id} className="flex items-start gap-2 rounded-lg px-3 py-2 border"
                                style={{ backgroundColor: C.bg, borderColor: C.border }}>
                                <rCh.icon size={10} style={{ color: rCh.color }} className="shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: rCls.bg, color: rCls.color }}>{rCls.label}</span>
                                    <span className="text-[9px]" style={{ color: C.textDim }}>{formatDate(r.received_at)}</span>
                                  </div>
                                  {r.reply_text && <p className="text-[10px] line-clamp-2" style={{ color: C.textBody }}>&ldquo;{r.reply_text}&rdquo;</p>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Link href="/opportunities" className="text-xs font-medium hover:underline flex items-center gap-1" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} /> Back to Opportunities
        </Link>
        <div className="flex items-center gap-2">
          {data.convertedLeads[0] && (
            <Link href={`/leads/${(data.convertedLeads[0] as any).id}`}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ backgroundColor: C.blueLight, color: C.blue, border: `1px solid ${C.blue}30` }}>
              <Star size={12} /> View Lead Detail
            </Link>
          )}
          {data.campaignId && (
            <Link href={`/campaigns/${data.campaignId}`}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ backgroundColor: gold, color: "#04070d" }}>
              <Megaphone size={12} /> View Campaign Detail
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
