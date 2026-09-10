import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";
import { decryptLeadPayload, redactClientLead, hydrateDecryptedLead, logDataAccess, bufferFromSupabaseBytea } from "@/lib/leads-crypto";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import CompanyTabs from "@/components/CompanyTabs";
import PreCallBrief from "@/components/PreCallBrief";
import LeadActivitiesPanel from "@/components/LeadActivitiesPanel";
import LeadNotes from "@/components/LeadNotes";
import Breadcrumb from "@/components/Breadcrumb";
import RecentLeadTracker from "@/components/RecentLeadTracker";
import LeadHero from "@/components/lead/LeadHero";
import LeadOverview from "@/components/lead/LeadOverview";
import LeadEngagement from "@/components/lead/LeadEngagement";
import LeadResearch from "@/components/lead/LeadResearch";
import type { TimelineEvent } from "@/components/lead/LeadTimeline";
import { countryToTimeZone } from "@/lib/prospect-time";
import { ACTIVITY_SELECT } from "@/lib/activities";
import { getT, getServerLocale } from "@/lib/i18n-server";
import { intlTag } from "@/lib/i18n-locale";
import { renderPlaceholders } from "@/lib/placeholders";

// Bypass Next's render cache — freshly-sent steps must show immediately.
export const dynamic = "force-dynamic";

const gold = "var(--brand, #c9a83a)";

// ── Data fetchers ──

async function getLead(id: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from("leads").select("*").eq("id", id).single();
  if (!data) return null;
  if (data.source !== "client") return data;
  const scope = await getUserScope();
  const sameTenant = scope.companyBioId && scope.companyBioId === data.company_bio_id;
  if (!sameTenant) {
    if (scope.tier === "super_admin") return redactClientLead(data);
    return null;
  }
  if (!data.encrypted_payload) return redactClientLead(data);
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
    .select("id, name, channel, status, current_step, sequence_steps, started_at, next_step_due_at, paused_until, completed_at, aircall_number_id, call_advance_mode, metadata, sellers(name)")
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
    `${url}/rest/v1/calls?lead_id=eq.${leadId}&order=started_at.desc&select=id,aircall_call_id,direction,status,duration,phone_number,recording_url,recording_storage_path,transcript,notes,started_at,ended_at,classification,ai_confidence,ai_summary,coach_analysis,coach_score,coach_generated_at,coach_model,summary,summary_generated_at`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
  );
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

// Activities for this lead, server-seeded so the Overview Next-Action and the
// Activities tab don't each fire a client fetch (RLS scopes to the viewer's
// tenant; the client refetches after any mutation).
async function getActivities(leadId: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("activities")
    .select(ACTIVITY_SELECT)
    .eq("lead_id", leadId)
    .order("due_at", { ascending: true, nullsFirst: false });
  return data ?? [];
}

// Compact account counts for the Overview "Company snapshot" (two cheap
// queries; scoped to the tenant via RLS). Never fetches the full company page.
async function getCompanySnapshot(companyName: string | null, bioId: string | null) {
  if (!companyName || !bioId) return null;
  const supabase = await getSupabaseServer();
  const { data: siblings } = await supabase
    .from("leads").select("id").eq("company_name", companyName).eq("company_bio_id", bioId).limit(1000);
  const ids = (siblings ?? []).map((r: any) => r.id);
  let activeCampaigns = 0;
  if (ids.length) {
    const { count } = await supabase
      .from("campaigns").select("id", { count: "exact", head: true })
      .in("lead_id", ids).in("status", ["active", "paused"]);
    activeCampaigns = count ?? 0;
  }
  return { contacts: ids.length, activeCampaigns };
}

