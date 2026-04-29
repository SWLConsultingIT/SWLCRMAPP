import { getSupabaseServer } from "@/lib/supabase-server";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Mail, Phone, Building2,
  ExternalLink, CheckCircle2,
} from "lucide-react";
import { LinkedInIcon } from "@/components/SocialIcons";
import CompanyTabs from "@/components/CompanyTabs";
import ActivityTimeline from "@/components/ActivityTimeline";
import CampaignJourney from "@/components/CampaignJourney";
import DeleteLeadButton from "@/components/DeleteLeadButton";
import Breadcrumb from "@/components/Breadcrumb";
import SyncAircallButton from "@/components/SyncAircallButton";
import CallButton from "@/components/CallButton";
import CallCard from "@/components/CallCard";
import PersonalizedInfoPanel from "@/components/PersonalizedInfoPanel";
import LeadSummaryTab from "@/components/LeadSummaryTab";
import LeadStatsBar from "@/components/LeadStatsBar";

const gold = "var(--brand, #c9a83a)";
const goldLight = "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)";

// ── Data fetchers ──

async function getLead(id: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from("leads").select("*").eq("id", id).single();
  return data;
}

async function getCampaign(leadId: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("id, name, channel, status, current_step, sequence_steps, started_at, next_step_due_at, paused_until, completed_at, aircall_number_id, sellers(name)")
    .eq("lead_id", leadId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function getMessages(leadId: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaign_messages")
    .select("id, campaign_id, step_number, channel, content, status, sent_at")
    .eq("lead_id", leadId)
    .order("step_number", { ascending: true });
  return data ?? [];
}

async function getReplies(leadId: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("lead_replies")
    .select("id, campaign_id, channel, reply_text, received_at, classification, ai_confidence, requires_human_review")
    .eq("lead_id", leadId)
    .order("received_at", { ascending: false });
  return data ?? [];
}

async function getCalls(leadId: string) {
  const key = process.env.SUPABASE_SERVICE_KEY!;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const res = await fetch(
    `${url}/rest/v1/calls?lead_id=eq.${leadId}&order=started_at.desc&select=id,aircall_call_id,direction,status,duration,phone_number,recording_url,transcript,notes,started_at,ended_at,classification,ai_confidence,ai_summary`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
  );
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

// ── Helpers ──

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT",    color: C.hot,    bg: C.hotBg };
  if (score && score >= 50)               return { label: "WARM",   color: C.warm,   bg: C.warmBg };
  return                                         { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  new:           { label: "New",           color: C.blue,      bg: C.blueLight },
  contacted:     { label: "Contacted",     color: C.orange,    bg: C.orangeLight },
  connected:     { label: "Connected",     color: C.accent,    bg: C.accentLight },
  responded:     { label: "Responded",     color: C.green,     bg: C.greenLight },
  qualified:     { label: "Qualified",     color: C.green,     bg: C.greenLight },
  proposal_sent: { label: "Proposal Sent", color: C.accent,    bg: C.accentLight },
  closed_won:    { label: "Won",           color: C.green,     bg: C.greenLight },
  closed_lost:   { label: "Lost",          color: C.red,       bg: C.redLight },
  nurturing:     { label: "Nurturing",     color: C.textMuted, bg: C.surface },
};

// Score ring SVG
function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(score, 100) / 100) * circ;
  return (
    <div className="relative w-14 h-14 flex items-center justify-center">
      <svg width="56" height="56" className="absolute -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke={C.border} strokeWidth="3.5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="text-center z-10">
        <p className="text-sm font-bold leading-none" style={{ color: C.textPrimary }}>{score}</p>
        <p style={{ color: C.textDim, fontSize: 8, letterSpacing: "0.05em" }}>SCORE</p>
      </div>
    </div>
  );
}

// Channel permission row
const CHANNELS = [
  { key: "allow_linkedin",  icon: <LinkedInIcon size={14} />,     activeColor: "#0A66C2" },
  { key: "allow_email",     icon: <span className="text-sm">✉️</span>, activeColor: C.green },
  { key: "allow_call",      icon: <span className="text-sm">📱</span>, activeColor: C.phone },
  { key: "allow_whatsapp",  icon: <span className="text-sm">💬</span>, activeColor: "#25D366" },
  { key: "allow_instagram", icon: <span className="text-sm">📸</span>, activeColor: "#E1306C" },
  { key: "allow_sms",       icon: <span className="text-sm">💬</span>, activeColor: C.blue },
];

// ── Page ──

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  const [campaign, messages, replies, calls] = await Promise.all([
    getCampaign(id),
    getMessages(id),
    getReplies(id),
    getCalls(id),
  ]);

  const score = scoreBadge(lead.lead_score, lead.is_priority);
  const st = statusMap[lead.status] ?? statusMap.new;
  const initials = `${(lead.primary_first_name ?? "?")[0]}${(lead.primary_last_name ?? "?")[0]}`.toUpperCase();
  const avatarBg = score.label === "HOT" ? gold : score.label === "WARM" ? "#334155" : "#9CA3AF";

  const totalMsgsSent = messages.filter((m: any) => m.status === "sent").length;
  const totalReplies = replies.length;
  const positiveReplies = replies.filter((r: any) => ["positive", "meeting_intent"].includes(r.classification ?? "")).length;
  // Step progress data
  const channelStepLabels: Record<string, string> = {
    linkedin: "LinkedIn", email: "Email", call: "Call",
    whatsapp: "WhatsApp", sms: "SMS", instagram: "Instagram",
  };
  const rawSteps: any[] = campaign?.sequence_steps ?? [];
  const steps = rawSteps.map((s: any) => {
    if (typeof s === 'string') return channelStepLabels[s.toLowerCase()] ?? s;
    if (s?.channel) return channelStepLabels[s.channel.toLowerCase()] ?? s.channel;
    return 'Unknown';
  });
  const currentStep = campaign?.current_step ?? 0;
  const campDone = campaign?.status === 'completed' || campaign?.status === 'failed';
  const stepPct = campDone ? 100 : steps.length > 0 ? Math.round((currentStep / steps.length) * 100) : 0;
  const campMsgsForStepper = campaign
    ? messages.filter((m: any) => m.campaign_id === campaign.id).sort((a: any, b: any) => (a.step_number ?? 0) - (b.step_number ?? 0))
    : [];

  // Build activity items scoped to this lead only
  type ActivityItem = {
    id: string; type: "message_sent" | "reply" | "campaign_start" | "lead_created";
    contactName: string; channel: string; content: string | null; timestamp: string;
    stepNumber?: number; classification?: string; aiConfidence?: number; requiresReview?: boolean; sellerName?: string;
  };

  const contactName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
  const activityItems: ActivityItem[] = [];

  messages.filter((m: any) => m.status === "sent").forEach((m: any) => {
    activityItems.push({
      id: m.id, type: "message_sent",
      contactName,
      channel: m.channel ?? campaign?.channel ?? "email",
      content: m.content ?? null,
      timestamp: m.sent_at,
      stepNumber: m.step_number,
    });
  });

  replies.forEach((r: any) => {
    activityItems.push({
      id: r.id, type: "reply",
      contactName,
      channel: r.channel ?? "email",
      content: r.reply_text,
      timestamp: r.received_at,
      classification: r.classification,
      aiConfidence: r.ai_confidence,
      requiresReview: r.requires_human_review,
    });
  });

  if (campaign?.started_at) {
    activityItems.push({
      id: `camp-${campaign.id}`, type: "campaign_start",
      contactName,
      channel: campaign.channel ?? "email",
      content: campaign.name,
      timestamp: campaign.started_at,
      sellerName: (campaign as any).sellers?.name,
    });
  }

  activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const teamNotes: { author: string; text: string; time: string }[] = [];
  if (lead.seller_notes) {
    teamNotes.push({ author: lead.assigned_seller ?? "Team", text: lead.seller_notes, time: "Recently" });
  }

  const keywords = lead.keywords ? lead.keywords.split(",").map((k: string) => k.trim()).filter(Boolean) : [];
  const technologies: string[] = lead.organization_technologies ?? [];

  return (
    <div className="p-6 w-full fade-in">

      <Breadcrumb crumbs={[{ label: "Leads & Campaigns", href: "/leads" }, { label: lead.company_name ?? "Contact" }, { label: contactName }]} />

      {/* ═══ CONTACT HEADER ═══ */}
      <div
        className="rounded-2xl border mb-6 relative overflow-hidden"
        style={{
          backgroundColor: C.card,
          borderColor: C.border,
          boxShadow: "0 8px 32px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)",
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${gold} 30%, color-mix(in srgb, ${gold} 72%, white) 50%, ${gold} 70%, transparent 100%)`,
          }}
        />

        {/* Main row */}
        <div className="p-6 flex items-start justify-between gap-6">

          {/* Left: Avatar + Name + Badges */}
          <div className="flex items-start gap-4 flex-1">
            {/* Avatar */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-lg font-bold text-white shrink-0"
              style={{
                background: `linear-gradient(135deg, ${avatarBg}, color-mix(in srgb, ${avatarBg} 75%, white))`,
                boxShadow: `0 6px 20px color-mix(in srgb, ${avatarBg} 28%, transparent)`,
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
              }}
            >
              {initials}
            </div>

            {/* Name block */}
            <div>
              <h1
                className="text-[22px] font-bold leading-tight"
                style={{
                  color: C.textPrimary,
                  fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  letterSpacing: "-0.02em",
                }}
              >
                {lead.primary_first_name} {lead.primary_last_name}
              </h1>
              <p className="text-sm mt-0.5" style={{ color: C.textMuted }}>
                {lead.primary_title_role ?? "—"}
              </p>
              {lead.company_name && (
                <Link href={`/companies/${encodeURIComponent(lead.company_name)}`}
                  className="flex items-center gap-1.5 text-sm mt-1 hover:underline"
                  style={{ color: C.blue }}>
                  <Building2 size={12} style={{ color: C.textDim }} />
                  {lead.company_name}
                  <ExternalLink size={10} style={{ opacity: 0.6 }} />
                </Link>
              )}
              {/* Badges row */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{ color: st.color, backgroundColor: st.bg }}>
                  {st.label.toUpperCase()}
                </span>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{ color: score.color, backgroundColor: score.bg }}>
                  {score.label}
                </span>
                {lead.assigned_seller && (
                  <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
                    style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.bg }}>
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: gold, fontSize: 9 }}>
                      {lead.assigned_seller[0]}
                    </div>
                    {lead.assigned_seller}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Score ring + Channel icons */}
          <div className="flex items-start gap-6 shrink-0">
            {/* Channel permission icons */}
            <div className="flex items-center gap-1.5">
              {CHANNELS.map(ch => {
                const allowed = lead[ch.key] !== false;
                return (
                  <div key={ch.key}
                    className="w-8 h-8 rounded-full flex items-center justify-center border relative"
                    title={ch.key.replace("allow_", "")}
                    style={{
                      backgroundColor: allowed ? "#F0FDF4" : "#F9FAFB",
                      borderColor: allowed ? "#BBF7D0" : C.border,
                      opacity: allowed ? 1 : 0.45,
                    }}>
                    {ch.icon}
                    {allowed && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: C.green }}>
                        <span style={{ color: "#fff", fontSize: 7, lineHeight: 1 }}>✓</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Score ring */}
            {lead.lead_score > 0 && (
              <ScoreRing score={lead.lead_score} color={score.color} />
            )}

            {/* Call */}
            {lead.primary_phone && (
              <CallButton phone={lead.primary_phone} leadId={id} size="sm" defaultNumberId={campaign?.aircall_number_id ?? null} />
            )}

            {/* Delete */}
            <DeleteLeadButton leadId={id} leadName={contactName} />
          </div>
        </div>

        <LeadStatsBar
          totalMsgsSent={totalMsgsSent}
          totalReplies={totalReplies}
          positiveReplies={positiveReplies}
          campaignStep={campaign ? `${currentStep}/${steps.length}` : "—"}
        />
      </div>

      {/* ═══ CAMPAIGN STEP PROGRESS (horizontal stepper) ═══ */}
      {steps.length > 0 ? (
        <div className="rounded-2xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider" style={{ color: C.textPrimary, letterSpacing: "0.08em" }}>
                Campaign Step Progress
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs" style={{ color: C.textMuted }}>
                  {campaign!.name ?? "Outreach Campaign"}
                </p>
                {campaign && (
                  <Link href={`/campaigns/${campaign.id}`}
                    className="text-[10px] font-semibold hover:underline flex items-center gap-1" style={{ color: gold }}>
                    View campaign <ExternalLink size={10} />
                  </Link>
                )}
              </div>
            </div>
            <span className="text-base font-bold italic" style={{ color: gold }}>
              {stepPct}% Complete
            </span>
          </div>

          {/* Horizontal stepper */}
          <div className="relative flex items-start justify-between px-4">
            {steps.map((stepLabel: string, idx: number) => {
              const stepNum = idx + 1;
              const isCurrent = stepNum === currentStep;
              const isCompleted = stepNum < currentStep;
              const msg = campMsgsForStepper.find((m: any) => m.step_number === stepNum);

              return (
                <div key={idx} className="flex flex-col items-center relative" style={{ flex: 1, minWidth: 100 }}>
                  {/* Connector line */}
                  {idx > 0 && (
                    <div className="absolute"
                      style={{
                        top: 33,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: stepNum <= currentStep ? gold : "#D1D5DB",
                        left: "-50%",
                        width: "100%",
                        zIndex: 0,
                      }} />
                  )}

                  {/* Node */}
                  <div className="relative z-10 mb-3 flex items-center justify-center" style={{ height: 68 }}>
                    {isCompleted ? (
                      <div className="rounded-full flex items-center justify-center"
                        style={{ width: 48, height: 48, backgroundColor: "#DCFCE7" }}>
                        <CheckCircle2 size={26} style={{ color: "#22C55E" }} />
                      </div>
                    ) : isCurrent ? (
                      <div className="rounded-full flex items-center justify-center"
                        style={{ width: 68, height: 68, border: `3.5px solid ${gold}`, backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 5%, transparent)" }}>
                        <div className="rounded-full flex items-center justify-center font-bold"
                          style={{ width: 44, height: 44, border: `2.5px solid ${gold}`, color: "#5A4A1E", backgroundColor: "#fff", fontSize: 18 }}>
                          {String(stepNum).padStart(2, "0")}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-full"
                        style={{ width: 40, height: 40, backgroundColor: "#D1D5DB" }} />
                    )}
                  </div>

                  {/* Label */}
                  <p className="text-center leading-tight px-1"
                    style={{
                      color: isCurrent ? C.textPrimary : isCompleted ? C.textBody : "#9CA3AF",
                      fontWeight: isCurrent ? 700 : isCompleted ? 500 : 400,
                      fontSize: isCurrent ? 13 : 12,
                    }}>
                    {stepLabel}
                  </p>

                  {/* Date under current step */}
                  {isCurrent && (
                    <p className="text-xs text-center mt-1" style={{ color: C.textMuted }}>
                      {msg?.sent_at
                        ? new Date(msg.sent_at).toLocaleDateString("en-GB", { month: "short", day: "numeric" })
                        : "In progress"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="mt-6 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
            <div className="h-1.5 rounded-full transition-[opacity,transform,box-shadow,background-color,border-color]" style={{ width: `${stepPct}%`, backgroundColor: gold }} />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider" style={{ color: C.textPrimary, letterSpacing: "0.08em" }}>
                Campaign Step Progress
              </p>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                {campaign
                  ? `${campaign.name ?? "Campaign"} — no sequence steps defined yet`
                  : "No campaign assigned to this contact yet"}
              </p>
            </div>
            <span className="text-base font-bold italic" style={{ color: C.textDim }}>
              0% Complete
            </span>
          </div>
          <div className="mt-5 h-1.5 rounded-full" style={{ backgroundColor: C.border }} />
        </div>
      )}

      {/* ═══ TABS ═══ */}
      <CompanyTabs tabs={[
        { label: "Profile Overview" },
        { label: "Summary" },
        { label: "Campaign" },
        { label: "Recent Activity",  count: activityItems.length },
        { label: "Social & Content" },
        { label: "Calls", count: calls.length || undefined },
      ]}>

        {/* ── TAB 1: Profile Overview ── */}
        <div className="grid grid-cols-[1fr_340px] gap-5">

          {/* LEFT — About the Person */}
          <div className="space-y-5">

            {/* About This Person */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>About This Person</h3>

              {/* Role + Seniority */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 p-3 rounded-lg" style={{ backgroundColor: C.bg }}>
                  <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: C.textDim, fontSize: 10 }}>Role / Title</p>
                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{lead.primary_title_role ?? "—"}</p>
                </div>
                <div className="p-3 rounded-lg" style={{ backgroundColor: C.bg }}>
                  <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: C.textDim, fontSize: 10 }}>Seniority</p>
                  <span className="text-xs font-bold px-2.5 py-1 rounded"
                    style={{ backgroundColor: goldLight, color: gold }}>
                    {lead.primary_seniority?.replace("_", " ").toUpperCase() ?? "—"}
                  </span>
                </div>
              </div>

              {/* LinkedIn Headline */}
              {lead.primary_headline && (
                <div className="flex items-center gap-2.5 mb-4 px-3 py-2.5 rounded-lg" style={{ backgroundColor: C.bg }}>
                  <span className="shrink-0"><LinkedInIcon size={14} /></span>
                  <p className="text-sm leading-relaxed" style={{ color: C.textBody }}>{lead.primary_headline}</p>
                </div>
              )}

              {/* Contact methods */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {lead.primary_work_email && (
                  <div className="flex items-center gap-2.5 p-3 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <Mail size={14} style={{ color: C.email }} />
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: C.textDim, fontSize: 10 }}>Email</p>
                      <a href={`mailto:${lead.primary_work_email}`} className="text-sm font-medium hover:underline block truncate"
                        style={{ color: C.textBody }}>{lead.primary_work_email}</a>
                    </div>
                  </div>
                )}
                {lead.primary_phone && (
                  <div className="flex items-center gap-2.5 p-3 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <Phone size={14} style={{ color: C.phone }} />
                    <div>
                      <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: C.textDim, fontSize: 10 }}>Mobile</p>
                      <a href={`tel:${lead.primary_phone}`} className="text-sm font-medium hover:underline"
                        style={{ color: C.textBody }}>{lead.primary_phone}</a>
                    </div>
                  </div>
                )}
                {lead.primary_linkedin_url && (
                  <div className="flex items-center gap-2.5 p-3 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <LinkedInIcon size={14} />
                    <div>
                      <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: C.textDim, fontSize: 10 }}>LinkedIn</p>
                      <a href={lead.primary_linkedin_url} target="_blank" rel="noopener"
                        className="text-sm font-medium hover:underline flex items-center gap-1"
                        style={{ color: "#0A66C2" }}>View Profile <ExternalLink size={11} /></a>
                    </div>
                  </div>
                )}
              </div>

              {/* Assigned Seller + Channel permissions */}
              <div className="flex items-center gap-4 pt-4 border-t" style={{ borderColor: C.border }}>
                {lead.assigned_seller && (
                  <div className="flex items-center gap-2.5 pr-4 border-r" style={{ borderColor: C.border }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
                      style={{ backgroundColor: gold }}>
                      {lead.assigned_seller[0]}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wider" style={{ color: C.textDim, fontSize: 10 }}>Seller</p>
                      <p className="text-sm font-semibold" style={{ color: C.textBody }}>{lead.assigned_seller}</p>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs uppercase tracking-wider mb-1.5" style={{ color: C.textDim, fontSize: 10 }}>Channels</p>
                  <div className="flex items-center gap-2">
                    {[
                      { key: "allow_linkedin",  label: "LinkedIn",  icon: <LinkedInIcon size={15} /> },
                      { key: "allow_email",     label: "Email",     icon: <span style={{ fontSize: 14 }}>✉️</span> },
                      { key: "allow_call",      label: "Call",      icon: <span style={{ fontSize: 14 }}>📱</span> },
                      { key: "allow_whatsapp",  label: "WhatsApp",  icon: <span style={{ fontSize: 14 }}>💬</span> },
                      { key: "allow_instagram", label: "Instagram", icon: <span style={{ fontSize: 14 }}>📸</span> },
                      { key: "allow_sms",       label: "SMS",       icon: <span style={{ fontSize: 14 }}>💬</span> },
                    ].map(ch => {
                      const allowed = lead[ch.key] !== false;
                      return (
                        <div key={ch.key} title={`${ch.label}: ${allowed ? "Allowed" : "Blocked"}`}
                          className="w-9 h-9 rounded-full flex items-center justify-center border"
                          style={{
                            backgroundColor: allowed ? "#F0FDF4" : "#F9FAFB",
                            borderColor: allowed ? "#BBF7D0" : C.border,
                            opacity: allowed ? 1 : 0.4,
                          }}>
                          {ch.icon}
                        </div>
                  );
                })}
                  </div>
                </div>
              </div>
            </div>

            {/* Personalized Info — client-specific enrichment (Pathway: credit signals) */}
            <PersonalizedInfoPanel enrichment={lead.enrichment} />

            {/* Company Info */}
            {lead.company_name && (
              <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Company</h3>
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold shrink-0"
                    style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                    {lead.company_name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/companies/${encodeURIComponent(lead.company_name)}`}
                      className="text-sm font-bold hover:underline flex items-center gap-1"
                      style={{ color: C.textPrimary }}>
                      {lead.company_name} <ExternalLink size={10} style={{ color: C.textDim }} />
                    </Link>
                    <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                      {[lead.company_industry, lead.company_sub_industry].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-3">
                  {[
                    { label: "Location", value: [lead.company_city, lead.company_country].filter(Boolean).join(", ") || null },
                    { label: "Employees", value: lead.employees ?? lead.company_employee_count ?? null },
                    { label: "Revenue", value: lead.annual_revenue ? `$${lead.annual_revenue}` : null },
                  ].filter(f => f.value).map(f => (
                    <div key={f.label} className="p-2.5 rounded-lg" style={{ backgroundColor: C.bg }}>
                      <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{f.label}</p>
                      <p className="text-xs font-semibold" style={{ color: C.textBody }}>{f.value}</p>
                    </div>
                  ))}
                </div>

                {lead.organization_description && (
                  <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>{lead.organization_description}</p>
                )}

                {lead.company_website && (
                  <a href={lead.company_website.startsWith("http") ? lead.company_website : `https://${lead.company_website}`}
                    target="_blank" rel="noopener"
                    className="text-xs font-medium hover:underline flex items-center gap-1 mt-2"
                    style={{ color: C.blue }}>
                    {lead.company_website} <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )}

            {/* Tech Stack & Keywords */}
            {(technologies.length > 0 || keywords.length > 0) && (
              <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Tech Stack & Keywords</h3>
                {technologies.length > 0 && (
                  <div className={keywords.length > 0 ? "mb-4" : ""}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>Technologies</p>
                    <div className="flex flex-wrap gap-2">
                      {technologies.map((t: string) => (
                        <span key={t} className="text-xs font-medium px-2.5 py-1 rounded-lg"
                          style={{ backgroundColor: C.blueLight, color: C.blue }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {keywords.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>Keywords & Topics</p>
                    <div className="flex flex-wrap gap-2">
                      {keywords.map((k: string) => (
                        <span key={k} className="text-xs font-medium px-2.5 py-1 rounded-lg"
                          style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Industry Context */}
            {lead.industry_trends && (
              <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Industry Context</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.textBody }}>{lead.industry_trends}</p>
              </div>
            )}

            {/* Social Activity — this person's posts */}
            {(lead.recent_linkedin_post || lead.recent_ig_post || lead.twitter_last_posts) && (
              <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Recent Social Activity</h3>
                <div className="space-y-3">
                  {lead.recent_linkedin_post && (
                    <div className="flex gap-3 p-3 rounded-lg" style={{ backgroundColor: C.bg }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#EFF6FF" }}>
                        <LinkedInIcon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold mb-1" style={{ color: "#0A66C2" }}>LinkedIn</p>
                        <p className="text-sm leading-relaxed line-clamp-3" style={{ color: C.textBody }}>{lead.recent_linkedin_post}</p>
                      </div>
                    </div>
                  )}
                  {lead.recent_ig_post && (
                    <div className="flex gap-3 p-3 rounded-lg" style={{ backgroundColor: C.bg }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#FDF2F8" }}>
                        <span style={{ fontSize: 14 }}>📸</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold mb-1" style={{ color: "#E1306C" }}>Instagram</p>
                        <p className="text-sm leading-relaxed line-clamp-3" style={{ color: C.textBody }}>{lead.recent_ig_post}</p>
                      </div>
                    </div>
                  )}
                  {lead.twitter_last_posts && (
                    <div className="flex gap-3 p-3 rounded-lg" style={{ backgroundColor: C.bg }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: C.surface }}>
                        <span style={{ fontSize: 13 }}>𝕏</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold mb-1" style={{ color: C.textPrimary }}>X / Twitter</p>
                        <p className="text-sm leading-relaxed line-clamp-3" style={{ color: C.textBody }}>{lead.twitter_last_posts}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}


          </div>

          {/* RIGHT SIDEBAR */}
          <div className="space-y-5">

            {/* Lead Source */}
            {(lead.source_universe || lead.source_tool) && (
              <div className="rounded-2xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Lead Source</h3>
                <div className="space-y-2 text-sm">
                  {lead.source_tool && (
                    <div className="flex items-center justify-between">
                      <span style={{ color: C.textMuted }}>Tool</span>
                      <span className="font-medium" style={{ color: C.textBody }}>{lead.source_tool}</span>
                    </div>
                  )}
                  {lead.source_universe && (
                    <div className="flex items-center justify-between">
                      <span style={{ color: C.textMuted }}>Universe</span>
                      <span className="font-medium" style={{ color: C.textBody }}>{lead.source_universe}</span>
                    </div>
                  )}
                  {lead.created_at && (
                    <div className="flex items-center justify-between">
                      <span style={{ color: C.textMuted }}>Created</span>
                      <span className="font-medium" style={{ color: C.textBody }}>
                        {new Date(lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Career / Education */}
            {lead.primary_career && (
              <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Career & Education</h3>
                <div className="space-y-0">
                  {lead.primary_career.split("\n").filter(Boolean).map((item: string, idx: number) => (
                    <div key={idx} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ backgroundColor: goldLight, color: gold, border: `1.5px solid ${gold}` }}>
                          {idx + 1}
                        </div>
                        {idx < lead.primary_career.split("\n").filter(Boolean).length - 1 && (
                          <div className="flex-1 w-px my-1" style={{ backgroundColor: C.border, minHeight: 12 }} />
                        )}
                      </div>
                      <p className="text-sm leading-relaxed pb-3" style={{ color: C.textBody, paddingTop: 3 }}>
                        {item.replace(/^[•\-]\s*/, "")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Website Intelligence */}
            {(lead.website_summary || lead.recent_website_news) && (
              <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Website Intelligence</h3>
                {lead.website_summary && (
                  <div className="mb-3">
                    <p className="text-xs font-medium mb-1" style={{ color: C.textDim }}>Services</p>
                    <div className="flex flex-wrap gap-1.5">
                      {lead.website_summary.split(",").map((s: string) => s.trim()).filter(Boolean).map((s: string) => (
                        <span key={s} className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: C.bg, color: C.textBody }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {lead.recent_website_news && (
                  <div className="p-3 rounded-lg" style={{ backgroundColor: "#FFFBEB", borderLeft: "3px solid #F59E0B" }}>
                    <p className="text-xs font-bold mb-1" style={{ color: "#D97706" }}>Recent News</p>
                    <p className="text-sm leading-relaxed" style={{ color: C.textBody }}>{lead.recent_website_news}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── TAB 2: Summary ── */}
        <LeadSummaryTab
          leadId={id}
          initialSummary={lead.ai_summary ?? null}
          initialGeneratedAt={lead.ai_summary_at ?? null}
        />

        {/* ── TAB 3: Campaign ── */}
        <CampaignJourney campaign={campaign as any} messages={messages as any} replies={replies as any} />

        {/* ── TAB 3: Recent Activity ── */}
        <ActivityTimeline activities={activityItems as any} notes={teamNotes} leadId={id} />

        {/* ── TAB 4: Social & Content ── */}
        <div className="space-y-5">

          {/* Social Feed */}
          {[
            lead.recent_linkedin_post && {
              platform: "LinkedIn",
              icon: <LinkedInIcon size={16} />,
              color: "#0A66C2",
              bg: "#EFF6FF",
              content: lead.recent_linkedin_post,
              handle: lead.primary_linkedin_url ? `@${contactName.split(" ")[0].toLowerCase()}` : null,
            },
            lead.recent_ig_post && {
              platform: "Instagram",
              icon: <span style={{ fontSize: 15 }}>📸</span>,
              color: "#E1306C",
              bg: "#FDF2F8",
              content: lead.recent_ig_post,
              handle: lead.primary_instagram ? `@${lead.primary_instagram}` : null,
            },
            lead.twitter_last_posts && {
              platform: "X / Twitter",
              icon: <span style={{ fontSize: 14, fontWeight: 800 }}>𝕏</span>,
              color: "#111827",
              bg: C.surface,
              content: lead.twitter_last_posts,
              handle: lead.twitter_url ? `@${lead.twitter_url.split("/").pop()}` : null,
            },
            lead.company_blog && {
              platform: "Company Blog",
              icon: <span style={{ fontSize: 14 }}>📝</span>,
              color: C.accent,
              bg: "#F0FDFA",
              content: lead.company_blog,
              handle: lead.company_name,
            },
            lead.company_posts_content && {
              platform: "Company Post",
              icon: <span style={{ fontSize: 14 }}>🏢</span>,
              color: gold,
              bg: goldLight,
              content: lead.company_posts_content,
              handle: lead.company_name,
            },
          ].filter(Boolean).length > 0 ? (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider px-1" style={{ color: C.textMuted }}>Scraped Social Content</h3>
              {[
                lead.recent_linkedin_post && {
                  platform: "LinkedIn",
                  icon: <LinkedInIcon size={16} />,
                  color: "#0A66C2",
                  bg: "#EFF6FF",
                  content: lead.recent_linkedin_post,
                  handle: lead.primary_linkedin_url ? contactName : null,
                },
                lead.recent_ig_post && {
                  platform: "Instagram",
                  icon: <span style={{ fontSize: 15 }}>📸</span>,
                  color: "#E1306C",
                  bg: "#FDF2F8",
                  content: lead.recent_ig_post,
                  handle: lead.company_instagram ?? null,
                },
                lead.twitter_last_posts && {
                  platform: "X / Twitter",
                  icon: <span style={{ fontSize: 14, fontWeight: 800 }}>𝕏</span>,
                  color: "#111827",
                  bg: C.surface,
                  content: lead.twitter_last_posts,
                  handle: lead.twitter_url ? lead.twitter_url.split("/").pop() : null,
                },
                lead.company_blog && {
                  platform: "Company Blog",
                  icon: <span style={{ fontSize: 14 }}>📝</span>,
                  color: C.accent,
                  bg: "#F0FDFA",
                  content: lead.company_blog,
                  handle: lead.company_name,
                },
                lead.company_posts_content && {
                  platform: "Company Post",
                  icon: <span style={{ fontSize: 14 }}>🏢</span>,
                  color: gold,
                  bg: goldLight,
                  content: lead.company_posts_content,
                  handle: lead.company_name,
                },
              ].filter(Boolean).map((post: any, idx: number) => (
                <div key={idx} className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                  {/* Post header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: post.bg }}>
                      {post.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{post.platform}</span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: post.color, backgroundColor: post.bg }}>
                          POST
                        </span>
                      </div>
                      {post.handle && (
                        <p className="text-xs" style={{ color: C.textDim }}>{post.handle}</p>
                      )}
                    </div>
                  </div>
                  {/* Post content */}
                  <p className="text-sm leading-relaxed" style={{ color: C.textBody }}>{post.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border p-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
              <p className="text-sm" style={{ color: C.textDim }}>No social content scraped for this contact yet.</p>
            </div>
          )}
        </div>

        {/* ── TAB 5: Calls ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs" style={{ color: C.textMuted }}>
              {calls.length > 0 ? `${calls.length} call${calls.length === 1 ? "" : "s"} recorded` : "No calls yet"}
            </p>
            <div className="flex items-center gap-2">
              {lead.primary_phone && (
                <CallButton phone={lead.primary_phone} leadId={id} size="sm" defaultNumberId={campaign?.aircall_number_id ?? null} />
              )}
              <SyncAircallButton />
            </div>
          </div>
          {calls.length === 0 ? (
            <div className="rounded-2xl border p-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
              <Phone size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
              <p className="text-sm font-medium" style={{ color: C.textBody }}>No calls recorded yet</p>
              <p className="text-xs mt-1" style={{ color: C.textMuted }}>
                Calls made via Aircall from the Queue will appear here. Click &ldquo;Sync from Aircall&rdquo; above to pull recent calls.
              </p>
            </div>
          ) : (
            calls.map((call: any) => <CallCard key={call.id} call={call} />)
          )}
        </div>

      </CompanyTabs>
    </div>
  );
}
