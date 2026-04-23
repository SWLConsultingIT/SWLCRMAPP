import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone,
  PlayCircle, PauseCircle, CheckCircle, XCircle, CheckCircle2,
  Users, Clock, Check, MessageSquare,
} from "lucide-react";
import SequenceAccordion from "./SequenceAccordion";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  whatsapp: { icon: Mail,   color: "#22c55e", label: "WhatsApp" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const statusMeta: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  active:    { label: "Active",    color: C.green,    bg: C.greenLight,  icon: PlayCircle },
  paused:    { label: "Paused",    color: "#D97706",  bg: "#FFFBEB",     icon: PauseCircle },
  completed: { label: "Completed", color: C.textMuted, bg: "#F3F4F6",    icon: CheckCircle },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight,    icon: XCircle },
};

async function getData(id: string) {
  const supabase = await getSupabaseServer();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, lead_score, is_priority, icp_profile_id), sellers(name)")
    .eq("id", id)
    .single();
  if (!campaign) return null;

  // All campaigns with the same name (siblings)
  const { data: siblings } = await supabase
    .from("campaigns")
    .select("id, status, current_step, sequence_steps, channel, last_step_at, lead_id, started_at, completed_at, created_at, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, lead_score, is_priority, status), sellers(name)")
    .eq("name", campaign.name)
    .order("created_at", { ascending: false })
    .limit(100);

  const allCampaigns = siblings ?? [campaign];

  // Messages for this specific campaign
  const { data: messages } = await supabase
    .from("campaign_messages")
    .select("*")
    .eq("campaign_id", id)
    .order("step_number", { ascending: true });

  // Replies for leads in this campaign group
  const leadIds = allCampaigns.map((c: any) => c.lead_id).filter(Boolean);
  const { data: replies } = leadIds.length > 0
    ? await supabase.from("lead_replies").select("lead_id, classification, reply_text, received_at, channel").in("lead_id", leadIds).order("received_at", { ascending: false })
    : { data: [] };

  // Campaign request for templates
  const { data: campRequest } = await supabase
    .from("campaign_requests")
    .select("message_prompts")
    .eq("name", campaign.name)
    .limit(1)
    .maybeSingle();

  const connectionNote = campRequest?.message_prompts?.channelMessages?.connectionRequest ?? "";
  const messageTemplates: { channel: string; body: string; subject?: string }[] =
    campRequest?.message_prompts?.channelMessages?.steps ?? [];
  const autoReplies = campRequest?.message_prompts?.channelMessages?.autoReplies ?? {};

  return { campaign, allCampaigns, messages: messages ?? [], replies: replies ?? [], connectionNote, messageTemplates, autoReplies };
}

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT", color: C.hot, bg: C.hotBg };
  if (score && score >= 50) return { label: "WARM", color: C.warm, bg: C.warmBg };
  return { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

export default async function CampaignOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();

  const { campaign, allCampaigns, messages, replies, connectionNote, messageTemplates, autoReplies } = data;

  const sequence: { channel: string; daysAfter: number }[] = campaign.sequence_steps ?? [];
  const channels = [...new Set(sequence.map((s: any) => s.channel))];
  const totalSteps = sequence.length;
  const currentStep = campaign.current_step ?? 0;
  const pct = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
  const st = statusMeta[campaign.status] ?? statusMeta.active;
  const StIcon = st.icon;

  let cumDays = 0;
  const dayPerStep = sequence.map((s: any, i: number) => {
    cumDays += i === 0 ? 0 : s.daysAfter;
    return cumDays;
  });

  // Stats
  const totalLeadsInGroup = allCampaigns.length;
  const activeInGroup = allCampaigns.filter((c: any) => c.status === "active").length;
  const completedInGroup = allCampaigns.filter((c: any) => c.status === "completed").length;

  // Reply lookups
  const repliesByLead: Record<string, any[]> = {};
  for (const r of replies) {
    if (!repliesByLead[r.lead_id]) repliesByLead[r.lead_id] = [];
    repliesByLead[r.lead_id].push(r);
  }
  const totalReplies = Object.keys(repliesByLead).length;
  const positiveLeads = Object.values(repliesByLead).filter(rs => rs.some(r => r.classification === "positive" || r.classification === "meeting_intent")).length;
  const responseRate = totalLeadsInGroup > 0 ? Math.round((totalReplies / totalLeadsInGroup) * 100) : 0;

  // Conversion metrics
  const convertedCampaigns = allCampaigns.filter((c: any) => {
    const lr = repliesByLead[c.lead_id] ?? [];
    return lr.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
  });
  const avgStepsToConvert = convertedCampaigns.length > 0
    ? (convertedCampaigns.reduce((s: number, c: any) => s + (c.current_step ?? 0), 0) / convertedCampaigns.length).toFixed(1)
    : null;
  const avgDaysToConvert = (() => {
    const daysArr = convertedCampaigns.map((c: any) => {
      const start = c.started_at ? new Date(c.started_at).getTime() : null;
      const firstPositive = (repliesByLead[c.lead_id] ?? []).find((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
      const end = firstPositive?.received_at ? new Date(firstPositive.received_at).getTime() : (c.completed_at ? new Date(c.completed_at).getTime() : null);
      return start && end ? Math.max(1, Math.round((end - start) / 86400000)) : null;
    }).filter(Boolean) as number[];
    return daysArr.length > 0 ? (daysArr.reduce((a, b) => a + b, 0) / daysArr.length).toFixed(0) : null;
  })();

  // Classification colors
  const classColors: Record<string, { color: string; bg: string; label: string }> = {
    positive:       { color: C.green,   bg: C.greenLight, label: "Positive" },
    meeting_intent: { color: C.green,   bg: C.greenLight, label: "Meeting" },
    negative:       { color: C.red,     bg: C.redLight,   label: "Negative" },
    question:       { color: "#D97706", bg: "#FFFBEB",    label: "Question" },
    other:          { color: C.textMuted, bg: "#F3F4F6",  label: "Other" },
  };

  // Breadcrumb: try to find the ICP profile for back link
  const icpId = campaign.leads?.icp_profile_id;

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        {icpId ? (
          <Link href={`/leads/ticket/${icpId}`} className="hover:underline flex items-center gap-1"><ArrowLeft size={12} /> Back to Ticket</Link>
        ) : (
          <Link href="/leads" className="hover:underline flex items-center gap-1"><ArrowLeft size={12} /> Leads & Campaigns</Link>
        )}
        <span>/</span>
        <span style={{ color: C.textBody }}>{campaign.name}</span>
      </div>

      {/* ═══ HEADER ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Campaign Overview</p>
          <h1 className="text-2xl font-bold mb-3" style={{ color: C.textPrimary }}>{campaign.name}</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1" style={{ backgroundColor: st.bg }}>
              <StIcon size={13} style={{ color: st.color }} />
              <span className="text-xs font-semibold" style={{ color: st.color }}>{st.label}</span>
            </div>
            {channels.map(ch => {
              const meta = channelMeta[ch];
              if (!meta) return null;
              const Icon = meta.icon;
              return (
                <span key={ch} className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: `${meta.color}12`, color: meta.color }}>
                  <Icon size={11} /> {meta.label}
                </span>
              );
            })}
            {(campaign.sellers as any)?.name && (
              <span className="text-xs" style={{ color: C.textMuted }}>Seller: <strong style={{ color: C.textBody }}>{(campaign.sellers as any).name}</strong></span>
            )}
            {campaign.started_at && (
              <span className="text-xs" style={{ color: C.textMuted }}>
                <Clock size={11} className="inline mr-1" />
                Started {new Date(campaign.started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            )}
          </div>
        </div>

        <div className="border-t" style={{ borderColor: C.border }} />

        <div className="px-6 py-4 grid grid-cols-4 gap-4 lg:grid-cols-8">
          {[
            { label: "Total Leads", value: totalLeadsInGroup, color: gold },
            { label: "Active", value: activeInGroup, color: C.green },
            { label: "Completed", value: completedInGroup, color: C.textMuted },
            { label: "Replies", value: totalReplies, color: C.blue },
            { label: "Positive", value: positiveLeads, color: C.green },
            { label: "Response Rate", value: `${responseRate}%`, color: C.blue },
            { label: "Avg Steps", value: avgStepsToConvert ?? "—", color: gold },
            { label: "Avg Days", value: avgDaysToConvert ? `${avgDaysToConvert}d` : "—", color: gold },
          ].map(s => (
            <div key={s.label}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>{s.label}</p>
              <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ FUNNEL + SEQUENCE (side by side) ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: C.border }}>
        <div className="grid grid-cols-2" style={{ minHeight: "220px" }}>

          {/* LEFT: Funnel */}
          <div className="flex flex-col justify-center gap-0 p-6" style={{ borderRight: `1px solid ${C.border}`, backgroundColor: C.bg }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-5 text-center" style={{ color: C.textDim }}>Outreach Funnel</p>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
              {sequence.map((step, i) => {
                const meta = channelMeta[step.channel] ?? channelMeta.linkedin;
                const Icon = meta.icon;
                const isPast = i < currentStep;
                const isCur = i === currentStep && currentStep < sequence.length;
                const isFuture = i > currentStep;
                const n = sequence.length;
                const w = Math.max(14, 100 - i * (86 / Math.max(n - 1, 1)));
                const bg = isPast ? meta.color : isCur ? gold : "#94A3B8";
                return (
                  <div key={i} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      width: `${w}%`, height: "32px", backgroundColor: bg,
                      borderRadius: i === 0 ? "8px 8px 0 0" : i === n - 1 ? "0 0 8px 8px" : "0",
                      opacity: isFuture ? 0.25 : 1,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", overflow: "hidden",
                      boxShadow: (isPast || isCur) ? `0 2px 8px ${bg}40` : "none",
                    }}>
                      <Icon size={11} color="#fff" />
                      {w > 50 && <span style={{ color: "#fff", fontSize: "10px", fontWeight: 700 }}>{meta.label}</span>}
                      {isPast && w > 42 && <Check size={10} color="rgba(255,255,255,0.9)" />}
                      {isCur && <span style={{ fontSize: "8px", fontWeight: 800, color: "#fff", backgroundColor: "rgba(255,255,255,0.28)", padding: "1px 5px", borderRadius: "99px" }}>Now</span>}
                    </div>
                    {i < n - 1 && (
                      <div style={{ width: 0, height: 0, borderLeft: "9px solid transparent", borderRight: "9px solid transparent", borderTop: `7px solid ${bg}`, opacity: isFuture ? 0.25 : 1 }} />
                    )}
                  </div>
                );
              })}
            </div>
            {currentStep >= sequence.length && (
              <div className="mt-4 flex items-center justify-center gap-1.5">
                <CheckCircle2 size={12} style={{ color: C.green }} />
                <span style={{ fontSize: "10px", fontWeight: 700, color: C.green }}>All steps completed</span>
              </div>
            )}
          </div>

          {/* RIGHT: Step timeline + status */}
          <div className="flex flex-col gap-4 p-6" style={{ backgroundColor: C.card }}>
            <div className="flex items-center gap-2">
              <div className="rounded-full px-3 py-1 flex items-center gap-1.5 text-xs font-bold"
                style={{ backgroundColor: `${st.color}08`, color: st.color, border: `1px solid ${st.color}25` }}>
                {campaign.status === "active" && <><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: st.color }} /> Running</>}
                {campaign.status === "paused" && <><PauseCircle size={10} /> Paused</>}
                {campaign.status === "completed" && currentStep < sequence.length && <><MessageSquare size={10} /> Lead Replied</>}
                {currentStep >= sequence.length && <><CheckCircle2 size={10} /> Completed</>}
              </div>
              <span className="text-xs" style={{ color: C.textDim }}>Step {Math.min(currentStep + 1, sequence.length)} / {sequence.length}</span>
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }} />
              </div>
              <span className="text-xs font-bold tabular-nums" style={{ color: gold }}>{pct}%</span>
            </div>

            <div className="space-y-2 mt-2">
              {sequence.map((step, i) => {
                const meta = channelMeta[step.channel] ?? channelMeta.linkedin;
                const Icon = meta.icon;
                const isPast = i < currentStep;
                const isCur = i === currentStep && currentStep < sequence.length;
                return (
                  <div key={i} className="flex items-center gap-2.5">
                    <div style={{ width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, backgroundColor: isPast ? meta.color : isCur ? gold : "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isPast ? <Check size={9} color="#fff" /> : isCur ? <PlayCircle size={9} color="#fff" /> : <span style={{ fontSize: "8px", color: "#94A3B8", fontWeight: 700 }}>{i + 1}</span>}
                    </div>
                    <span style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, color: meta.color, backgroundColor: `${meta.color}12`, padding: "1px 6px", borderRadius: "4px" }}>
                      <Icon size={9} /> {meta.label}
                    </span>
                    <span style={{ fontSize: "10px", color: C.textDim }}>Day {dayPerStep[i] ?? 0}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: "10px", fontWeight: 600, color: isPast ? C.green : isCur ? gold : C.textDim }}>
                      {isPast ? "Sent" : isCur ? "Up next" : "Pending"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* ═══ MESSAGES (collapsible) ═══ */}
      <div className="mb-6">
        <SequenceAccordion
          sequence={sequence}
          messages={JSON.parse(JSON.stringify(messages))}
          messageTemplates={messageTemplates}
          connectionNote={connectionNote}
          dayPerStep={dayPerStep}
          currentStep={currentStep}
        />
      </div>

      {/* ═══ REPLIES RECEIVED ═══ */}
      {replies.length > 0 && (
        <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
              <MessageSquare size={12} className="inline mr-1.5" />Replies Received
            </p>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${C.blue}15`, color: C.blue }}>{replies.length}</span>
          </div>
          <div className="divide-y" style={{ borderColor: C.border }}>
            {replies.map((r: any, idx: number) => {
              const leadCamp = allCampaigns.find((c: any) => c.lead_id === r.lead_id);
              const l = leadCamp?.leads;
              const leadName = l ? `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || "Unknown" : "Unknown";
              const cls = classColors[r.classification] ?? classColors.other;
              const chMeta = channelMeta[r.channel] ?? channelMeta.linkedin;
              const ago = r.received_at ? (() => {
                const m = Math.floor((Date.now() - new Date(r.received_at).getTime()) / 60000);
                if (m < 60) return `${m}m ago`;
                const h = Math.floor(m / 60);
                if (h < 24) return `${h}h ago`;
                return `${Math.floor(h / 24)}d ago`;
              })() : null;

              return (
                <div key={idx} className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Link href={`/leads/${r.lead_id}`} className="text-xs font-semibold hover:underline" style={{ color: C.textPrimary }}>{leadName}</Link>
                    {l?.company_name && <span className="text-[10px]" style={{ color: C.textDim }}>· {l.company_name}</span>}
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: cls.bg, color: cls.color }}>{cls.label}</span>
                    <span className="text-[10px] flex items-center gap-1" style={{ color: chMeta.color }}>
                      <chMeta.icon size={9} /> {chMeta.label}
                    </span>
                    <div className="flex-1" />
                    {ago && <span className="text-[10px]" style={{ color: C.textDim }}>{ago}</span>}
                  </div>
                  {r.reply_text && (
                    <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: `${cls.color}20`, backgroundColor: `${cls.color}04` }}>
                      <p className="text-sm leading-relaxed" style={{ color: C.textBody }}>&ldquo;{r.reply_text}&rdquo;</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ AUTO-REPLY TEMPLATES ═══ */}
      {(autoReplies.positive || autoReplies.negative || autoReplies.question) && (
        <div className="rounded-xl border p-5 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Auto-Reply Templates</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {autoReplies.positive && (
              <div className="rounded-lg border p-3" style={{ borderColor: `${C.green}30`, backgroundColor: `${C.green}04` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.green }}>Positive Reply</p>
                <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.positive}</p>
              </div>
            )}
            {autoReplies.negative && (
              <div className="rounded-lg border p-3" style={{ borderColor: `${C.red}30`, backgroundColor: `${C.red}04` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.red }}>Negative Reply</p>
                <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.negative}</p>
              </div>
            )}
            {autoReplies.question && (
              <div className="rounded-lg border p-3" style={{ borderColor: `${C.blue}30`, backgroundColor: `${C.blue}04` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.blue }}>Question Reply</p>
                <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.question}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ LEADS IN CAMPAIGN ═══ */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
            <Users size={12} className="inline mr-1.5" />Leads in Campaign
          </p>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>{totalLeadsInGroup}</span>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr style={{ backgroundColor: C.bg }}>
              {["Lead", "Company", "Score", "Status", "Progress", "Reply", "Reply Preview"].map(h => (
                <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allCampaigns.map((c: any) => {
              const l = c.leads;
              if (!l) return null;
              const nm = `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || "Unknown";
              const cst = statusMeta[c.status] ?? statusMeta.active;
              const ts = c.sequence_steps?.length ?? 0;
              const p = ts > 0 ? Math.round((c.current_step / ts) * 100) : 0;
              const badge = scoreBadge(l.lead_score, l.is_priority);
              const leadReplies = repliesByLead[c.lead_id] ?? [];
              const hasPositive = leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
              const hasReply = leadReplies.length > 0;
              const replyColor = hasPositive ? C.green : hasReply ? "#D97706" : C.textDim;
              const replyLabel = hasPositive ? "Positive" : hasReply ? "Replied" : "Awaiting";
              const latestReply = leadReplies[0];
              const previewText = latestReply?.reply_text ? (latestReply.reply_text.length > 60 ? latestReply.reply_text.slice(0, 60) + "..." : latestReply.reply_text) : null;

              return (
                <tr key={c.id} className="border-t transition-colors hover:bg-black/[0.015]" style={{ borderColor: C.border }}>
                  <td className="px-4 py-3">
                    <Link href={`/leads/${l.id}`} className="flex items-center gap-2 group/row">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                        {((l.company_name ?? nm)[0] ?? "?").toUpperCase()}
                      </div>
                      <span className="text-xs font-semibold group-hover/row:underline truncate" style={{ color: C.textPrimary }}>{nm}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs truncate block max-w-[140px]" style={{ color: C.textMuted }}>{l.company_name ?? "—"}</span></td>
                  <td className="px-4 py-3"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span></td>
                  <td className="px-4 py-3"><span className="text-[10px] font-semibold rounded-md px-2 py-0.5" style={{ backgroundColor: cst.bg, color: cst.color }}>{cst.label}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${p}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }} />
                      </div>
                      <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>{c.current_step}/{ts}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className="text-[10px] font-semibold" style={{ color: replyColor }}>{replyLabel}</span></td>
                  <td className="px-4 py-3">
                    {previewText ? (
                      <span className="text-[10px] italic line-clamp-1 block max-w-[200px]" style={{ color: C.textDim }}>&ldquo;{previewText}&rdquo;</span>
                    ) : (
                      <span className="text-[10px]" style={{ color: C.textDim }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
