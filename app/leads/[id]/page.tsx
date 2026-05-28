import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";
import { decryptLeadPayload, redactClientLead, hydrateDecryptedLead, logDataAccess, bufferFromSupabaseBytea } from "@/lib/leads-crypto";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Mail, Phone, Building2,
  ExternalLink, CheckCircle2, AlertTriangle,
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
import MoveForwardButton from "@/components/MoveForwardButton";
import PreCallBrief from "@/components/PreCallBrief";
import RecentLeadTracker from "@/components/RecentLeadTracker";

// Bypass Next's render cache. Without this, the page snapshots messages +
// campaign state at build time and a freshly-sent step 1 keeps showing
// "Message pending" until the user hard-refreshes.
export const dynamic = "force-dynamic";

const gold = "var(--brand, #c9a83a)";
const goldLight = "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)";

// ── Data fetchers ──

async function getLead(id: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from("leads").select("*").eq("id", id).single();
  if (!data) return null;

  // SWL-uploaded leads are unprotected — return as-is.
  if (data.source !== "client") return data;

  // Client-uploaded leads have all PII inside encrypted_payload. Resolve the
  // caller's scope to decide between decrypt (same tenant) and redact (SWL
  // super_admin not impersonating the tenant). Demo-impersonating super_admins
  // get the decrypted view but the audit log records the access for the tenant.
  const scope = await getUserScope();
  const sameTenant = scope.companyBioId && scope.companyBioId === data.company_bio_id;

  if (!sameTenant) {
    if (scope.tier === "super_admin") {
      return redactClientLead(data);
    }
    // Anyone else (different tenant, no scope) cannot see this lead at all.
    return null;
  }

  if (!data.encrypted_payload) {
    // Marked as client but no payload — treat as redacted to avoid leaking nulls.
    return redactClientLead(data);
  }

  try {
    const blob = bufferFromSupabaseBytea(data.encrypted_payload);
    const decrypted = await decryptLeadPayload(blob, data.company_bio_id);
    await logDataAccess({
      companyBioId: data.company_bio_id,
      leadId: data.id,
      caller: scope.isDemoMode ? "swl-admin" : "client-app",
      reason: scope.isDemoMode ? "demo-mode-read" : "tenant-detail-view",
      encryptionMode: "standard",
    });
    return hydrateDecryptedLead(data, decrypted);
  } catch (err) {
    console.error("[leads/[id]] decrypt failed", err);
    return redactClientLead(data);
  }
}

async function getCampaign(leadId: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("id, name, channel, status, current_step, sequence_steps, started_at, next_step_due_at, paused_until, completed_at, aircall_number_id, call_advance_mode, sellers(name)")
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
    .select("id, campaign_id, step_number, channel, content, status, sent_at, metadata")
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
    `${url}/rest/v1/calls?lead_id=eq.${leadId}&order=started_at.desc&select=id,aircall_call_id,direction,status,duration,phone_number,recording_url,transcript,notes,started_at,ended_at,classification,ai_confidence,ai_summary,coach_analysis,coach_score,coach_generated_at,coach_model,summary,summary_generated_at`,
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

function isValidLinkedInUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return /(^|\.)linkedin\.com$/i.test(u.hostname) && /\/in\//.test(u.pathname);
  } catch {
    return false;
  }
}

// Channel permission row. `hasData(lead)` decides whether the channel actually
// has the underlying contact info — flagging mis-configured leads like an
// allow_linkedin=true with no primary_linkedin_url, which is what makes
// dispatch fail downstream with "no LinkedIn slug on lead".
const CHANNELS = [
  { key: "allow_linkedin",  icon: <LinkedInIcon size={14} />,            activeColor: "#0A66C2", hasData: (l: any) => isValidLinkedInUrl(l?.primary_linkedin_url) },
  { key: "allow_email",     icon: <span className="text-sm">✉️</span>, activeColor: C.green,    hasData: (l: any) => !!l?.primary_work_email || !!l?.primary_personal_email },
  { key: "allow_call",      icon: <span className="text-sm">📱</span>, activeColor: C.phone,    hasData: (l: any) => !!l?.primary_phone || !!l?.primary_secondary_phone },
  { key: "allow_whatsapp",  icon: <span className="text-sm">💬</span>, activeColor: "#25D366",  hasData: (l: any) => !!l?.whatsapp_number || !!l?.primary_phone },
  { key: "allow_instagram", icon: <span className="text-sm">📸</span>, activeColor: "#E1306C",  hasData: (l: any) => !!l?.primary_instagram },
  { key: "allow_sms",       icon: <span className="text-sm">💬</span>, activeColor: C.blue,     hasData: (l: any) => !!l?.primary_phone },
];

