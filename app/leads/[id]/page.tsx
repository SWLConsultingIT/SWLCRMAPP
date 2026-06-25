import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";
import { decryptLeadPayload, redactClientLead, hydrateDecryptedLead, logDataAccess, bufferFromSupabaseBytea } from "@/lib/leads-crypto";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Mail, Phone, Building2,
  ExternalLink, CheckCircle2, AlertTriangle,
  Megaphone, ChevronLeft, ChevronRight,
} from "lucide-react";
import { LinkedInIcon } from "@/components/SocialIcons";
import CompanyTabs from "@/components/CompanyTabs";
import ActivityTimeline from "@/components/ActivityTimeline";
import LeadChatThread from "@/components/LeadChatThread";
import LeadNotes from "@/components/LeadNotes";
import LeadPinnedNotes from "@/components/LeadPinnedNotes";
import CampaignJourney from "@/components/CampaignJourney";
import DeleteLeadButton from "@/components/DeleteLeadButton";
import Breadcrumb from "@/components/Breadcrumb";
import SyncAircallButton from "@/components/SyncAircallButton";
import CallButton from "@/components/CallButton";
import EditableLeadField from "@/components/EditableLeadField";
import WrongNumberPill from "@/components/WrongNumberPill";
import CallCard from "@/components/CallCard";
import PersonalizedInfoPanel from "@/components/PersonalizedInfoPanel";
import LeadSellerTags from "@/components/LeadSellerTags";
import LeadSummaryTab from "@/components/LeadSummaryTab";
import LeadStatsBar from "@/components/LeadStatsBar";
import MoveForwardButton from "@/components/MoveForwardButton";
import PreCallBrief from "@/components/PreCallBrief";
import LeadQA from "@/components/LeadQA";
import ScrapeCompanyButton from "@/components/ScrapeCompanyButton";
import ProspectClock from "@/components/ProspectClock";
import { countryToTimeZone } from "@/lib/prospect-time";
import LinkedInEnrichment from "@/components/LinkedInEnrichment";
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

