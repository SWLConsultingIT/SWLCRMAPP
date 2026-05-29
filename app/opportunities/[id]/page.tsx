import { getSupabaseServer } from "@/lib/supabase-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import { notFound } from "next/navigation";
import { C } from "@/lib/design";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, Star, ExternalLink, Trophy,
  Megaphone, Calendar, Hash, Share2 as Linkedin, Send, Sparkles,
  UserPlus, Reply, CheckCircle2, Clock,
} from "lucide-react";
import OpportunityStagePanel from "@/components/OpportunityStagePanel";
import PersonalizedInfoPanel from "@/components/PersonalizedInfoPanel";
import Breadcrumb from "@/components/Breadcrumb";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Linkedin, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,     color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,    color: "#F97316", label: "Call" },
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

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

async function getLeadOpportunity(id: string) {
  const supabase = await getSupabaseServer();
  const { data: rawLead } = await supabase
    .from("leads")
    .select(
      "id, source, encrypted_payload, company_bio_id, " +
      "primary_first_name, primary_last_name, primary_title_role, primary_seniority, primary_headline, " +
      "primary_work_email, primary_linkedin_url, primary_phone, primary_photo_url, " +
      "company_name, company_industry, " +
      "lead_score, is_priority, current_channel, transferred_to_odoo_at, " +
      "icp_profile_id, opportunity_stage, opportunity_notes, opportunity_next_action, " +
      "enrichment, created_at, status"
    )
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
  if (!isWon) return null;

  // Pull messages sent to this lead (the journey)
  const { data: messages } = rawCamp
    ? await supabase.from("campaign_messages")
        .select("id, step_number, channel, content, status, sent_at, metadata")
        .eq("campaign_id", rawCamp.id)
        .order("sent_at", { ascending: true, nullsFirst: false })
    : { data: [] as any[] };

  const daysToConvert = winReply?.received_at && lead.created_at
    ? Math.max(1, Math.round((new Date(winReply.received_at).getTime() - new Date(lead.created_at).getTime()) / 86400000))
    : null;

  const totalSteps = Array.isArray(rawCamp?.sequence_steps) ? rawCamp.sequence_steps.length : 0;

  // Build a unified chronological journey: lead created → messages sent →
  // replies received → transferred to CRM. The winning reply is flagged so
  // the renderer can highlight it.
  type JourneyEvent =
    | { kind: "created"; at: string }
    | { kind: "message"; at: string; channel: string; subject: string | null; body: string; stepNumber: number }
    | { kind: "reply"; at: string; channel: string; text: string | null; classification: string; isWin: boolean }
    | { kind: "transferred"; at: string };

  const journey: JourneyEvent[] = [];
  if (lead.created_at) journey.push({ kind: "created", at: lead.created_at });
  for (const m of (messages ?? []) as any[]) {
    if (m.status !== "sent" || !m.sent_at) continue;
    journey.push({
      kind: "message",
      at: m.sent_at,
      channel: m.channel ?? "email",
      subject: (m.metadata as any)?.subject ?? null,
      body: m.content ?? "",
      stepNumber: m.step_number ?? 0,
    });
  }
  for (const r of (replies ?? []) as any[]) {
    journey.push({
      kind: "reply",
      at: r.received_at,
      channel: r.channel ?? "email",
      text: r.reply_text,
      classification: r.classification,
      isWin: r.id === winReply?.id,
    });
  }
  if (lead.transferred_to_odoo_at) {
    journey.push({ kind: "transferred", at: lead.transferred_to_odoo_at });
  }
  journey.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    mode: "lead" as const,
    lead: {
      id: lead.id,
      firstName: lead.primary_first_name ?? null,
      lastName: lead.primary_last_name ?? null,
      fullName: `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown",
      role: lead.primary_title_role ?? null,
      seniority: lead.primary_seniority ?? null,
      headline: lead.primary_headline ?? null,
      company: lead.company_name ?? null,
      industry: lead.company_industry ?? null,
      email: lead.primary_work_email ?? null,
      linkedinUrl: lead.primary_linkedin_url ?? null,
      phone: lead.primary_phone ?? null,
      photoUrl: lead.primary_photo_url ?? null,
      score: lead.lead_score ?? null,
      isPriority: !!lead.is_priority,
      status: lead.status ?? null,
      createdAt: lead.created_at ?? null,
      transferred: !!lead.transferred_to_odoo_at,
      transferredAt: lead.transferred_to_odoo_at ?? null,
      enrichment: (lead.enrichment ?? null) as Record<string, unknown> | null,
    },
    win: winReply ? {
      replyText: winReply.reply_text ?? null,
      classification: winReply.classification,
      channel: winReply.channel ?? rawCamp?.channel ?? "email",
      receivedAt: winReply.received_at,
      daysToConvert,
      stepAtWin: rawCamp?.current_step ?? 0,
      totalSteps,
    } : null,
    campaign: rawCamp ? {
      id: rawCamp.id,
      name: rawCamp.name,
      sellerName: (rawCamp.sellers as any)?.name ?? null,
      startedAt: rawCamp.started_at ?? rawCamp.created_at ?? null,
    } : null,
    profile: profile ?? null,
    journey,
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

  const [{ data: rawLeads }, { data: allReplies }] = await Promise.all([
    supabase.from("leads")
      .select("id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, lead_score, is_priority, current_channel, transferred_to_odoo_at, icp_profile_id")
      .in("id", leadIds),
    supabase.from("lead_replies")
      .select("id, lead_id, classification, channel, reply_text, received_at")
      .in("lead_id", leadIds)
      .order("received_at", { ascending: true }),
  ]);
  const leads = await hydrateClientLeads((rawLeads ?? []) as Record<string, unknown>[]) as any[];

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
    };
  }).filter(Boolean) as any[];

  return {
    mode: "campaign" as const,
    name: pivotName, campaignId,
    totalLeads,
    converted: convertedLeads.length,
    transferred: convertedLeads.filter((l: any) => l.transferred).length,
    conversionRate: totalLeads > 0 ? Math.round((convertedLeads.length / totalLeads) * 100) : 0,
    convertedLeads,
    seller: ((allCampaigns ?? [])[0]?.sellers as any)?.name ?? null,
  };
}

async function getOpportunityData(id: string) {
  const lead = await getLeadOpportunity(id);
  if (lead) return lead;
  return await getCampaignRollup(id);
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getOpportunityData(id);
  if (!data) notFound();
  if (data.mode === "lead") return <LeadOpportunityDetail data={data} />;
  return <CampaignOpportunityRollup data={data} />;
}

// ── Lead-focused detail (default for Won card clicks) ──────────────────────
function LeadOpportunityDetail({ data }: { data: NonNullable<Awaited<ReturnType<typeof getLeadOpportunity>>> }) {
  const { lead, win, campaign, journey } = data;
  const badge = scoreBadge(lead.score, lead.isPriority);
  const winChMeta = win ? (channelMeta[win.channel] ?? channelMeta.email) : channelMeta.email;
  const WinChIcon = winChMeta.icon;
  const cls = win ? (classColors[win.classification] ?? classColors.positive) : classColors.positive;

  return (
    <div className="p-6 w-full max-w-6xl mx-auto">
      <Breadcrumb
        crumbs={[
          { label: "Results", href: "/results" },
          { label: "Won", href: "/results" },
          { label: lead.fullName },
        ]}
      />

      {/* ═══ HERO — the person ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.green }}>
        <div className="p-6 flex items-start gap-5">
          {/* Photo */}
          {lead.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lead.photoUrl} alt={lead.fullName}
              className="w-20 h-20 rounded-2xl object-cover shrink-0 border-2"
              style={{ borderColor: C.green }} />
          ) : (
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold shrink-0"
              style={{ background: `linear-gradient(135deg, ${C.green}, #34D399)`, color: "#fff" }}>
              {(lead.fullName[0] ?? "?").toUpperCase()}
            </div>
          )}
          {/* Identity */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: C.green }}>
              <Trophy size={11} className="inline mr-1 -mt-0.5" /> Won Opportunity
            </p>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{lead.fullName}</h1>
              {lead.isPriority && <Star size={14} fill={gold} stroke={gold} />}
              <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
              {lead.seniority && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded uppercase" style={{ backgroundColor: C.cardHov, color: C.textMuted }}>
                  {lead.seniority.replace("_", " ")}
                </span>
              )}
            </div>
            <p className="text-sm" style={{ color: C.textBody }}>
              {lead.role ?? "—"}
              {lead.role && lead.company ? " · " : ""}
              {lead.company && (
                <Link href={`/companies/${encodeURIComponent(lead.company)}`} className="font-semibold hover:underline" style={{ color: C.textPrimary }}>
                  {lead.company}
                </Link>
              )}
            </p>
            {lead.headline && (
              <p className="text-xs mt-1 italic line-clamp-1" style={{ color: C.textMuted }}>&ldquo;{lead.headline}&rdquo;</p>
            )}
            {/* Contact strip */}
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              {lead.linkedinUrl && (
                <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold hover:underline"
                  style={{ color: "#0A66C2" }}>
                  <Linkedin size={12} /> LinkedIn
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold hover:underline"
                  style={{ color: "#7C3AED" }}>
                  <Mail size={12} /> {lead.email}
                </a>
              )}
              {lead.phone && (
                <a href={`tel:${lead.phone}`}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold hover:underline"
                  style={{ color: "#F97316" }}>
                  <Phone size={12} /> {lead.phone}
                </a>
              )}
            </div>
          </div>
          {/* Status pill */}
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
              <span className="text-[10px]" style={{ color: C.textDim }}>Transferred {timeAgo(lead.transferredAt)}</span>
            )}
          </div>
        </div>

        {/* Quick stats row */}
        <div className="border-t grid grid-cols-4 divide-x" style={{ borderColor: C.border }}>
          {[
            { label: "Days to Convert", value: win?.daysToConvert != null ? `${win.daysToConvert}` : "—", color: gold, icon: Calendar },
            { label: "Replied at Step", value: win && win.totalSteps > 0 ? `${win.stepAtWin}/${win.totalSteps}` : "—", color: C.textBody, icon: Hash },
            { label: "Win Channel", value: winChMeta.label, color: winChMeta.color, icon: WinChIcon },
            { label: "Reply Type", value: cls.label, color: cls.color, icon: Sparkles },
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

      {/* ═══ THE WIN — single hero card ═══ */}
      {win && win.replyText && (
        <div className="rounded-xl border p-6 mb-6 relative overflow-hidden"
          style={{ backgroundColor: C.card, borderColor: C.green + "40", borderWidth: 1 }}>
          <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: C.green }} />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: C.greenLight, color: C.green }}>
              <Sparkles size={14} />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.green }}>
                The Winning Reply
              </p>
              <p className="text-[10px]" style={{ color: C.textMuted }}>
                {formatDateTime(win.receivedAt)} · {timeAgo(win.receivedAt)}
              </p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
              style={{ backgroundColor: cls.bg, color: cls.color }}>
              {cls.label}
            </span>
            <span className="text-[10px] flex items-center gap-1 ml-1" style={{ color: winChMeta.color }}>
              <WinChIcon size={11} /> via {winChMeta.label}
            </span>
          </div>
          <blockquote className="text-base leading-relaxed italic pl-4 border-l-2"
            style={{ borderColor: C.green, color: C.textBody }}>
            &ldquo;{win.replyText}&rdquo;
          </blockquote>
          <p className="text-[11px] mt-3" style={{ color: C.textMuted }}>
            — {lead.fullName}{lead.role ? `, ${lead.role}` : ""}{lead.company ? ` at ${lead.company}` : ""}
          </p>
        </div>
      )}

      {/* Inline campaign + ICP tag (small, not a card) */}
      {(campaign || data.profile) && (
        <div className="flex items-center gap-2 mb-6 flex-wrap text-[11px]" style={{ color: C.textMuted }}>
          <span>Won during</span>
          {campaign && (
            <Link href={`/campaigns/${campaign.id}`} className="font-semibold hover:underline" style={{ color: C.textBody }}>
              {campaign.name}
            </Link>
          )}
          {campaign?.sellerName && <span>· seller <span className="font-semibold" style={{ color: C.textBody }}>{campaign.sellerName}</span></span>}
          {campaign?.startedAt && <span>· started {formatDate(campaign.startedAt)}</span>}
          {data.profile && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: C.cardHov, color: C.textMuted }}>
              ICP: {(data.profile as { profile_name: string }).profile_name}
            </span>
          )}
        </div>
      )}

      {/* ═══ TWO COLUMNS ═══ */}
      <div className="grid grid-cols-5 gap-6 mb-6">

        {/* LEFT: Stage + Enrichment (2 cols) */}
        <div className="col-span-2 space-y-6">
          <OpportunityStagePanel
            leadId={lead.id}
            initialStage={data.opportunityStage}
            initialNotes={data.opportunityNotes}
            initialNextAction={data.opportunityNextAction}
          />
          <PersonalizedInfoPanel enrichment={lead.enrichment} />
        </div>

        {/* RIGHT: Journey timeline (3 cols) */}
        <div className="col-span-3">
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
              <div>
                <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Journey to Win</h2>
                <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                  Every touchpoint with {lead.firstName ?? "this lead"}, in order
                </p>
              </div>
              <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: C.cardHov, color: C.textMuted }}>
                {journey.length} events
              </span>
            </div>
            <JourneyTimeline events={journey} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Link href="/results" className="text-xs font-medium hover:underline flex items-center gap-1" style={{ color: C.textMuted }}>
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