// ── Page ──

// Mirrors the placeholder substitution that the dispatcher does at send time
// (see app/api/cron/dispatch-queue/route.ts → personalizeNote). Used as a
// fallback for messages that were sent before metadata.rendered_content was
// being captured. Reads the current lead/seller — close enough for
// "what was sent" since the dispatcher also writes back any LinkedIn name
// correction onto the lead before dispatching.
function renderTemplateFallback(
  template: string,
  lead: any,
  sellerName: string | null,
): string {
  const first = lead?.primary_first_name ?? "there";
  const last = lead?.primary_last_name ?? "";
  const full = `${first} ${last}`.trim();
  const company = lead?.company_name ?? "";
  const role = lead?.primary_title_role ?? "";
  const seller = sellerName ?? "";
  return (template ?? "")
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{last_name}}", last)
    .replaceAll("{{full_name}}", full)
    .replaceAll("{{company_name}}", company)
    .replaceAll("{{company}}", company)
    .replaceAll("{{role}}", role)
    .replaceAll("{{title}}", role)
    .replaceAll("{{seller_name}}", seller)
    .replaceAll("{{seller_company}}", "");
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  const [campaign, rawMessages, replies, calls] = await Promise.all([
    getCampaign(id),
    getMessages(id),
    getReplies(id),
    getCalls(id),
  ]);

  // Pre-render messages once on the server so every downstream component
  // (Campaign tab, Recent Activity tab, stepper) shows the same actual
  // text the lead received instead of the raw {{first_name}} template.
  const sellerName = (campaign as any)?.sellers?.name ?? null;
  const messages = (rawMessages ?? []).map((m: any) => {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.rendered_content === "string" && meta.rendered_content.length > 0) {
      return m;
    }
    if (m.status !== "sent" || !m.content) return m;
    return {
      ...m,
      metadata: {
        ...meta,
        rendered_content: renderTemplateFallback(m.content, lead, sellerName),
        rendered_source: "fallback-server-render",
      },
    };
  });

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
  const campMsgsForStepper = campaign
    ? messages.filter((m: any) => m.campaign_id === campaign.id).sort((a: any, b: any) => (a.step_number ?? 0) - (b.step_number ?? 0))
    : [];
  // Connection request (step_number = 0) is dispatched separately from the
  // DM sequence but should count toward overall progress in the stepper.
  const connectionStepMsg = campMsgsForStepper.find((m: any) => m.step_number === 0) ?? null;
  const connectionStepSent = connectionStepMsg?.status === 'sent';
  const effectiveDenominator = steps.length + (connectionStepMsg ? 1 : 0);
  const effectiveNumerator = currentStep + (connectionStepSent ? 1 : 0);
  const stepPct = campDone ? 100 : effectiveDenominator > 0
    ? Math.round((effectiveNumerator / effectiveDenominator) * 100)
    : 0;

  // Build activity items scoped to this lead only
  type ActivityItem = {
    id: string; type: "message_sent" | "reply" | "campaign_start" | "lead_created";
    contactName: string; channel: string; content: string | null; timestamp: string;
    stepNumber?: number; classification?: string; aiConfidence?: number; requiresReview?: boolean; sellerName?: string;
    attachments?: Array<{ name: string; mimeType?: string; sizeBytes?: number }>;
  };

  const contactName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
  const activityItems: ActivityItem[] = [];

  // Sent messages: prefer the dispatcher-captured rendered_content over the
  // raw template so the activity feed shows what the lead actually received
  // ("Hi Steve, …") rather than the placeholder version ("Hi {{first_name}}, …").
  // Attachments are looked up via campaigns.sequence_steps[stepNumber-1].attachments
  // — same shape the dispatcher reads at send time, so the timeline shows
  // exactly what went out (paperclip chip + filename).
  messages.filter((m: any) => m.status === "sent").forEach((m: any) => {
    const rendered = (m.metadata as Record<string, unknown> | null)?.rendered_content;
    const displayed = typeof rendered === "string" && rendered.length > 0 ? rendered : (m.content ?? null);
    const stepIdx = (m.step_number ?? 0) - 1;
    const stepAttachments = stepIdx >= 0 && Array.isArray(rawSteps[stepIdx]?.attachments)
      ? rawSteps[stepIdx].attachments as Array<{ name: string; mimeType?: string; sizeBytes?: number }>
      : undefined;
    activityItems.push({
      id: m.id, type: "message_sent",
      contactName,
      channel: m.channel ?? campaign?.channel ?? "email",
      content: displayed,
      timestamp: m.sent_at,
      stepNumber: m.step_number,
      attachments: stepAttachments,
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

      <Breadcrumb crumbs={[{ label: "Leads", href: "/leads" }, { label: lead.company_name ?? "Contact" }, { label: contactName }]} />
      <RecentLeadTracker leadId={id} name={contactName} company={lead.company_name ?? null} />

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

        {/* Main row — responsive: stacked on mobile (<md), inline on desktop.
            Previously this was a hard `flex justify-between` that pushed the
            12-element right cluster off-screen on tablet and stacked it to
            5+ rows on mobile. Now: identity left, actions row right on lg+;
            actions wrap below identity on smaller screens. */}
        <div className="p-4 sm:p-6 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 lg:gap-6">

          {/* Left: Avatar + Name + Badges */}
          <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
            {/* Avatar */}
            <div
              className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-base sm:text-lg font-bold text-white shrink-0"
              style={{
                background: `linear-gradient(135deg, ${avatarBg}, color-mix(in srgb, ${avatarBg} 75%, white))`,
                boxShadow: `0 6px 20px color-mix(in srgb, ${avatarBg} 28%, transparent)`,
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
              }}
            >
              {initials}
            </div>

            {/* Name block */}
            <div className="min-w-0 flex-1">
              <h1
                className="text-[18px] sm:text-[22px] font-bold leading-tight truncate"
                style={{
                  color: C.textPrimary,
                  fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  letterSpacing: "-0.02em",
                }}
              >
                {lead.primary_first_name} {lead.primary_last_name}
              </h1>
              <p className="text-xs sm:text-sm mt-0.5 truncate" style={{ color: C.textMuted }}>
                {lead.primary_title_role ?? "—"}
              </p>
              {lead.company_name && (
                <Link href={`/companies/${encodeURIComponent(lead.company_name)}`}
                  className="flex items-center gap-1.5 text-xs sm:text-sm mt-1 hover:underline truncate"
                  style={{ color: C.blue }}>
                  <Building2 size={12} className="shrink-0" style={{ color: C.textDim }} />
                  <span className="truncate">{lead.company_name}</span>
                  <ExternalLink size={10} className="shrink-0" style={{ opacity: 0.6 }} />
                </Link>
              )}
              {/* Badges row — primary (status, score) always visible, secondary
                  (added date, NEW, seller) hidden on small viewports to keep
                  the header compact. They reappear at sm: width. */}
              <div className="flex items-center gap-1.5 sm:gap-2 mt-2 flex-wrap">
                <span className="text-[10px] sm:text-xs font-bold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full"
                  style={{ color: st.color, backgroundColor: st.bg }}>
                  {st.label.toUpperCase()}
                </span>
                <span className="text-[10px] sm:text-xs font-bold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full"
                  style={{ color: score.color, backgroundColor: score.bg }}>
                  {score.label}
                </span>
                {lead.created_at && (Date.now() - new Date(lead.created_at).getTime() < 7 * 86_400_000) && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 sm:py-1 rounded-full"
                    style={{ backgroundColor: gold, color: "#04070d" }}>
                    NEW
                  </span>
                )}
                {/* Created date — always visible (was conditional on <7d before
                    the Lead Source card was removed). Sellers occasionally need
                    to know the lead has been sitting for months. */}
                {lead.created_at && (
                  <span className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
                    title="When this lead was added"
                    style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.bg }}>
                    Added {new Date(lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                )}
                {lead.assigned_seller && (
                  <span className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
                    style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.bg }}>
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: gold, fontSize: 9 }}>
                      {lead.assigned_seller[0]}
                    </div>
                    {lead.assigned_seller}
                  </span>
                )}
                {/* Source universe — segmentation context (e.g. "UK Real Estate").
                    Surfaced as a header chip so the seller knows what bucket
                    the lead came from. The upstream tool name is intentionally
                    NOT shown to clients. */}
                {lead.source_universe && (
                  <span className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
                    title="Source universe / segment"
                    style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.bg }}>
                    {lead.source_universe}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right cluster — splits naturally into actions row + secondary
              indicators row on mobile so nothing overflows. On desktop both
              rows align horizontally with the identity block. */}
          <div className="flex flex-col-reverse sm:flex-col gap-3 sm:gap-4 sm:items-end shrink-0 w-full sm:w-auto">
            {/* Actions: Call + Delete — full-width on mobile, inline on sm+ */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap justify-stretch sm:justify-end w-full sm:w-auto">
              {(lead.primary_phone || lead.primary_secondary_phone) && (
                <div className="flex-1 sm:flex-initial">
                  <CallButton
                    phone={lead.primary_phone ?? lead.primary_secondary_phone ?? null}
                    leadId={id}
                    size="sm"
                    defaultNumberId={campaign?.aircall_number_id ?? null}
                    phones={[
                      ...(lead.primary_phone ? [{ label: "Mobile", value: lead.primary_phone }] : []),
                      ...(lead.primary_secondary_phone ? [{ label: "Work", value: lead.primary_secondary_phone }] : []),
                    ]}
                  />
                </div>
              )}
              <DeleteLeadButton leadId={id} leadName={contactName} />
            </div>

            {/* Indicators: channel chips + score ring */}
            <div className="flex items-center gap-3 sm:gap-4 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
                {CHANNELS.map(ch => {
                  const allowed = lead[ch.key] !== false;
                  const hasData = ch.hasData(lead);
                  const ready = allowed && hasData;
                  const broken = allowed && !hasData;
                  const label = ch.key.replace("allow_", "");
                  return (
                    <div key={ch.key}
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center border relative"
                      title={broken ? `${label} allowed but no contact data on file — dispatch will fail` : ready ? `${label}: ready` : `${label}: blocked`}
                      style={{
                        backgroundColor: ready
                          ? `color-mix(in srgb, ${C.green} 14%, transparent)`
                          : broken
                          ? "color-mix(in srgb, #D97706 14%, transparent)"
                          : C.surface,
                        borderColor: ready
                          ? `color-mix(in srgb, ${C.green} 35%, transparent)`
                          : broken
                          ? "color-mix(in srgb, #D97706 35%, transparent)"
                          : C.border,
                        opacity: allowed ? 1 : 0.45,
                      }}>
                      {ch.icon}
                      {ready && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: C.green }}>
                          <span style={{ color: "#fff", fontSize: 7, lineHeight: 1 }}>✓</span>
                        </div>
                      )}
                      {broken && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: "#D97706" }}>
                          <AlertTriangle size={7} color="#fff" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {lead.lead_score > 0 && (
                <ScoreRing score={lead.lead_score} color={score.color} />
              )}
            </div>
          </div>
        </div>

        <LeadStatsBar
          totalMsgsSent={totalMsgsSent}
          totalReplies={totalReplies}
          positiveReplies={positiveReplies}
          campaignStep={campaign ? `${campDone ? steps.length : Math.min(currentStep + 1, steps.length)}/${steps.length}` : "—"}
        />
      </div>

      {/* ═══ PRE-CALL BRIEF — 3 AI talking points, shown only when the lead
            has a phone number worth dialling. Auto-generates on first view. ═══ */}
      {lead.primary_phone && (
        <PreCallBrief
          leadId={id}
          initialPoints={(lead as any).call_talking_points ?? null}
          initialGeneratedAt={(lead as any).call_talking_points_at ?? null}
        />
      )}

      {/* ═══ NEXT ACTION CARD — what the user should do or know right now.
            Sits above the stepper so the seller doesn't have to interpret the
            progress bar to figure out what's pending. */}
      {campaign && (() => {
        const status = campaign.status;
        const nextIdx = (campaign.current_step ?? 0);
        const nextStep = steps[nextIdx];
        const dueIso = (campaign as any).next_step_due_at as string | null | undefined;
        const dueDate = dueIso ? new Date(dueIso) : null;
        const isOverdue = dueDate ? dueDate.getTime() < Date.now() : false;

        // Pick one of four states.
        let tone = "neutral", title = "", subtitle = "", color = C.textMuted;
        if (status === "completed" || status === "closed_won") {
          tone = "won"; color = C.green;
          title = "Campaign completed";
          subtitle = (campaign as any).reply_count
            ? `${(campaign as any).reply_count} repl${(campaign as any).reply_count === 1 ? "y" : "ies"} received.`
            : "Sequence ran end-to-end without a reply.";
        } else if (status === "closed_lost" || status === "failed") {
          tone = "lost"; color = C.red;
          title = "Campaign ended";
          subtitle = "Lead won't receive more outreach. Re-nurture or archive.";
        } else if (status === "paused") {
          tone = "paused"; color = "#D97706";
          title = "Campaign paused";
          subtitle = "Resume from the Pause/Resume button below to keep sending.";
        } else if (nextStep) {
          tone = "active"; color = C.blue;
          const when = dueDate
            ? (isOverdue
                ? `Overdue · was due ${dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                : `Due ${dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`)
            : "Scheduled by the orchestrator";
          title = `Next: ${nextStep} (Step ${nextIdx + 1} of ${steps.length})`;
          subtitle = when;
        }

        if (!title) return null;
        return (
          <div
            className="rounded-2xl border mb-4 px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 6%, ${C.card})`,
              borderColor: `color-mix(in srgb, ${color} 28%, ${C.border})`,
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
                  color,
                }}
              >
                {tone === "won" ? "✓" : tone === "lost" ? "✕" : tone === "paused" ? "II" : "→"}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color }}>
                  {tone === "active" ? (isOverdue ? "Action overdue" : "Next action") : "Status"}
                </p>
                <p className="text-sm font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                  {title}
                </p>
                <p className="text-xs" style={{ color: C.textMuted }}>{subtitle}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ CAMPAIGN STEP PROGRESS (horizontal stepper) ═══ */}
      {steps.length > 0 ? (
        <div className="rounded-2xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider" style={{ color: C.textPrimary, letterSpacing: "0.08em" }}>
                Campaign Step Progress
              </p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <p className="text-xs" style={{ color: C.textMuted }}>
                  {campaign!.name ?? "Outreach Campaign"}
                </p>
                {(campaign as any)?.call_advance_mode === "manual" && (
                  <span title="Sequence is paused at every call step until the seller dials. Auto-advance is off for this campaign."
                    className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                    style={{
                      backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)",
                      color: "#D97706",
                      border: "1px solid color-mix(in srgb, #D97706 35%, transparent)",
                      letterSpacing: "0.06em",
                    }}>
                    Manual gate
                  </span>
                )}
                {campaign && (
                  <Link href={`/campaigns/${campaign.id}`}
                    className="text-[10px] font-semibold hover:underline flex items-center gap-1" style={{ color: gold }}>
                    View campaign <ExternalLink size={10} />
                  </Link>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {campaign && !campDone && (
                <MoveForwardButton
                  campaignId={campaign.id}
                  currentStep={currentStep}
                  totalSteps={steps.length}
                  nextChannel={rawSteps[currentStep]?.channel}
                />
              )}
              <span className="text-base font-bold italic" style={{ color: gold }}>
                {stepPct}% Complete
              </span>
            </div>
          </div>

          {/* Horizontal stepper */}
          <div className="relative flex items-start justify-between px-4">
            {/* Connection-request pre-step (step_number=0 in DB). Only rendered when the
                campaign actually has a connection-request message; otherwise the sequence
                starts directly at step 1 (e.g. email-first or call-first campaigns). */}
            {connectionStepMsg && (
              <div key="invite" className="flex flex-col items-center relative" style={{ flex: 1, minWidth: 100 }}>
                <div className="relative z-10 mb-3 flex items-center justify-center" style={{ height: 68 }}>
                  {connectionStepSent ? (
                    <div className="rounded-full flex items-center justify-center"
                      style={{ width: 48, height: 48, backgroundColor: "#DCFCE7" }}>
                      <CheckCircle2 size={26} style={{ color: "#22C55E" }} />
                    </div>
                  ) : (
                    <div className="rounded-full"
                      style={{ width: 40, height: 40, backgroundColor: "#D1D5DB" }} />
                  )}
                </div>
                <p className="text-center leading-tight px-1"
                  style={{ color: connectionStepSent ? C.textBody : "#9CA3AF", fontWeight: 500, fontSize: 12 }}>
                  Invite
                </p>
                {connectionStepMsg.sent_at && (
                  <p className="text-xs text-center mt-1" style={{ color: C.textMuted }}>
                    {new Date(connectionStepMsg.sent_at).toLocaleDateString("en-GB", { month: "short", day: "numeric" })}
                  </p>
                )}
              </div>
            )}
            {steps.map((stepLabel: string, idx: number) => {
              const stepNum = idx + 1;
              // current_step in DB = the step_number of the LAST step that was dispatched.
              // After email (step_number=1) is sent, current_step=1, and the lead is now
              // working on step 2 (call). The stepper marks completed steps with a check
              // and highlights the NEXT step as "current" — so isCompleted is inclusive
              // of currentStep and isCurrent points one past it.
              const isCurrent = stepNum === currentStep + 1;
              const isCompleted = stepNum <= currentStep;
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
                        backgroundColor: stepNum <= currentStep + 1 ? gold : "#D1D5DB",
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

                  {/* Date under step — sent date for completed, "In progress" for current */}
                  {(isCompleted || isCurrent) && (
                    <p className="text-xs text-center mt-1" style={{ color: C.textMuted }}>
                      {msg?.sent_at
                        ? new Date(msg.sent_at).toLocaleDateString("en-GB", { month: "short", day: "numeric" })
                        : isCurrent ? "In progress" : ""}
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
      {/* Tab order reflects what sellers actually open on a lead, most to
          least often: contact info → sequence progress → call history →
          AI summary (research) → full timeline → social deep-research.
          The Pre-Call Brief above the tabs already provides the 30-second
          summary, so Summary tab demotes to the research-tier. */}
      <CompanyTabs tabs={[
        { label: "Profile Overview" },
        { label: "Campaign" },
        { label: "Calls", count: calls.length || undefined },
        { label: "Summary" },
        { label: "Recent Activity",  count: activityItems.length },
        { label: "Social & Content" },
      ]}>

        {/* ── TAB 1: Profile Overview ──
            Single-column full-width. The old 2-col grid (`[1fr 340px]`) left
            a permanent 340px dead zone on wide monitors whenever the right
            rail's conditional cards (Lead Source, Career, Website) had no
            data — which is most leads. Stacking everything full-width keeps
            the layout consistent and stops the visual "half-filled page"
            feel that came up in UX feedback. */}
        <div className="space-y-5 w-full">

          {/* About the Person + everything else, stacked full-width */}
          <div className="space-y-5 min-w-0">

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
                {(() => {
                  const url = lead.primary_linkedin_url as string | null;
                  const valid = isValidLinkedInUrl(url);
                  const disabled = lead.allow_linkedin === false;
                  // Always show the LinkedIn card — even when allow_linkedin=false — so
                  // the admin can SEE the underlying state (URL present/absent/invalid)
                  // and decide whether to re-enable. Hiding the card hides the data
                  // needed to triage it.
                  const isWarn = !valid && !disabled;
                  return (
                    <div className="flex items-start gap-2.5 p-3 rounded-lg min-w-0"
                      style={{
                        backgroundColor: disabled ? C.surface : isWarn ? "color-mix(in srgb, #D97706 12%, transparent)" : C.bg,
                        border: disabled ? `1px solid ${C.border}` : isWarn ? "1px solid color-mix(in srgb, #D97706 32%, transparent)" : "none",
                        opacity: disabled ? 0.85 : 1,
                      }}>
                      <LinkedInIcon size={14} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs uppercase tracking-wider mb-0.5 flex items-center gap-2"
                          style={{ color: C.textDim, fontSize: 10 }}>
                          LinkedIn
                          {disabled && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                              style={{ backgroundColor: "#DC2626", color: "#fff" }}>Disabled</span>
                          )}
                        </p>
                        {url && valid && (
                          <a href={url} target="_blank" rel="noopener"
                            className="text-sm font-medium hover:underline flex items-center gap-1 break-all"
                            style={{ color: "#0A66C2" }}>{url.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "")} <ExternalLink size={11} className="shrink-0" /></a>
                        )}
                        {url && !valid && (
                          <>
                            <p className="text-xs font-semibold mb-1 flex items-center gap-1" style={{ color: "#92400E" }}>
                              <AlertTriangle size={11} /> URL is not a LinkedIn profile
                            </p>
                            <a href={url} target="_blank" rel="noopener"
                              className="text-xs hover:underline break-all"
                              style={{ color: "#92400E" }}>{url}</a>
                          </>
                        )}
                        {!url && (
                          <p className="text-xs font-semibold flex items-center gap-1"
                            style={{ color: disabled ? C.textMuted : "#92400E" }}>
                            <AlertTriangle size={11} /> No LinkedIn URL on file{disabled ? "" : " — dispatch will fail"}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })()}
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
                            backgroundColor: allowed
                              ? `color-mix(in srgb, ${C.green} 14%, transparent)`
                              : C.surface,
                            borderColor: allowed
                              ? `color-mix(in srgb, ${C.green} 35%, transparent)`
                              : C.border,
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

          {/* Was a right sidebar, now full-width follow-up cards (Career,
              Website Intelligence) stacked below the main block. */}
          <div className="space-y-5">

            {/* Lead Source removed — `source_tool` (Apollo / ZoomInfo / etc.)
                reveals the upstream prospecting tool we'd rather not advertise
                to clients reviewing a lead. `source_universe` and
                `created_at` were moved up to the header badges where they
                read as natural lead metadata. */}

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
                  <div className="p-3 rounded-lg"
                    style={{
                      backgroundColor: "color-mix(in srgb, #D97706 10%, transparent)",
                      borderLeft: "3px solid #F59E0B",
                    }}>
                    <p className="text-xs font-bold mb-1" style={{ color: "#D97706" }}>Recent News</p>
                    <p className="text-sm leading-relaxed" style={{ color: C.textBody }}>{lead.recent_website_news}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── TAB 2: Campaign ── */}
        <CampaignJourney campaign={campaign as any} messages={messages as any} replies={replies as any} />

        {/* ── TAB 3: Calls ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs" style={{ color: C.textMuted }}>
              {calls.length > 0 ? `${calls.length} call${calls.length === 1 ? "" : "s"} recorded` : "No calls yet"}
            </p>
            <div className="flex items-center gap-2">
              {(lead.primary_phone || lead.primary_secondary_phone) && (
                <CallButton
                  phone={lead.primary_phone ?? lead.primary_secondary_phone ?? null}
                  leadId={id}
                  size="sm"
                  defaultNumberId={campaign?.aircall_number_id ?? null}
                  phones={[
                    ...(lead.primary_phone ? [{ label: "Mobile", value: lead.primary_phone }] : []),
                    ...(lead.primary_secondary_phone ? [{ label: "Work", value: lead.primary_secondary_phone }] : []),
                  ]}
                />
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

        {/* ── TAB 4: Summary ── */}
        <LeadSummaryTab
          leadId={id}
          initialSummary={lead.ai_summary ?? null}
          initialGeneratedAt={lead.ai_summary_at ?? null}
        />

        {/* ── TAB 5: Recent Activity ── */}
        <ActivityTimeline activities={activityItems as any} notes={teamNotes} leadId={id} />

        {/* ── TAB 6: Social & Content ── */}
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


      </CompanyTabs>
    </div>
  );
}