// Prev/next navigation within the same flow (boss 2026-06-10: arrows to move
// between leads in the same sequence). "Same flow" = leads whose campaign
// shares this lead's campaign name (the flow groups per-lead campaign rows by
// name), within the same tenant, ordered stably by the lead's created_at.
async function getSequenceNav(leadId: string, campaignName: string | null, bioId: string | null) {
  if (!campaignName) return null;
  const supabase = await getSupabaseServer();
  let qy = supabase
    .from("campaigns")
    .select("lead_id, leads!inner(id, company_bio_id, created_at, primary_first_name, primary_last_name)")
    .eq("name", campaignName)
    .not("status", "in", "(archived,cancelled)");
  if (bioId) qy = qy.eq("leads.company_bio_id", bioId);
  const { data } = await qy;
  const rows = ((data ?? []) as any[])
    .map(r => r.leads)
    .filter(Boolean)
    .sort((a, b) =>
      (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
      `${a.primary_first_name ?? ""} ${a.primary_last_name ?? ""}`.localeCompare(`${b.primary_first_name ?? ""} ${b.primary_last_name ?? ""}`));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const l of rows) { if (l?.id && !seen.has(l.id)) { seen.add(l.id); ordered.push(l.id); } }
  const idx = ordered.indexOf(leadId);
  if (idx === -1 || ordered.length <= 1) return null;
  return {
    prevId: idx > 0 ? ordered[idx - 1] : null,
    nextId: idx < ordered.length - 1 ? ordered[idx + 1] : null,
    index: idx + 1,
    total: ordered.length,
  };
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

// What we sell into this lead's segment — powers the "Account & industry angle"
// card (our generic play for their industry, from the ICP + company bio).
async function getAngleContext(icpId: string | null, bioId: string | null) {
  const supabase = await getSupabaseServer();
  const [icpRes, bioRes] = await Promise.all([
    icpId ? supabase.from("icp_profiles").select("profile_name, solutions_offered, pain_points").eq("id", icpId).single() : Promise.resolve({ data: null }),
    bioId ? supabase.from("company_bios").select("main_services, value_proposition").eq("id", bioId).single() : Promise.resolve({ data: null }),
  ]);
  return {
    icp: (icpRes.data ?? null) as { profile_name?: string; solutions_offered?: string; pain_points?: string } | null,
    bio: (bioRes.data ?? null) as { main_services?: string; value_proposition?: string } | null,
  };
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
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3.5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)" }} />
      </svg>
      <div className="text-center z-10">
        <p className="text-sm font-bold leading-none" style={{ color: "#FFFFFF" }}>{score}</p>
        <p style={{ color: "#8E9AB4", fontSize: 8, letterSpacing: "0.05em" }}>SCORE</p>
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
// Channel chip → deep link target. getHref returns the URL the chip
// should open when clicked. The header row was confusing operators —
// the email/phone/whatsapp chips were doubling as quick-actions that
// opened mailto:/tel:/wa.me. Sellers expected the Call button + Mobile
// card to be the one source of truth for outbound; the header chips
// were sneaking in shortcuts that pulled them out of the CRM (mailto
// opening Mail.app, tel: opening native dialer instead of Aircall).
// `clickable: true` keeps the chip interactive — currently only
// LinkedIn, because there's no in-app LinkedIn view to drop into. The
// other chips render as static status indicators (ready / broken /
// blocked) without href.
const CHANNELS = [
  {
    key: "allow_linkedin", icon: <LinkedInIcon size={14} />, activeColor: "#0A66C2",
    hasData: (l: any) => isValidLinkedInUrl(l?.primary_linkedin_url),
    getHref: (l: any) => isValidLinkedInUrl(l?.primary_linkedin_url) ? (l.primary_linkedin_url as string) : null,
    external: true,
    clickable: true,
  },
  {
    key: "allow_email", icon: <span className="text-sm">✉️</span>, activeColor: C.green,
    hasData: (l: any) => !!l?.primary_work_email || !!l?.primary_personal_email,
    getHref: (_l: any) => null,
    external: false,
    clickable: false,
  },
  {
    key: "allow_call", icon: <span className="text-sm">📱</span>, activeColor: C.phone,
    hasData: (l: any) => !!l?.primary_phone || !!l?.primary_secondary_phone,
    getHref: (_l: any) => null,
    external: false,
    clickable: false,
  },
  {
    key: "allow_whatsapp", icon: <span className="text-sm">💬</span>, activeColor: "#25D366",
    hasData: (l: any) => !!l?.whatsapp_number || !!l?.primary_phone,
    getHref: (_l: any) => null,
    external: true,
    clickable: false,
  },
  {
    key: "allow_instagram", icon: <span className="text-sm">📸</span>, activeColor: "#E1306C",
    hasData: (l: any) => !!l?.primary_instagram,
    getHref: (_l: any) => null,
    external: true,
    clickable: false,
  },
  {
    key: "allow_sms", icon: <span className="text-sm">💬</span>, activeColor: C.blue,
    hasData: (l: any) => !!l?.primary_phone,
    getHref: (_l: any) => null,
    external: false,
    clickable: false,
  },
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

// Section divider used to break the lead view into clear, scannable zones
// (Pre-call prep / Account / Research / Campaign / Details). Bold gold-accented
// heading so the section names stand out.
// Zone accents — one muted color per section, used on the label bar and the
// matching card's side rail so each zone reads as a cohesive unit. Gold stays
// reserved for the hero + the flagship pre-call brief.
const ZONE = {
  prep: "var(--brand, #c9a83a)",
  account: "#0891B2",
  research: "#7C3AED",
  copilot: "#0E9F6E",
  campaign: "#2563EB",
  details: "#64748B",
} as const;

function ZoneLabel({ title, accent = "var(--brand, #c9a83a)" }: { title: string; accent?: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="w-1.5 h-5 rounded-full" style={{ background: `linear-gradient(180deg, ${accent}, color-mix(in srgb, ${accent} 55%, white))` }} />
      <h2 className="text-[14px] font-extrabold uppercase" style={{ color: C.textPrimary, letterSpacing: "0.14em" }}>{title}</h2>
      <span className="flex-1 h-px" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 38%, transparent), transparent)` }} />
    </div>
  );
}

// Tonal wash behind a whole zone — the page reads as grouped colored regions
// instead of a stack of identical white cards. Content keeps its own cards;
// the wash sits underneath and fades out.
function zoneStyle(accent: string) {
  return {
    background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 7%, transparent), transparent 74%)`,
    borderRadius: 20,
    padding: "16px 16px 22px",
    marginTop: 14,
  } as const;
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  // Account & industry angle context (our play for this lead's segment).
  const angle = await getAngleContext((lead as any).icp_profile_id ?? null, (lead as any).company_bio_id ?? null);

  const [campaign, rawMessages, replies, calls] = await Promise.all([
    getCampaign(id),
    getMessages(id),
    getReplies(id),
    getCalls(id),
  ]);

  // Hide phantom dial-markers from the call history (boss 2026-06-10: "se
  // duplican las llamadas?"). Clicking "Call" writes a marker row
  // (status=initiated, aircall_call_id=null) BEFORE the Aircall dialer opens;
  // the REAL call then arrives via the webhook with an aircall_call_id. So one
  // dial can leave 1 real row + 1-2 markers. A row is real iff it has an
  // aircall_call_id OR a logged outcome (classification); everything else is a
  // transient marker and shouldn't show as a separate "call".
  const visibleCalls = ((calls as any[]) ?? []).filter(
    (c: any) => c.aircall_call_id != null || c.classification != null,
  );

  // Prev/next navigation between leads of the same flow (boss 2026-06-10).
  const seqNav = await getSequenceNav(id, (campaign as any)?.name ?? null, (lead as any)?.company_bio_id ?? null);

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
  // Find which step is a call step (for validation)
  const callStepIndex = rawSteps.findIndex((s: any) => {
    const ch = typeof s === 'string' ? s : s?.channel;
    return ch && ch.toLowerCase() === 'call';
  }) + 1; // Convert to 1-indexed
  const isCallStep = callStepIndex > 0 && currentStep === callStepIndex;
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

      {/* ═══ CONTACT HEADER — navy command bar. The deep navy is the structural
            counterpoint to gold (per design.ts) and breaks the wall of white
            cards below it. Identity text is forced light; the colored pills and
            light-bg chips read fine on navy as-is. ═══ */}
      <div
        className="rounded-2xl mb-6 relative overflow-hidden reveal"
        style={{
          background: "radial-gradient(120% 140% at 100% 0%, rgba(201,168,58,0.16), transparent 44%), linear-gradient(160deg, #10182B 0%, #0B0F1A 72%)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 2px 4px rgba(11,15,26,0.18), 0 24px 48px -20px rgba(11,15,26,0.40)",
        }}
      >
        <div
          className="absolute left-0 top-0 bottom-0 w-[4px]"
          style={{
            background: `linear-gradient(180deg, ${gold}, color-mix(in srgb, ${gold} 45%, transparent))`,
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
                  color: "#FFFFFF",
                  fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  letterSpacing: "-0.02em",
                }}
              >
                {lead.primary_first_name} {lead.primary_last_name}
              </h1>
              <p className="text-xs sm:text-sm mt-0.5 truncate" style={{ color: "#AEB8CC" }}>
                {lead.primary_title_role ?? "—"}
              </p>
              {lead.company_name && (
                <Link href={`/companies/${encodeURIComponent(lead.company_name)}`}
                  className="flex items-center gap-1.5 text-xs sm:text-sm mt-1 hover:underline truncate font-semibold"
                  style={{ color: "#E6C661" }}>
                  <Building2 size={12} className="shrink-0" style={{ color: "rgba(255,255,255,0.45)" }} />
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
                {(() => {
                  const tz = countryToTimeZone(lead.company_country);
                  if (!tz) return null;
                  const place = lead.company_city || lead.company_country || null;
                  return <ProspectClock tz={tz} place={place} dark />;
                })()}
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
                    style={{ borderColor: "rgba(255,255,255,0.14)", color: "#C5CDDD", backgroundColor: "rgba(255,255,255,0.06)" }}>
                    Added {new Date(lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                )}
                {lead.assigned_seller && (
                  <span className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
                    style={{ borderColor: "rgba(255,255,255,0.14)", color: "#C5CDDD", backgroundColor: "rgba(255,255,255,0.06)" }}>
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
                    style={{ borderColor: "rgba(255,255,255,0.14)", color: "#C5CDDD", backgroundColor: "rgba(255,255,255,0.06)" }}>
                    {lead.source_universe}
                  </span>
                )}
              </div>

              {/* Tagged teammates — loop colleagues in, with a reason on hover */}
              <div className="mt-2.5">
                <LeadSellerTags leadId={lead.id} compact />
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
                  {lead.allow_call === false ? (
                    // Phone marked wrong via the post-call outcome popup
                    // (wrong_number). We swap the Call button for a red
                    // clickable pill that opens an inline replace flow —
                    // saving auto re-enables allow_call (PATCH route side
                    // effect 2026-06-01) so the next render restores the
                    // normal Call button without an admin step.
                    <WrongNumberPill
                      leadId={id}
                      currentPhone={lead.primary_phone ?? lead.primary_secondary_phone ?? null}
                    />
                  ) : (
                    <CallButton
                      phone={lead.primary_phone ?? lead.primary_secondary_phone ?? null}
                      leadId={id}
                      size="sm"
                      defaultNumberId={campaign?.aircall_number_id ?? null}
                      phones={[
                        ...(lead.primary_phone ? [{ label: "Personal", value: lead.primary_phone }] : []),
                        ...(lead.primary_secondary_phone ? [{ label: "Company", value: lead.primary_secondary_phone }] : []),
                      ]}
                      isCallStep={isCallStep}
                      nextStepName={callStepIndex > 0 && callStepIndex < steps.length ? steps[callStepIndex] : undefined}
                    />
                  )}
                </div>
              )}
              {/* "View flow" — always visible when the lead has any
                  campaign linked (active OR completed). One click to the
                  campaign detail / flow view. Sits between the call
                  chain and Delete so it's grouped with the navigation
                  affordances. */}
              {campaign?.id && (
                <Link
                  href={`/campaigns/${campaign.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold whitespace-nowrap transition-opacity hover:opacity-85"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${C.gold} 14%, transparent)`,
                    color: C.gold ?? "#c9a83a",
                    border: `1px solid color-mix(in srgb, ${C.gold} 30%, transparent)`,
                  }}
                  title="Open this lead's flow"
                >
                  <Megaphone size={14} />
                  View flow
                </Link>
              )}
              <DeleteLeadButton leadId={id} leadName={contactName} />

              {/* Prev/next within the same flow (boss 2026-06-10) — two arrows
                  to move between leads of the same sequence without going back
                  to the list. Hidden when the lead isn't in a multi-lead flow. */}
              {seqNav && (
                <div className="inline-flex items-center rounded-lg border overflow-hidden" style={{ borderColor: C.border }}>
                  {seqNav.prevId ? (
                    <Link href={`/leads/${seqNav.prevId}`} title="Previous lead in this flow"
                      className="inline-flex items-center px-2 py-2 transition-colors hover:bg-black/[0.04]" style={{ color: C.textBody }}>
                      <ChevronLeft size={15} />
                    </Link>
                  ) : (
                    <span className="inline-flex items-center px-2 py-2" style={{ color: C.textDim, opacity: 0.4 }}><ChevronLeft size={15} /></span>
                  )}
                  <span className="px-2 text-[11px] font-semibold tabular-nums border-x" style={{ color: C.textMuted, borderColor: C.border }}>
                    {seqNav.index}/{seqNav.total}
                  </span>
                  {seqNav.nextId ? (
                    <Link href={`/leads/${seqNav.nextId}`} title="Next lead in this flow"
                      className="inline-flex items-center px-2 py-2 transition-colors hover:bg-black/[0.04]" style={{ color: C.textBody }}>
                      <ChevronRight size={15} />
                    </Link>
                  ) : (
                    <span className="inline-flex items-center px-2 py-2" style={{ color: C.textDim, opacity: 0.4 }}><ChevronRight size={15} /></span>
                  )}
                </div>
              )}
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
                  const href = ch.getHref(lead);
                  const sharedClass = "w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center border relative transition-transform";
                  const sharedStyle = {
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
                  } as const;
                  const titleText = broken
                    ? `${label} allowed but no contact data on file — dispatch will fail`
                    : ready
                    ? `${label}: ready · click to open`
                    : `${label}: blocked`;
                  const inner = (
                    <>
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
                    </>
                  );
                  // Only LinkedIn is interactive in this row (see CHANNELS).
                  // The other chips are status indicators — sellers should
                  // hit Call / Mobile card / email composer for actions, not
                  // sneak out to mailto:/tel: via these icons.
                  if (ch.clickable && href && allowed) {
                    return (
                      <a
                        key={ch.key}
                        href={href}
                        target={ch.external ? "_blank" : undefined}
                        rel={ch.external ? "noreferrer" : undefined}
                        className={`${sharedClass} hover:scale-110 cursor-pointer`}
                        title={titleText}
                        style={sharedStyle}
                      >
                        {inner}
                      </a>
                    );
                  }
                  return (
                    <div key={ch.key}
                      className={sharedClass}
                      title={titleText}
                      style={sharedStyle}>
                      {inner}
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

      <section className="reveal" style={zoneStyle(ZONE.prep)}>
      <ZoneLabel title="Pre-call prep" accent={ZONE.prep} />

      {/* ═══ PRE-CALL BRIEF — ALWAYS rendered (Fran 2026-06-05), self-generates
            on first view. First in the Overview flow: brief → account angle →
            company → deep-dive → enrichment. ═══ */}
      <PreCallBrief
        leadId={id}
        initialPoints={(lead as any).call_talking_points ?? null}
        initialGeneratedAt={(lead as any).call_talking_points_at ?? null}
      />

      </section>
      <section className="reveal" style={zoneStyle(ZONE.account)}>
      <ZoneLabel title="Account" accent={ZONE.account} />

      {/* ═══ COMPANY — one rich section: facts + what they do + our industry
            play + value prop + tech/keywords/news, clickable through to the
            full company page. (Consolidates the old angle + company card and
            the removed in-tab Company block.) ═══ */}
      {lead.company_name && (() => {
        const enr = (lead.enrichment as any) ?? {};
        const techs = Array.isArray(enr.technologies) ? enr.technologies as string[] : [];
        const kws = Array.isArray(enr.keywords) ? enr.keywords as string[] : [];
        const scrape = (lead.company_scrape as { summary?: string; services?: string[]; scraped_at?: string } | null) ?? null;
        // Conversation signals — what the company is publishing + sector trends.
        // Both arrive as free text from enrichment; render best-effort.
        const asText = (v: unknown) => (Array.isArray(v) ? v.join(" · ") : typeof v === "string" ? v : "");
        const companyPosts = asText(lead.company_posts_content).trim();
        const sectorTrends = asText(lead.industry_trends).trim();
        // Company social links beyond the website.
        const socials = [
          lead.company_blog ? { label: "Blog", href: String(lead.company_blog).startsWith("http") ? String(lead.company_blog) : `https://${lead.company_blog}` } : null,
          lead.company_instagram ? { label: "Instagram", href: String(lead.company_instagram).startsWith("http") ? String(lead.company_instagram) : `https://instagram.com/${String(lead.company_instagram).replace(/^@/, "")}` } : null,
        ].filter(Boolean) as { label: string; href: string }[];
        const whatTheyDo = (scrape?.summary as string | null) || (lead.organization_description as string | null) || (lead.website_summary as string | null) || null;
        const ourPlay = angle.icp?.solutions_offered || angle.bio?.main_services || null;
        const valueProp = angle.bio?.value_proposition || angle.icp?.pain_points || null;
        const facts = [
          { label: "Industry", value: [lead.company_industry, lead.company_sub_industry].filter(Boolean).join(" · ") || null },
          { label: "Location", value: [lead.company_city, lead.company_country].filter(Boolean).join(", ") || null },
          { label: "Employees", value: (lead.employees ?? lead.company_employee_count) ?? null },
          { label: "Revenue", value: lead.annual_revenue ? `$${lead.annual_revenue}` : null },
        ].filter(f => f.value);
        const website = lead.company_website ? (String(lead.company_website).startsWith("http") ? String(lead.company_website) : `https://${lead.company_website}`) : null;
        return (
          <div className="rounded-2xl border mt-6 overflow-hidden lift" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `3px solid ${ZONE.account}`, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
            <div className="flex items-center gap-4 p-5 pb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shrink-0" style={{ background: `linear-gradient(135deg, ${ZONE.account}, color-mix(in srgb, ${ZONE.account} 70%, white))`, color: "#fff" }}>{lead.company_name[0]?.toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: C.textMuted, letterSpacing: "0.1em" }}>Company</p>
                <p className="text-[17px] font-bold leading-tight" style={{ color: C.textPrimary }}>{lead.company_name}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ScrapeCompanyButton leadId={id} hasScrape={!!scrape?.summary} />
                <Link href={`/companies/${encodeURIComponent(lead.company_name)}`} className="text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:shadow-sm" style={{ color: ZONE.account, border: `1px solid color-mix(in srgb, ${ZONE.account} 35%, transparent)` }}>View company <ExternalLink size={12} /></Link>
              </div>
            </div>
            {facts.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 pb-4">
                {facts.map(f => (
                  <div key={f.label} className="rounded-xl p-3" style={{ backgroundColor: `color-mix(in srgb, ${ZONE.account} 7%, transparent)` }}>
                    <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: C.textDim }}>{f.label}</p>
                    <p className="text-[13px] font-semibold" style={{ color: C.textBody }}>{f.value}</p>
                  </div>
                ))}
              </div>
            )}
            {(whatTheyDo || ourPlay) && (
              <div className="grid md:grid-cols-2 gap-3 px-5 pb-4">
                {whatTheyDo && (
                  <div className="rounded-xl p-4" style={{ backgroundColor: C.bg, borderLeft: "3px solid #0891B2" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#0891B2", letterSpacing: "0.08em" }}>What they do</p>
                    <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{String(whatTheyDo).slice(0, 500)}</p>
                  </div>
                )}
                {ourPlay && (
                  <div className="rounded-xl p-4" style={{ backgroundColor: C.bg, borderLeft: "3px solid #7C3AED" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#7C3AED", letterSpacing: "0.08em" }}>Our play for this industry</p>
                    <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{String(ourPlay).slice(0, 500)}</p>
                  </div>
                )}
              </div>
            )}
            {valueProp && (
              <div className="mx-5 mb-4 rounded-xl p-4" style={{ backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--brand, #c9a83a) 20%, transparent)" }}>
                <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}><span className="font-bold" style={{ color: gold }}>→ </span>{String(valueProp).slice(0, 320)}</p>
              </div>
            )}
            {(techs.length > 0 || kws.length > 0 || website || lead.recent_website_news || socials.length > 0 || companyPosts || sectorTrends) && (
              <div className="px-5 pb-5 pt-3 border-t" style={{ borderColor: C.border }}>
                <div className="flex items-center gap-3 flex-wrap">
                  {website && (
                    <a href={website} target="_blank" rel="noopener" className="text-xs font-medium hover:underline inline-flex items-center gap-1" style={{ color: C.blue }}>{lead.company_website} <ExternalLink size={10} /></a>
                  )}
                  {socials.map(s => (
                    <a key={s.label} href={s.href} target="_blank" rel="noopener" className="text-xs font-medium hover:underline inline-flex items-center gap-1" style={{ color: C.textMuted }}>{s.label} <ExternalLink size={10} /></a>
                  ))}
                </div>
                {(companyPosts || sectorTrends) && (
                  <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${ZONE.account} 7%, transparent)`, borderLeft: `3px solid ${ZONE.account}` }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: ZONE.account, letterSpacing: "0.08em" }}>Signals to mention</p>
                    {companyPosts && <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{companyPosts.slice(0, 280)}</p>}
                    {sectorTrends && <p className="text-[12px] leading-relaxed mt-1.5" style={{ color: C.textMuted }}><span className="font-semibold">Sector:</span> {sectorTrends.slice(0, 220)}</p>}
                  </div>
                )}
                {techs.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>Tech stack</p>
                    <div className="flex flex-wrap gap-1.5">{techs.slice(0, 12).map(t => <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-md" style={{ backgroundColor: C.blueLight, color: C.blue }}>{t}</span>)}</div>
                  </div>
                )}
                {kws.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>Keywords</p>
                    <div className="flex flex-wrap gap-1.5">{kws.slice(0, 12).map(k => <span key={k} className="text-[11px] font-medium px-2 py-0.5 rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`, color: gold }}>{k}</span>)}</div>
                  </div>
                )}
                {lead.recent_website_news && (
                  <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: "color-mix(in srgb, #D97706 10%, transparent)", borderLeft: "3px solid #F59E0B" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#D97706" }}>Recent news</p>
                    <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{lead.recent_website_news}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══ CONVERSATION STARTERS — the prospect's own recent activity, the
            best personalization fuel for a first touch. Only renders when we
            actually captured a post. ═══ */}
      {(() => {
        const starters = [
          lead.recent_linkedin_post ? { src: "LinkedIn", text: String(lead.recent_linkedin_post) } : null,
          lead.recent_ig_post ? { src: "Instagram", text: String(lead.recent_ig_post) } : null,
          lead.twitter_last_posts ? { src: "X / Twitter", text: Array.isArray(lead.twitter_last_posts) ? (lead.twitter_last_posts as string[]).join(" · ") : String(lead.twitter_last_posts) } : null,
        ].filter(Boolean).filter(s => s!.text.trim()) as { src: string; text: string }[];
        if (starters.length === 0) return null;
        return (
          <div className="rounded-2xl border mt-6 p-5 lift" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `3px solid ${ZONE.account}`, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: ZONE.account, letterSpacing: "0.1em" }}>Conversation starters · what they posted</p>
            <div className="space-y-2.5">
              {starters.map((s, i) => (
                <div key={i} className="flex gap-3 items-start p-3 rounded-xl" style={{ backgroundColor: C.bg }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shrink-0 mt-0.5" style={{ backgroundColor: `color-mix(in srgb, ${ZONE.account} 12%, transparent)`, color: ZONE.account }}>{s.src}</span>
                  <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{s.text.slice(0, 320)}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      </section>
      <section className="reveal" style={zoneStyle(ZONE.research)}>
      <ZoneLabel title="Research" accent={ZONE.research} />

      {/* ═══ DEEP-DIVE RESEARCH — long-form prep dossier. ═══ */}
      <div className="mt-6">
        <LeadSummaryTab
          leadId={id}
          initialSummary={lead.ai_summary ?? null}
          initialGeneratedAt={lead.ai_summary_at ?? null}
          accent={ZONE.research}
        />
      </div>

      {/* ═══ LINKEDIN ENRICHMENT — raw full profile, on demand. ═══ */}
      <div className="mt-6">
        <LinkedInEnrichment leadId={id} />
      </div>

      </section>
      <section className="reveal" style={zoneStyle(ZONE.copilot)}>
      <ZoneLabel title="Copilot" accent={ZONE.copilot} />

      {/* ═══ LEAD COPILOT — grounded Q&A chat with per-lead memory. ═══ */}
      <LeadQA leadId={id} initialHistory={(lead as any).ai_chat ?? null} accent={ZONE.copilot} />

      </section>
      <section className="reveal" style={zoneStyle(ZONE.campaign)}>
      <ZoneLabel title="Campaign" accent={ZONE.campaign} />

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
        let tone = "neutral", title = "", subtitle = "", color: string = C.textMuted;
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
      </section>
      <section className="reveal" style={zoneStyle(ZONE.details)}>
      <ZoneLabel title="Details" accent={ZONE.details} />

      <CompanyTabs tabs={[
        { label: "Profile Overview" },
        { label: "Campaign" },
        { label: "Calls", count: visibleCalls.length || undefined },
        { label: "Conversation" },
        { label: "Notes" },
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
                {lead.primary_work_email && (() => {
                  // Email-health flag, mirroring the wrong-number pill on Mobile.
                  // primary_email_status is set by the Instantly verification pass
                  // and the bounce handler — surface it here so a dead address is
                  // visible right on the lead, not only in the funnel.
                  const es = lead.primary_email_status as string | null;
                  const label = es === "bounced" ? "Bounced — undeliverable"
                    : es === "invalid" ? "Invalid address"
                    : es === "catch_all" ? "Catch-all — risky" : null;
                  const col = es === "catch_all" ? "#D97706" : C.red;
                  const bad = !!label;
                  return (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg" style={{ backgroundColor: bad ? `color-mix(in srgb, ${col} 10%, transparent)` : C.bg, border: bad ? `1px solid color-mix(in srgb, ${col} 32%, transparent)` : "none" }}>
                    <Mail size={14} style={{ color: bad ? col : C.email, marginTop: 2 }} />
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: C.textDim, fontSize: 10 }}>Email</p>
                      <a href={`mailto:${lead.primary_work_email}`} className="text-sm font-medium hover:underline block truncate"
                        style={{ color: bad ? col : C.textBody }}>{lead.primary_work_email}</a>
                      {label && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: col, backgroundColor: `color-mix(in srgb, ${col} 14%, transparent)` }}>
                          ⚠ {label}
                        </span>
                      )}
                    </div>
                  </div>
                  );
                })()}
                <div className="flex items-start gap-2.5 p-3 rounded-lg" style={{ backgroundColor: C.bg }}>
                  <Phone size={14} style={{ color: C.phone, marginTop: 2 }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: C.textDim, fontSize: 10 }}>Mobile</p>
                    {lead.allow_call === false ? (
                      // Wrong-number flag from the post-call popup. Surface
                      // the same inline-replace flow we use in the header
                      // so the seller can fix it here without scrolling up.
                      <WrongNumberPill
                        leadId={id}
                        currentPhone={lead.primary_phone ?? null}
                      />
                    ) : (
                      <EditableLeadField
                        leadId={id}
                        field="primary_phone"
                        value={lead.primary_phone ?? null}
                        placeholder="+54 9 11 1234 5678"
                        inputType="tel"
                        displayAs="tel"
                        ariaLabel="Edit mobile phone"
                      />
                    )}
                  </div>
                </div>
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

            {/* Key notes — notes the seller pinned from the Notes tab */}
            <LeadPinnedNotes leadId={id} />

            {/* Personalized Info — client-specific enrichment (Pathway: credit signals) */}
            <PersonalizedInfoPanel enrichment={lead.enrichment} />

            {/* Company Info moved to the Overview flow as a single clickable
                card (links to /companies/[name]) — removed here to avoid the
                duplicate Company block. */}

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
              {visibleCalls.length > 0 ? `${visibleCalls.length} call${visibleCalls.length === 1 ? "" : "s"} recorded` : "No calls yet"}
            </p>
            <div className="flex items-center gap-2">
              {(lead.primary_phone || lead.primary_secondary_phone) && (
                <CallButton
                  phone={lead.primary_phone ?? lead.primary_secondary_phone ?? null}
                  leadId={id}
                  size="sm"
                  defaultNumberId={campaign?.aircall_number_id ?? null}
                  phones={[
                    ...(lead.primary_phone ? [{ label: "Personal", value: lead.primary_phone }] : []),
                    ...(lead.primary_secondary_phone ? [{ label: "Company", value: lead.primary_secondary_phone }] : []),
                  ]}
                  isCallStep={isCallStep}
                  nextStepName={callStepIndex > 0 && callStepIndex < steps.length ? steps[callStepIndex] : undefined}
                />
              )}
              <SyncAircallButton />
            </div>
          </div>
          {/* Wrong-number banner: a one-liner above the call list when the
              lead's allow_call=false, so the seller landing on the Calls
              tab sees the warning + can jump back to the header pill to
              replace the number. The badge is repeated once at the top
              (not on every row — would be noisy with N call cards). */}
          {lead.allow_call === false && (
            <div
              className="rounded-xl border px-4 py-2.5 mb-3 flex items-center gap-2 text-xs"
              style={{
                backgroundColor: "color-mix(in srgb, #DC2626 8%, transparent)",
                borderColor: "color-mix(in srgb, #DC2626 30%, transparent)",
                color: "#DC2626",
              }}
            >
              <AlertTriangle size={13} />
              <span className="font-semibold">Phone marked wrong</span>
              <span className="opacity-75">— scroll to the top of the page to replace it and re-enable Call.</span>
            </div>
          )}
          {visibleCalls.length === 0 ? (
            <div className="rounded-2xl border p-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
              <Phone size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
              <p className="text-sm font-medium" style={{ color: C.textBody }}>No calls recorded yet</p>
              <p className="text-xs mt-1" style={{ color: C.textMuted }}>
                Calls made via Aircall from the Queue will appear here. Click &ldquo;Sync from Aircall&rdquo; above to pull recent calls.
              </p>
            </div>
          ) : (
            visibleCalls.map((call: any) => <CallCard key={call.id} call={call} personalPhone={lead.primary_phone ?? null} companyPhone={lead.primary_secondary_phone ?? null} />)
          )}
        </div>

        {/* Summary moved out to a card under LinkedIn Enrichment (boss
            2026-06-09) — no longer a tab. */}

        {/* ── Conversation ── the real LinkedIn/email/call thread
            (sent + received + connection request), replacing the old
            event-only Recent Activity timeline. Same chat component used in
            Results/Opportunities so the conversation reads the same everywhere. */}
        <LeadChatThread leadId={id} leadName={contactName} />

        {/* ── TAB 6: Notes ── the lead collaboration hub (notes + @mentions + pin) */}
        <LeadNotes leadId={id} />

        {/* ── TAB 7: Social & Content ── */}
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
      </section>
    </div>
  );
}