// ── Journey timeline (per-lead chronological story) ────────────────────────
function JourneyTimeline({ events }: { events: any[] }) {
  if (events.length === 0) {
    return <div className="px-5 py-8 text-center text-xs" style={{ color: C.textDim }}>No events recorded.</div>;
  }
  return (
    <div className="relative">
      {/* Vertical rail */}
      <div className="absolute left-9 top-6 bottom-6 w-px" style={{ backgroundColor: C.border }} />
      <ul>
        {events.map((ev: any, idx) => {
          let bullet: { icon: typeof Send; color: string; bg: string };
          let title: React.ReactNode;
          let body: React.ReactNode = null;
          let highlight = false;

          if (ev.kind === "created") {
            bullet = { icon: UserPlus, color: C.textMuted, bg: C.cardHov };
            title = <span className="text-xs" style={{ color: C.textBody }}>Lead added to pipeline</span>;
          } else if (ev.kind === "message") {
            const meta = channelMeta[ev.channel] ?? channelMeta.email;
            bullet = { icon: Send, color: meta.color, bg: `color-mix(in srgb, ${meta.color} 12%, transparent)` };
            title = (
              <span className="text-xs" style={{ color: C.textBody }}>
                <span className="font-semibold" style={{ color: meta.color }}>{meta.label}</span> message sent
                <span className="ml-1" style={{ color: C.textMuted }}>· Step {ev.stepNumber}</span>
              </span>
            );
            body = ev.body ? (
              <div className="mt-2 rounded-lg border px-3 py-2.5" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                {ev.subject && (
                  <p className="text-[11px] font-semibold mb-1" style={{ color: C.textBody }}>
                    Subject: <span className="font-normal" style={{ color: C.textBody }}>{ev.subject}</span>
                  </p>
                )}
                <p className="text-[11px] leading-relaxed line-clamp-4 whitespace-pre-line" style={{ color: C.textMuted }}>
                  {ev.body}
                </p>
              </div>
            ) : null;
          } else if (ev.kind === "reply") {
            const meta = channelMeta[ev.channel] ?? channelMeta.email;
            const cls = classColors[ev.classification] ?? classColors.positive;
            bullet = ev.isWin
              ? { icon: Trophy, color: "#fff", bg: C.green }
              : { icon: Reply, color: meta.color, bg: `color-mix(in srgb, ${meta.color} 12%, transparent)` };
            highlight = !!ev.isWin;
            title = (
              <span className="text-xs flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold" style={{ color: ev.isWin ? C.green : C.textBody }}>
                  {ev.isWin ? "🏆 Winning reply" : "Reply received"}
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: cls.bg, color: cls.color }}>{cls.label}</span>
                <span className="text-[10px]" style={{ color: meta.color }}>via {meta.label}</span>
              </span>
            );
            body = ev.text ? (
              <div className="mt-2 rounded-lg px-3 py-2.5 border"
                style={{ backgroundColor: ev.isWin ? C.greenLight : C.bg, borderColor: ev.isWin ? C.green + "40" : C.border }}>
                <p className="text-[11px] leading-relaxed italic" style={{ color: C.textBody }}>&ldquo;{ev.text}&rdquo;</p>
              </div>
            ) : null;
          } else if (ev.kind === "transferred") {
            bullet = { icon: CheckCircle2, color: "#fff", bg: C.green };
            title = (
              <span className="text-xs font-semibold" style={{ color: C.green }}>
                Transferred to CRM
              </span>
            );
          } else {
            bullet = { icon: Clock, color: C.textMuted, bg: C.cardHov };
            title = <span className="text-xs" style={{ color: C.textBody }}>Event</span>;
          }

          const BIcon = bullet.icon;
          return (
            <li key={idx} className="relative px-5 py-3 flex gap-4">
              <div className="relative shrink-0 z-10">
                <div className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: bullet.bg, boxShadow: `0 0 0 3px ${C.card}` }}>
                  <BIcon size={14} style={{ color: bullet.color }} />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  {title}
                  <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.textDim }}>
                    {formatDate(ev.at)} · {timeAgo(ev.at)}
                  </span>
                </div>
                {body}
                {highlight && (
                  <p className="text-[10px] mt-2 font-semibold" style={{ color: C.green }}>
                    🎯 This is the moment the deal turned.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Legacy campaign rollup (reached only when id matches a campaign id) ────
function CampaignOpportunityRollup({ data }: { data: NonNullable<Awaited<ReturnType<typeof getCampaignRollup>>> }) {
  return (
    <div className="p-6 w-full max-w-5xl mx-auto">
      <Breadcrumb crumbs={[{ label: "Opportunities", href: "/opportunities" }, { label: data.name ?? "Detail" }]} />

      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.green }}>Campaign Rollup</p>
          <h1 className="text-2xl font-bold mb-2" style={{ color: C.textPrimary }}>{data.name}</h1>
          {data.seller && <p className="text-xs" style={{ color: C.textMuted }}>Seller: {data.seller}</p>}
        </div>
        <div className="border-t grid grid-cols-4 divide-x" style={{ borderColor: C.border }}>
          {[
            { label: "Total Leads",    value: data.totalLeads,           color: C.textBody },
            { label: "Converted",      value: data.converted,            color: C.green },
            { label: "Conversion",     value: `${data.conversionRate}%`, color: data.conversionRate >= 20 ? C.green : "#D97706" },
            { label: "Transferred",    value: data.transferred,          color: C.accent },
          ].map(s => (
            <div key={s.label} className="px-5 py-4 text-center" style={{ borderColor: C.border }}>
              <p className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

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
        <Link href="/results" className="text-xs font-medium hover:underline flex items-center gap-1" style={{ color: C.textMuted }}>
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
