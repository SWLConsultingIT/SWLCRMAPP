import { getSupabaseServer } from "@/lib/supabase-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import { notFound } from "next/navigation";
import { C } from "@/lib/design";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, Star, ExternalLink, Trophy,
  Target, Megaphone, Calendar, Hash,
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

// ── Data fetchers ─────────────────────────────────────────────────────────
// Two modes:
//   1. Lead mode (default for Won card clicks) — id matches a lead. Page shows
//      that ONE lead's win story: reply highlight, campaign context, stage
//      panel, full reply timeline.
//   2. Campaign mode (legacy bookmarks, old links) — id matches a campaign
//      whose lead_id doesn't match a lead row. Page falls back to the
//      campaign-rollup rendering.

async function getLeadOpportunity(id: string) {
  const supabase = await getSupabaseServer();
  const { data: rawLead } = await supabase
    .from("leads")
    .select("id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, lead_score, is_priority, current_channel, transferred_to_odoo_at, icp_profile_id, opportunity_stage, opportunity_notes, opportunity_next_action, created_at, status")
    .eq("id", id)
    .maybeSingle();
  if (!rawLead) return null;
  const [hydrated] = await hydrateClientLeads([rawLead as Record<string, unknown>]);
  const lead = hydrated as any;

  const [{ data: replies }, { data: rawCamp }, { data: profile }] = await Promise.all([
    supabase.from("lead_replies")
      .select("id, classification, channel, reply_text, received_at")
      .eq("lead_id", id)
      .order("received_at", { ascending: true }),
    supabase.from("campaigns")
      .select("id, name, status, channel, current_step, sequence_steps, started_at, created_at, sellers(name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    lead.icp_profile_id
      ? supabase.from("icp_profiles").select("id, profile_name").eq("id", lead.icp_profile_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const winReply = (replies ?? []).find((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
  const isWon = !!winReply || !!lead.transferred_to_odoo_at;
  if (!isWon) return null; // not a won opportunity

  // Pull templates from campaign_requests if we have a campaign.
  let connectionNote: string | null = null;
  let templates: Array<{ subject?: string | null; body?: string | null }> = [];
  if (rawCamp?.name) {
    const { data: req } = await supabase.from("campaign_requests")
      .select("name, message_prompts")
      .eq("name", rawCamp.name)
      .limit(1)
      .maybeSingle();
    connectionNote = (req as any)?.message_prompts?.channelMessages?.connectionRequest ?? null;
    templates = (req as any)?.message_prompts?.channelMessages?.steps ?? [];
  }

  const daysToConvert = winReply?.received_at && lead.created_at
    ? Math.max(1, Math.round((new Date(winReply.received_at).getTime() - new Date(lead.created_at).getTime()) / 86400000))
    : null;

  const totalSteps = Array.isArray(rawCamp?.sequence_steps) ? rawCamp.sequence_steps.length : 0;

  return {
    mode: "lead" as const,
    lead: {
      id: lead.id,
      firstName: lead.primary_first_name ?? null,
      lastName: lead.primary_last_name ?? null,
      fullName: `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown",
      role: lead.primary_title_role ?? null,
      company: lead.company_name ?? null,
      email: lead.primary_work_email ?? null,
      linkedinUrl: lead.primary_linkedin_url ?? null,
      score: lead.lead_score ?? null,
      isPriority: !!lead.is_priority,
      status: lead.status ?? null,
      createdAt: lead.created_at ?? null,
      transferred: !!lead.transferred_to_odoo_at,
      transferredAt: lead.transferred_to_odoo_at ?? null,
    },
    win: winReply ? {
      replyText: winReply.reply_text ?? null,
      classification: winReply.classification,
      channel: winReply.channel ?? rawCamp?.channel ?? "email",
      receivedAt: winReply.received_at,
      daysToConvert,
    } : null,
    campaign: rawCamp ? {
      id: rawCamp.id,
      name: rawCamp.name,
      channel: rawCamp.channel,
      currentStep: rawCamp.current_step ?? 0,
      totalSteps,
      startedAt: rawCamp.started_at ?? rawCamp.created_at ?? null,
      sellerName: (rawCamp.sellers as any)?.name ?? null,
      connectionNote,
      templates,
    } : null,
    profile: profile ?? null,
    replies: replies ?? [],
    opportunityStage: lead.opportunity_stage ?? null,
    opportunityNotes: lead.opportunity_notes ?? null,
    opportunityNextAction: lead.opportunity_next_action ?? null,
  };
}

async function getCampaignRollup(id: string) {
  const supabase = await getSupabaseServer();
  const { data: pivot } = await supabase.from("campaigns").select("id, name").eq("id", id).maybeSingle();
  if (!pivot) return null;
  const pivotName = pivot.name;
  const campaignId = pivot.id;

  const { data: allCampaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, created_at, lead_id, sellers(name)")
    .eq("name", pivotName!)
    .order("created_at", { ascending: false });

  const leadIds = (allCampaigns ?? []).map(c => c.lead_id).filter(Boolean);
  if (leadIds.length === 0) return null;

  const [{ data: rawLeads }, { data: allReplies }, { data: campRequests }] = await Promise.all([
    supabase.from("leads")
      .select("id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, lead_score, is_priority, current_channel, transferred_to_odoo_at, icp_profile_id")
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
  const leads = await hydrateClientLeads((rawLeads ?? []) as Record<string, unknown>[]) as any[];

  const profileId = (leads ?? [])[0]?.icp_profile_id;
  const { data: profile } = profileId
    ? await supabase.from("icp_profiles").select("id, profile_name").eq("id", profileId).single()
    : { data: null };

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

  const templates = (campRequests as any)?.message_prompts?.channelMessages?.steps ?? [];
  const connectionNote = (campRequests as any)?.message_prompts?.channelMessages?.connectionRequest ?? null;

  const channelStats: Record<string, { total: Set<string>; converted: Set<string> }> = {};
  for (const c of allCampaigns ?? []) {
    if (!channelStats[c.channel]) channelStats[c.channel] = { total: new Set(), converted: new Set() };
    if (c.lead_id) {
      channelStats[c.channel].total.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) channelStats[c.channel].converted.add(c.lead_id);
    }
  }
  const channelBreakdown = Object.entries(channelStats).map(([ch, s]) => ({
    channel: ch, total: s.total.size, converted: s.converted.size,
    rate: s.total.size > 0 ? Math.round((s.converted.size / s.total.size) * 100) : 0,
  }));

  const totalLeads = (allCampaigns ?? []).length;
  const convertedLeads = [...positiveLeadIds].map(lid => {
    const lead = leadsMap[lid];
    if (!lead) return null;
    const reps = repliesByLead[lid] ?? [];
    const winReply = reps.find((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
    const camp = (allCampaigns ?? []).find(c => c.lead_id === lid);
    return {
      id: lead.id,
      name: `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown",
      company: lead.company_name, role: lead.primary_title_role,
      score: lead.lead_score, is_priority: lead.is_priority,
      channel: winReply?.channel ?? camp?.channel ?? "email",
      transferred: !!lead.transferred_to_odoo_at,
      winReplyText: winReply?.reply_text ?? null,
      winReplyDate: winReply?.received_at ?? null,
      winClassification: winReply?.classification ?? "positive",
      stepsToConvert: camp?.current_step ?? 0,
      totalSteps: Array.isArray(camp?.sequence_steps) ? camp.sequence_steps.length : 0,
      allReplies: reps,
    };
  }).filter(Boolean) as any[];

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

  return {
    mode: "campaign" as const,
    name: pivotName, campaignId,
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
  };
}

async function getOpportunityData(id: string) {
  // Try lead-focused first — Won cards always link with the lead id.
  const lead = await getLeadOpportunity(id);
  if (lead) return lead;
  // Legacy: id is a campaign id (old bookmarks, /opportunities table rows
  // before the link was updated). Fall back to the campaign rollup.
  return await getCampaignRollup(id);
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getOpportunityData(id);
  if (!data) notFound();
  if (data.mode === "lead") return <LeadOpportunityDetail data={data} />;
  return <CampaignOpportunityRollup data={data} />;
}

// ── Lead-focused detail (the default for Won card clicks) ──────────────────
function LeadOpportunityDetail({ data }: { data: NonNullable<Awaited<ReturnType<typeof getLeadOpportunity>>> }) {
  const { lead, win, campaign, profile, replies } = data;
  const badge = scoreBadge(lead.score, lead.isPriority);
  const winChMeta = win ? (channelMeta[win.channel] ?? channelMeta.email) : channelMeta.email;
  const WinChIcon = winChMeta.icon;
  const cls = win ? (classColors[win.classification] ?? classColors.positive) : classColors.positive;
  const campProgressPct = campaign && campaign.totalSteps > 0
    ? Math.round((campaign.currentStep / campaign.totalSteps) * 100)
    : 0;

  return (
    <div className="p-6 w-full max-w-5xl mx-auto">
      <Breadcrumb
        crumbs={[
          { label: "Leads & Campaigns", href: "/leads" },
          { label: "Results — Won", href: "/leads" },
          { label: lead.fullName },
        ]}
      />

      {/* ═══ HERO ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.green }}>
        <div className="p-6 flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${C.green}, #34D399)`, color: "#fff" }}>
            {(lead.fullName[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: C.green }}>
              <Trophy size={11} className="inline mr-1 -mt-0.5" /> Won Opportunity
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{lead.fullName}</h1>
              {lead.isPriority && <Star size={14} fill={gold} stroke={gold} />}
              <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
            </div>
            <p className="text-sm mt-1" style={{ color: C.textMuted }}>
              {lead.role ? `${lead.role}` : ""}
              {lead.role && lead.company ? " · " : ""}
              {lead.company && (
                <Link href={`/companies/${encodeURIComponent(lead.company)}`} className="hover:underline" style={{ color: C.textBody }}>
                  {lead.company}
                </Link>
              )}
            </p>
            {profile && (
              <p className="text-xs mt-1 flex items-center gap-1" style={{ color: C.textMuted }}>
                <Target size={10} style={{ color: gold }} /> {(profile as { profile_name: string }).profile_name}
              </p>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            {lead.transferred ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-md"
                style={{ backgroundColor: C.greenLight, color: C.green }}>
                <ExternalLink size={11} /> In CRM
              </span>
            ) : (
              <span className="text-[11px] font-bold px-3 py-1.5 rounded-md"
                style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
                Pending Transfer
              </span>
            )}
            {lead.transferredAt && (
              <span className="text-[10px]" style={{ color: C.textDim }}>{timeAgo(lead.transferredAt)}</span>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="border-t grid grid-cols-4 divide-x" style={{ borderColor: C.border }}>
          {[
            { label: "Days to Convert", value: win?.daysToConvert != null ? `${win.daysToConvert}` : "—", color: gold, icon: Calendar },
            { label: "Win Channel", value: winChMeta.label, color: winChMeta.color, icon: WinChIcon },
            { label: "Reply Type", value: cls.label, color: cls.color, icon: Star },
            { label: "Lead Score", value: lead.score != null ? `${lead.score}/100` : "—", color: badge.color, icon: Hash },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="px-5 py-4 flex items-center gap-3" style={{ borderColor: C.border }}>
                <Icon size={16} style={{ color: s.color }} />
                <div>
                  <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{s.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ TWO COLUMNS ═══ */}
      <div className="grid grid-cols-5 gap-6 mb-6">

        {/* LEFT: Stage panel + Campaign context (2 cols) */}
        <div className="col-span-2 space-y-6">
          <OpportunityStagePanel
            leadId={lead.id}
            initialStage={data.opportunityStage}
            initialNotes={data.opportunityNotes}
            initialNextAction={data.opportunityNextAction}
          />

          {/* Campaign context */}
          {campaign && (
            <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>
                Won via Campaign
              </h2>
              <p className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>{campaign.name}</p>
              <div className="flex items-center gap-3 text-[11px] flex-wrap" style={{ color: C.textMuted }}>
                {campaign.sellerName && <span>Seller: <span className="font-semibold" style={{ color: C.textBody }}>{campaign.sellerName}</span></span>}
                {campaign.startedAt && <span>Started {formatDate(campaign.startedAt)}</span>}
              </div>
              {campaign.totalSteps > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px]" style={{ color: C.textMuted }}>
                      Sequence Progress · Step <span className="font-bold" style={{ color: C.textBody }}>{campaign.currentStep}</span> of {campaign.totalSteps}
                    </span>
                    <span className="text-[10px] font-bold tabular-nums" style={{ color: gold }}>{campProgressPct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${campProgressPct}%`, backgroundColor: gold }} />
                  </div>
                </div>
              )}
              <Link href={`/campaigns/${campaign.id}`} className="mt-4 flex items-center justify-center gap-1.5 w-full rounded-lg py-2 text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}>
                <Megaphone size={12} /> View Campaign Detail
              </Link>
            </div>
          )}
        </div>

        {/* RIGHT: Winning reply + full timeline (3 cols) */}
        <div className="col-span-3 space-y-6">
          {/* Winning reply highlight */}
          {win && win.replyText && (
            <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
                  style={{ backgroundColor: cls.bg, color: cls.color }}>
                  {cls.label}
                </span>
                <span className="text-[10px] flex items-center gap-1" style={{ color: winChMeta.color }}>
                  <WinChIcon size={11} /> via {winChMeta.label}
                </span>
                <span className="text-[10px] ml-auto" style={{ color: C.textDim }}>
                  {formatDate(win.receivedAt)} · {timeAgo(win.receivedAt)}
                </span>
              </div>
              <p className="text-base leading-relaxed italic" style={{ color: C.textBody }}>
                &ldquo;{win.replyText}&rdquo;
              </p>
              <p className="text-[11px] mt-3 pt-3 border-t" style={{ borderColor: C.border, color: C.textMuted }}>
                — {lead.fullName}
                {lead.role ? `, ${lead.role}` : ""}
                {lead.company ? ` at ${lead.company}` : ""}
              </p>
            </div>
          )}

          {/* Reply history (when there is more than the winning one) */}
          {replies.length > 1 && (
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="px-5 py-3 border-b" style={{ borderColor: C.border }}>
                <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Full Reply Timeline ({replies.length})</h2>
              </div>
              <div className="divide-y" style={{ borderColor: C.border }}>
                {replies.map((r: any) => {
                  const rCls = classColors[r.classification] ?? { color: C.textMuted, bg: C.surface, label: r.classification };
                  const rCh = channelMeta[r.channel] ?? channelMeta.email;
                  const RChIcon = rCh.icon;
                  return (
                    <div key={r.id} className="px-5 py-3 flex items-start gap-3" style={{ borderColor: C.border }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${rCh.color}15` }}>
                        <RChIcon size={13} style={{ color: rCh.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: rCls.bg, color: rCls.color }}>{rCls.label}</span>
                          <span className="text-[10px]" style={{ color: C.textDim }}>{formatDate(r.received_at)} · {timeAgo(r.received_at)}</span>
                        </div>
                        {r.reply_text && (
                          <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>&ldquo;{r.reply_text}&rdquo;</p>
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

      {/* Footer */}
      <div className="flex items-center justify-between rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Link href="/leads" className="text-xs font-medium hover:underline flex items-center gap-1" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} /> Back to Results
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/leads/${lead.id}`}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: C.blueLight, color: C.blue, border: `1px solid ${C.blue}30` }}>
            <Star size={12} /> Full Lead Detail
          </Link>
          {campaign && (
            <Link href={`/campaigns/${campaign.id}`}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ backgroundColor: gold, color: "#04070d" }}>
              <Megaphone size={12} /> View Campaign
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Legacy campaign rollup (only reached when id is a campaign id, not a lead) ─
function CampaignOpportunityRollup({ data }: { data: NonNullable<Awaited<ReturnType<typeof getCampaignRollup>>> }) {
  return (
    <div className="p-6 w-full max-w-5xl mx-auto">
      <Breadcrumb crumbs={[{ label: "Opportunities", href: "/opportunities" }, { label: data.name ?? "Detail" }]} />

      {/* ═══ HEADER ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.green }}>Campaign Rollup</p>
          <h1 className="text-2xl font-bold mb-2" style={{ color: C.textPrimary }}>{data.name}</h1>
          <div className="flex items-center gap-3 text-xs" style={{ color: C.textMuted }}>
            {data.profile && (
              <span className="flex items-center gap-1"><Target size={10} style={{ color: gold }} /> {(data.profile as { profile_name: string }).profile_name}</span>
            )}
            {data.seller && <span>· Seller: {data.seller}</span>}
            <span>· {data.sequence.length} steps</span>
          </div>
        </div>

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

      {/* Converted leads list */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Converted Leads ({data.convertedLeads.length})</h2>
          <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Click any to see their individual opportunity detail</p>
        </div>
        {data.convertedLeads.map((lead: any, i: number) => {
          const badge = scoreBadge(lead.score, lead.is_priority);
          const chMeta = channelMeta[lead.channel] ?? channelMeta.email;
          const ChIcon = chMeta.icon;
          return (
            <Link href={`/opportunities/${lead.id}`} key={lead.id}
              className="block transition-colors hover:bg-black/[0.015]" style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
              <div className="px-5 py-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: `linear-gradient(135deg, ${C.green}, #34D399)`, color: "#fff" }}>
                  {(lead.name[0] ?? "?").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{lead.name}</span>
                    {lead.is_priority && <Star size={10} fill={gold} stroke={gold} />}
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
                  </div>
                  <p className="text-xs" style={{ color: C.textMuted }}>
                    {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
                  </p>
                  {lead.winReplyText && (
                    <p className="text-xs mt-1 line-clamp-1 italic" style={{ color: C.textBody }}>&ldquo;{lead.winReplyText}&rdquo;</p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1.5 text-[10px]">
                  <ChIcon size={11} style={{ color: chMeta.color }} />
                  <span style={{ color: chMeta.color }}>{chMeta.label}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-xl border p-4 mt-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Link href="/leads" className="text-xs font-medium hover:underline flex items-center gap-1" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} /> Back to Results
        </Link>
        {data.campaignId && (
          <Link href={`/campaigns/${data.campaignId}`}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            <Megaphone size={12} /> View Campaign Detail
          </Link>
        )}
      </div>
    </div>
  );
}