// ── Helpers ──

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT",    color: C.hot,    bg: C.hotBg };
  if (score && score >= 50)               return { label: "WARM",   color: C.warm,   bg: C.warmBg };
  return                                         { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

const statusMap: Record<string, { labelKey: string; color: string }> = {
  new:           { labelKey: "ld.status.new",          color: C.blue },
  contacted:     { labelKey: "ld.status.contacted",    color: C.orange },
  connected:     { labelKey: "ld.status.connected",    color: C.accent },
  responded:     { labelKey: "ld.status.responded",    color: C.green },
  qualified:     { labelKey: "ld.status.qualified",    color: C.green },
  proposal_sent: { labelKey: "ld.status.proposalSent", color: C.accent },
  closed_won:    { labelKey: "ld.status.won",          color: C.green },
  closed_lost:   { labelKey: "ld.status.lost",         color: C.red },
  nurturing:     { labelKey: "ld.status.nurturing",    color: C.textMuted },
};

function renderTemplateFallback(template: string, lead: any, sellerName: string | null): string {
  const first = lead?.primary_first_name ?? "there";
  const last = lead?.primary_last_name ?? "";
  const full = `${first} ${last}`.trim();
  const company = lead?.company_name ?? "";
  const role = lead?.primary_title_role ?? "";
  const seller = sellerName ?? "";
  return (template ?? "")
    .replaceAll("{{first_name}}", first).replaceAll("{{last_name}}", last).replaceAll("{{full_name}}", full)
    .replaceAll("{{company_name}}", company).replaceAll("{{company}}", company)
    .replaceAll("{{role}}", role).replaceAll("{{title}}", role)
    .replaceAll("{{seller_name}}", seller).replaceAll("{{seller_company}}", "");
}

// ── Page ──

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const locale = await getServerLocale();
  const localeTag = intlTag(locale);
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  const viewerScope = await getUserScope();
  const canAssignActivities = canViewAllTenantData(viewerScope.tier);
  const bioId = (lead as any).company_bio_id ?? null;

  const [campaign, rawMessages, replies, calls, activities] = await Promise.all([
    getCampaign(id), getMessages(id), getReplies(id), getCalls(id), getActivities(id),
  ]);

  const visibleCalls = ((calls as any[]) ?? []).filter((c: any) => c.aircall_call_id != null || c.classification != null);
  const seqNav = await getSequenceNav(id, (campaign as any)?.name ?? null, bioId);
  const companySnapshot = await getCompanySnapshot((lead as any).company_name ?? null, bioId);

  const sellerName = (campaign as any)?.sellers?.name ?? null;
  const rawAutoReplies = (campaign?.metadata as { autoReplies?: { positive?: string; negative?: string } } | null)?.autoReplies ?? null;
  const renderReply = (s?: string) =>
    s ? renderPlaceholders(s, lead as Record<string, unknown>, { name: sellerName }, { strict: false })
          .replace(/\{\{[^}]*\}\}/g, "").replace(/[ \t]{2,}/g, " ").trim()
      : (s ?? "");
  const renderedAutoReplies = rawAutoReplies
    ? { positive: renderReply(rawAutoReplies.positive), negative: renderReply(rawAutoReplies.negative) }
    : null;

  // Snapshot the actually-sent text (rendered_content) for messages missing it.
  const messages = (rawMessages ?? []).map((m: any) => {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.rendered_content === "string" && meta.rendered_content.length > 0) return m;
    if (m.status !== "sent" || !m.content) return m;
    return { ...m, metadata: { ...meta, rendered_content: renderTemplateFallback(m.content, lead, sellerName), rendered_source: "fallback-server-render" } };
  });

  const score = scoreBadge(lead.lead_score, lead.is_priority);
  const st = statusMap[lead.status] ?? statusMap.new;
  const statusLabel = t(st.labelKey);
  const initials = `${(lead.primary_first_name ?? "?")[0]}${(lead.primary_last_name ?? "?")[0]}`.toUpperCase();
  const avatarBg = score.label === "HOT" ? gold : score.label === "WARM" ? "#334155" : "#9CA3AF";
  const contactName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || lead.company_name || "Unknown";

  const totalMsgsSent = messages.filter((m: any) => m.status === "sent").length;
  const totalReplies = replies.length;
  const positiveReplies = replies.filter((r: any) => ["positive", "meeting_intent"].includes(r.classification ?? "")).length;

  // Sequence progress
  const channelStepLabels: Record<string, string> = {
    linkedin: t("chan.linkedin"), email: t("chan.email"), call: t("chan.call"),
    whatsapp: t("chan.whatsapp"), sms: t("chan.sms"), instagram: t("chan.instagram"),
  };
  const rawSteps: any[] = campaign?.sequence_steps ?? [];
  const steps = rawSteps.map((s: any) => {
    if (typeof s === "string") return channelStepLabels[s.toLowerCase()] ?? s;
    if (s?.channel) return channelStepLabels[s.channel.toLowerCase()] ?? s.channel;
    return t("ld.unknownStep");
  });
  const currentStep = campaign?.current_step ?? 0;
  const callStepIndex = rawSteps.findIndex((s: any) => {
    const ch = typeof s === "string" ? s : s?.channel;
    return ch && ch.toLowerCase() === "call";
  }) + 1;
  const isCallStep = callStepIndex > 0 && currentStep === callStepIndex;
  const nextStepName = callStepIndex > 0 && callStepIndex < steps.length ? steps[callStepIndex] : undefined;
  const campDone = campaign?.status === "completed" || campaign?.status === "failed";
  const connectionStepMsg = messages.find((m: any) => m.campaign_id === campaign?.id && m.step_number === 0) ?? null;
  const connectionStepSent = connectionStepMsg?.status === "sent";
  const effectiveDenominator = steps.length + (connectionStepMsg ? 1 : 0);
  const effectiveNumerator = currentStep + (connectionStepSent ? 1 : 0);
  const stepPct = campDone ? 100 : effectiveDenominator > 0 ? Math.round((effectiveNumerator / effectiveDenominator) * 100) : 0;
  const stepStr = campaign ? `${campDone ? steps.length : Math.min(currentStep + 1, steps.length)}/${steps.length}` : "—";

  // ── Merged Engagement timeline (server-built once, rendered client-side) ──
  const events: TimelineEvent[] = [];
  for (const m of messages) {
    if (m.status !== "sent" || !m.sent_at) continue;
    const rendered = ((m.metadata as any)?.rendered_content as string) || m.content || null;
    if (m.step_number === 0) {
      events.push({ id: `m-${m.id}`, kind: "connection", at: m.sent_at, channel: "linkedin", title: t("ld2.tl.connection") });
    } else {
      const ch = (m.channel || campaign?.channel || "email") as string;
      const chLabel = channelStepLabels[ch.toLowerCase()] ?? ch;
      events.push({ id: `m-${m.id}`, kind: "message", at: m.sent_at, channel: ch, title: `${chLabel} ${t("ld2.tl.sent")}`, body: rendered });
    }
  }
  for (const r of replies as any[]) {
    if (!r.received_at || (r.channel || "") === "call") continue;
    const cls = r.classification || "";
    const tone = ["positive", "meeting_intent"].includes(cls) ? "positive" : ["negative", "unsubscribe", "spam"].includes(cls) ? "negative" : "neutral";
    events.push({ id: `r-${r.id}`, kind: "reply", at: r.received_at, channel: r.channel || "email", title: t("ld2.tl.reply"), body: r.reply_text, tone, meta: cls || undefined });
  }
  for (const c of visibleCalls as any[]) {
    if (!c.started_at) continue;
    const cls = (c.classification || "").toLowerCase();
    const tone = /positive|interest|qualified|meeting/.test(cls) ? "positive"
      : /callback|call back|follow/.test(cls) ? "warning"
      : /not|negative|wrong|no answer|voicemail/.test(cls) ? "negative" : "neutral";
    const dur = c.duration ? `${Math.floor(c.duration / 60)}:${String(c.duration % 60).padStart(2, "0")}` : null;
    events.push({ id: `c-${c.id}`, kind: "call", at: c.started_at, channel: "call", title: t("ld2.tl.call"), body: c.classification || c.ai_summary || c.notes || null, tone, meta: [dur, c.classification].filter(Boolean).join(" · ") || undefined });
  }
  if (campaign?.started_at) {
    events.push({ id: `camp-${campaign.id}`, kind: "campaign", at: campaign.started_at, title: `${t("ld2.tl.campaignStarted")} · ${campaign.name ?? ""}`.trim(), meta: sellerName || undefined });
  }
  for (const a of activities as any[]) {
    const at = a.due_at || a.completed_at || a.created_at;
    if (!at) continue;
    const isCallback = a.source === "call_callback";
    events.push({ id: `a-${a.id}`, kind: "activity", at, channel: a.type === "call" ? "call" : null, title: a.title, body: a.description, tone: a.status === "completed" ? "neutral" : isCallback ? "warning" : "info", meta: [a.status, isCallback ? "callback" : null].filter(Boolean).join(" · ") || undefined });
  }

  const tz = countryToTimeZone(lead.company_country);
  const place = lead.company_city || lead.company_country || null;
  const metrics = { messages: totalMsgsSent, replies: totalReplies, positive: positiveReplies, calls: visibleCalls.length, step: stepStr, stepPct };

  return (
    <div className="p-6 w-full fade-in">
      <Breadcrumb crumbs={[{ label: t("ld.leads"), href: "/leads" }, { label: lead.company_name ?? t("ld.contact") }, { label: contactName }]} />
      <RecentLeadTracker leadId={id} name={contactName} company={lead.company_name ?? null} />

      {/* HERO */}
      <LeadHero
        lead={lead} leadId={id} contactName={contactName} initials={initials} avatarBg={avatarBg}
        statusLabel={statusLabel} statusColor={st.color} scoreLabel={score.label} scoreColor={score.color}
        campaign={campaign} seqNav={seqNav} isCallStep={isCallStep} nextStepName={nextStepName}
        autoReplies={renderedAutoReplies} metrics={{ messages: totalMsgsSent, replies: totalReplies, positive: positiveReplies, step: stepStr }}
        tz={tz} place={place} localeTag={localeTag}
      />

      {/* PRE-CALL BRIEF (V3, unchanged) — standalone above the tabs */}
      <PreCallBrief
        leadId={id}
        initialPoints={(lead as any).call_talking_points ?? null}
        initialGeneratedAt={(lead as any).call_talking_points_at ?? null}
      />

      {/* DETAILS — 5 canonical tabs */}
      <section className="reveal rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
        <CompanyTabs tabs={[
          { label: t("ld2.tab.overview") },
          { label: t("ld.tab.activities") },
          { label: t("ld2.tab.engagement") },
          { label: t("ld2.tab.research") },
          { label: t("ld.tab.notes") },
        ]}>
          <div className="px-4 sm:px-6 pb-6">
            <LeadOverview
              lead={lead} leadId={id} campaign={campaign} metrics={metrics}
              initialActivities={activities as any[]} canAssignActivities={canAssignActivities}
              autoReplies={renderedAutoReplies} tz={tz} place={place} company={companySnapshot}
            />
          </div>
          <div className="px-4 sm:px-6 pb-6">
            <LeadActivitiesPanel
              leadId={id} leadLabel={contactName} company={(lead as any).company_name ?? null}
              leadPhone={(lead as any).primary_phone ?? null} leadCountry={(lead as any).company_country ?? null}
              leadStatus={(lead as any).status ?? null} canAssignOthers={canAssignActivities}
              initialActivities={activities as any[]} variant="full"
            />
          </div>
          <div className="px-4 sm:px-6 pb-6">
            <LeadEngagement
              events={events} localeTag={localeTag} campaign={campaign} messages={messages}
              replies={replies} calls={visibleCalls} lead={lead} leadId={id}
              step={stepStr} stepPct={stepPct} defaultNumberId={campaign?.aircall_number_id ?? null}
              isCallStep={isCallStep} nextStepName={nextStepName}
            />
          </div>
          <div className="px-4 sm:px-6 pb-6">
            <LeadResearch lead={lead} leadId={id} />
          </div>
          <div className="px-4 sm:px-6 pb-6">
            <LeadNotes leadId={id} />
          </div>
        </CompanyTabs>
      </section>
    </div>
  );
}
