import { getSupabaseServer } from "@/lib/supabase-server";
import { selectAllPages } from "@/lib/supabase-bulk";
import { C } from "@/lib/design";
import { getT } from "@/lib/i18n-server";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, PlayCircle, PauseCircle, CheckCircle, XCircle,
  Users, Clock, Settings, Zap, UserPlus,
} from "lucide-react";
import CampaignDetailClient from "./CampaignDetailClient";
import { type FlowMetrics, type DrillLead } from "@/components/FlowMetricsPanel";
import { isRealCall, isConnected, isPositiveOutcome, callOutcomeGroup, healthOf, pctOf, type CallRow } from "@/lib/flow-metrics-lib";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

// Hydrates client-source leads in a list by decrypting encrypted_payload
// and merging the result over the plain row. Resolves the tenant key once
// per tenant (a campaign view typically only contains one tenant's leads,
// but we group defensively so a future cross-tenant view doesn't break).
async function hydrateClientLeads<L extends { id?: string; source?: string | null; encrypted_payload?: unknown; company_bio_id?: string | null }>(rows: L[]): Promise<L[]> {
  if (rows.length === 0) return rows;
  const clientRows = rows.filter(r => r.source === "client" && r.encrypted_payload && r.company_bio_id);
  if (clientRows.length === 0) return rows;
  const tenantIds = Array.from(new Set(clientRows.map(r => r.company_bio_id as string)));
  const keys = new Map<string, Buffer>();
  for (const bioId of tenantIds) {
    try {
      const { key } = await resolveTenantKey(bioId);
      keys.set(bioId, key);
    } catch (err) {
      console.error("[campaigns/[id]] tenant key resolution failed for", bioId, err);
    }
  }
  return rows.map(r => {
    if (r.source !== "client" || !r.encrypted_payload || !r.company_bio_id) return r;
    const key = keys.get(r.company_bio_id);
    if (!key) return r;
    try {
      const blob = bufferFromSupabaseBytea(r.encrypted_payload);
      const decrypted = decryptWithResolvedKey(blob, key);
      return { ...r, ...decrypted, encrypted_payload: undefined } as L;
    } catch (err) {
      console.error("[campaigns/[id]] decrypt failed for lead", r.id, err);
      return r;
    }
  });
}

export const dynamic = "force-dynamic";
// Large flows (Pathway, 5000+ siblings) build heavy metrics in memory; headroom.
export const maxDuration = 60;

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  whatsapp: { icon: Mail,   color: "#22c55e", label: "WhatsApp" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const statusMeta: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  active:    { label: "Active",    color: C.green,    bg: C.greenLight,  icon: PlayCircle },
  paused:    { label: "Paused",    color: "#D97706",  bg: "color-mix(in srgb, #D97706 13%, transparent)",     icon: PauseCircle },
  completed: { label: "Completed", color: C.textMuted, bg: C.surface,    icon: CheckCircle },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight,    icon: XCircle },
};

async function getCampaign(id: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("*, leads(id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, company_industry, icp_profile_id), sellers(name, company_bio_id, linkedin_daily_limit)")
    .eq("id", id)
    .single();
  if (data?.leads) {
    const [hydrated] = await hydrateClientLeads([data.leads as Record<string, unknown>]);
    return { ...data, leads: hydrated } as typeof data;
  }
  return data;
}

async function getMessages(campaignId: string) {
  // Use direct REST call with no-store so Next/Supabase never caches stale message state.
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/campaign_messages?campaign_id=eq.${campaignId}&select=*&order=step_number.asc`;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return (await res.json()) as any[];
}

async function getSiblingCampaigns(campaignName: string, excludeId: string) {
  const supabase = await getSupabaseServer();
  // PAGED. This was `.limit(5000)`, raised from 500 after a 536-lead flow read
  // a fake 501 — but a limit does not lift PostgREST's max_rows, which caps a
  // response at 1000 no matter what you ask for. So the 1 136-lead PE & VC USA
  // flow read 1000 siblings + the one in the URL and displayed "1001 total
  // leads · 1001 in flow", and Pause All only ever saw those 1001.
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await selectAllPages<Record<string, unknown>>("campaigns", () =>
      supabase
        .from("campaigns")
        .select("id, status, current_step, sequence_steps, channel, last_step_at, started_at, seller_id, leads(id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, lead_score, is_priority, allow_linkedin, allow_email, allow_call), sellers(name)")
        .eq("name", campaignName)
        .neq("id", excludeId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }),
    );
  } catch {
    rows = [];
  }
  // Decrypt all sibling leads in one pass. Each campaign carries an inner
  // `leads` object — collect them, hydrate, and re-attach in order.
  const innerLeads = rows.map((c: any) => c.leads).filter(Boolean) as Record<string, unknown>[];
  const hydratedLeads = await hydrateClientLeads(innerLeads);
  const leadById = new Map(hydratedLeads.map(l => [(l as any).id as string, l]));
  return rows.map((c: any) => c.leads ? { ...c, leads: leadById.get(c.leads.id) ?? c.leads } : c);
}

async function getUnlinkedLeadsByProfile(companyBioId: string | null) {
  const supabase = await getSupabaseServer();
  // Tenant scope: leads + icp_profiles + active campaigns must all belong to the
  // same company_bio. Without this filter, super-admins viewing a campaign would
  // see leads from every tenant in the "Add Leads" tab.
  if (!companyBioId) return [];

  // ID-first sweep so the "Add Leads" picker shows EVERY unenrolled lead, not
  // just a recent slice. The old `.limit(200)` ordered by created_at meant the
  // newest leads (almost always the just-enrolled ones) filled the 200-row
  // budget, so older unenrolled leads silently vanished — De Vera showed "0
  // eligible" while 165 leads sat outside any flow. We page the lightweight id
  // list in full, subtract the enrolled set, then hydrate (decrypt) only the
  // unenrolled leads we actually display.
  // Terminal-status leads (lost/won) must never resurface in the picker — a
  // lost lead belongs in Results → Re-nurture, not back in an active flow.
  // NOTE: only the values that exist in the `lead_status` enum. "won" was NOT
  // a valid enum value, so PostgREST rejected the whole `status=not.in.(…)`
  // filter with 22P02 → the leads query returned nothing → Add Leads showed 0
  // for EVERY flow in EVERY tenant. Fixed 2026-08-25.
  const TERMINAL_LEAD_STATUSES = ["closed_lost", "closed_won"];
  const tenantLeadIds: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await supabase
      .from("leads").select("id").eq("company_bio_id", companyBioId)
      .not("status", "in", `(${TERMINAL_LEAD_STATUSES.join(",")})`)
      .order("created_at", { ascending: false }).range(from, from + 999);
    if (!page || page.length === 0) break;
    page.forEach(r => tenantLeadIds.push(r.id as string));
    if (page.length < 1000) break;
  }

  // Enrolled set, bounded by this tenant's lead ids (chunked so the `.in()` URL
  // never blows up). A global `.in("status",[...])` scan truncates at Supabase's
  // 1000-row default once all tenants' active rows exceed it — that bug let
  // already-enrolled leads reappear here as "eligible" and get re-added,
  // creating duplicate campaign rows. Scoping by lead_id keeps it exact.
  const activeSet = new Set<string>();
  for (let i = 0; i < tenantLeadIds.length; i += 300) {
    const chunk = tenantLeadIds.slice(i, i + 300);
    const { data: enrolled } = await supabase
      .from("campaigns").select("lead_id")
      .in("status", ["active", "paused"]).in("lead_id", chunk);
    (enrolled ?? []).forEach(c => { if (c.lead_id) activeSet.add(c.lead_id); });
  }

  const unlinkedIds = tenantLeadIds.filter(id => !activeSet.has(id)).slice(0, 1000);
  const { data: rawAllLeads } = unlinkedIds.length
    ? await supabase
        .from("leads")
        .select("id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, primary_title_role, lead_score, allow_linkedin, allow_email, allow_call, icp_profile_id, company_bio_id")
        .in("id", unlinkedIds)
    : { data: [] };
  const allLeads = await hydrateClientLeads((rawAllLeads ?? []) as Record<string, unknown>[]);

  const { data: profiles } = await supabase
    .from("icp_profiles").select("id, profile_name").eq("status", "approved").eq("company_bio_id", companyBioId);
  const profileMap: Record<string, string> = {};
  (profiles ?? []).forEach(p => { profileMap[p.id] = p.profile_name; });

  const unlinkedTyped = (allLeads ?? []) as Array<Record<string, unknown> & { id: string; icp_profile_id: string | null }>;
  const unlinked = unlinkedTyped.filter(l => !activeSet.has(l.id));
  const grouped: Record<string, { profileName: string; leads: any[] }> = {};
  for (const l of unlinked) {
    const key = l.icp_profile_id ?? "__none";
    if (!grouped[key]) grouped[key] = { profileName: profileMap[l.icp_profile_id ?? ""] ?? "Unassigned", leads: [] };
    grouped[key].leads.push(l);
  }
  return Object.values(grouped);
}

// Aggregate the whole flow's outreach status from campaign_messages + lead
// signals. Chunked by 80 campaign ids so each REST page stays well under the
// 1000-row default (a single global `.in()` would silently truncate — the same
// trap that produced the De Vera ghost counts). Service-key REST because RLS
// hides campaign_messages from the cookie client.
function failCategory(e: string | null): string {
  const s = (e ?? "").toLowerCase();
  if (!s) return "Unknown";
  if (s.includes("name mismatch")) return "Name mismatch";
  if (s.includes("not found") || s.includes("/users/") || s.includes("404")) return "Profile not found";
  if (s.includes("422") || s.includes("limit")) return "Rate limit";
  if (s.includes("bounce")) return "Bounce";
  if (s.includes("empty body") || s.includes("placeholder")) return "Content/placeholder";
  return "Other";
}

async function getFlowMetrics(
  campaignIds: string[],
  leadIds: string[],
  sequence: { channel: string; daysAfter: number }[],
  leadInfo: Map<string, { name: string; company: string | null }>,
  channelsUsed: string[],
  progressPct: number,
  campRows: { lead_id: string; status: string; current_step: number | null; started_at: string | null; seller_id: string | null; last_step_at: string | null }[],
  dailyLimit: number | null,
  sellerMap: Map<string, string>,
): Promise<FlowMetrics | null> {
  if (campaignIds.length === 0) return null;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const sbKey = process.env.SUPABASE_SERVICE_KEY!;
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const restGet = async (path: string): Promise<any[]> => {
    try { const r = await fetch(`${sbUrl}/rest/v1/${path}`, { headers, cache: "no-store" }); return r.ok ? await r.json() : []; } catch { return []; }
  };
  type Msg = { lead_id: string; step_number: number; channel: string; status: string; sent_at: string | null; error_details: string | null; metadata: Record<string, unknown> | null };
  let msgs: Msg[] = [];
  for (let i = 0; i < campaignIds.length; i += 80) {
    const inClause = `(${campaignIds.slice(i, i + 80).join(",")})`;
    msgs = msgs.concat(await restGet(`campaign_messages?campaign_id=in.${encodeURIComponent(inClause)}&select=lead_id,step_number,channel,status,sent_at,error_details,metadata`));
  }
  // Cohort scoping (filters): campaign_messages are fetched by the flow's
  // campaign ids, so restrict them to the leads actually in this cohort
  // (seller/date-filtered leadIds) — otherwise a filtered view would still
  // count the whole flow's activity. No-op when leadIds = full flow.
  const cohortSet = new Set(leadIds);
  msgs = msgs.filter(m => cohortSet.has(m.lead_id));
  const connected = new Set<string>(); const bouncedSet = new Set<string>(); const lostSet = new Set<string>();
  const qualifiedSet = new Set<string>(); // meetings = unique leads at status 'qualified' (single attribution — see def #5)
  for (let i = 0; i < leadIds.length; i += 100) {
    const inClause = `(${leadIds.slice(i, i + 100).join(",")})`;
    const rows = await restGet(`leads?id=in.${encodeURIComponent(inClause)}&select=id,linkedin_connected,primary_email_status,status`);
    rows.forEach((r: any) => {
      if (r.linkedin_connected) connected.add(r.id);
      if (r.primary_email_status === "bounced") bouncedSet.add(r.id);
      if (r.status === "closed_lost") lostSet.add(r.id);
      if (r.status === "qualified") qualifiedSet.add(r.id);
    });
  }
  // Reply classification per lead (strongest: positive > question > negative > other)
  // + the latest reply text so the UI can show exactly what each lead said.
  const replyClass = new Map<string, string>();
  const replyText = new Map<string, { text: string; at: string; channel: string }>();
  const repliesByChannel: Record<string, Set<string>> = {};
  const positiveByChannel: Record<string, Set<string>> = {};
  const firstReplyAt = new Map<string, string>();
  const replyDates: string[] = [];
  // Bucketing aligned with the inbox classBadge so Metrics + Inbox + lead
  // detail show the SAME label. rank = which wins when a lead has >1 reply.
  // not_now + voicemail get their OWN buckets so the kanban can badge them
  // distinctly (boss 2026-06-09), but they still roll into followup/other for
  // the Metrics reply breakdown (see below) so those counts don't shift.
  const rank: Record<string, number> = { positive: 5, question: 4, followup: 3, negative: 2, not_now: 1.8, voicemail: 1.3, other: 1 };
  const bucketOf = (c: string) =>
    (c === "positive" || c === "meeting_intent") ? "positive"
    : (c === "question" || c === "needs_info") ? "question"
    : (c === "follow_up" || c === "nurturing") ? "followup"
    : (c === "not_now") ? "not_now"
    : (c === "voicemail") ? "voicemail"
    : (c === "negative") ? "negative"
    : "other";
  for (let i = 0; i < leadIds.length; i += 100) {
    const inClause = `(${leadIds.slice(i, i + 100).join(",")})`;
    const rows = await restGet(`lead_replies?lead_id=in.${encodeURIComponent(inClause)}&select=lead_id,classification,channel,reply_text,received_at`);
    rows.forEach((r: any) => {
      const c = (r.classification ?? "").toLowerCase();
      const bucket = bucketOf(c);
      const prev = replyClass.get(r.lead_id);
      if (!prev || rank[bucket] > rank[prev]) replyClass.set(r.lead_id, bucket);
      const at = r.received_at ?? "";
      const prevText = replyText.get(r.lead_id);
      if (r.reply_text && (!prevText || at > prevText.at)) replyText.set(r.lead_id, { text: r.reply_text, at, channel: r.channel ?? "other" });
      const fr = firstReplyAt.get(r.lead_id);
      if (at && (!fr || at < fr)) firstReplyAt.set(r.lead_id, at);
      if (at) replyDates.push(at);
      const ch = r.channel ?? "other"; (repliesByChannel[ch] ||= new Set()).add(r.lead_id);
      if (bucket === "positive") (positiveByChannel[ch] ||= new Set()).add(r.lead_id);
    });
  }
  const repliedSet = new Set(replyClass.keys());
  const positiveSet = new Set([...replyClass].filter(([, b]) => b === "positive").map(([id]) => id));

  const sent = msgs.filter(m => m.status === "sent");
  const requestsSent = sent.filter(m => m.step_number === 0 && m.channel === "linkedin").length;
  const step0SentLeads = new Set(sent.filter(m => m.step_number === 0 && m.channel === "linkedin").map(m => m.lead_id));
  const accepted = connected.size;
  const totalLeads = leadIds.length;
  const messagedSet = new Set(sent.filter(m => m.step_number > 0).map(m => m.lead_id));
  // Channel-agnostic "contacted" = a lead that received ANY sent message on ANY
  // channel (LinkedIn invite/DM, email, etc.). This is the funnel stage that
  // works for multichannel flows — unlike "accepted" (LinkedIn-only), which
  // made the funnel non-monotonic (email-heavy flows showed Messages 40 >
  // Accepted 5 → "800% of accepted"). Boss 2026-06-11.
  const contactedSet = new Set(sent.map(m => m.lead_id));
  const pendingAcceptSet = new Set([...step0SentLeads].filter(id => !connected.has(id) && !lostSet.has(id)));

  // Per-step breakdown (CR = step 0, then sequence steps).
  const nameOfEarly = (id: string): DrillLead => ({ id, name: leadInfo.get(id)?.name ?? "Unknown", company: leadInfo.get(id)?.company ?? null });
  const withDetail = (id: string, detail: string): DrillLead => ({ ...nameOfEarly(id), detail });
  const isPending = (s: string) => s === "queued" || s === "draft" || s === "dispatching";
  // Per-step reply attribution: each lead's FIRST reply is credited to the
  // highest step_number that lead had SENT at/before the reply timestamp —
  // i.e. the message that earned the response. This is the per-step reply
  // rate competitors (Lemlist/Smartlead) lead with: it shows WHICH step's
  // copy converts, so you know what to rewrite.
  const repliesByStep: Record<number, number> = {};
  for (const [leadId, replyAt] of firstReplyAt) {
    let respStep = -1;
    for (const m of msgs) {
      if (m.lead_id === leadId && m.status === "sent" && m.sent_at && m.sent_at <= replyAt && m.step_number > respStep) respStep = m.step_number;
    }
    if (respStep >= 0) repliesByStep[respStep] = (repliesByStep[respStep] ?? 0) + 1;
  }
  const stepNums = [...(channelsUsed.includes("linkedin") ? [0] : []), ...Array.from({ length: sequence.length }, (_, i) => i + 1)];
  const steps = stepNums.map(n => {
    const at = msgs.filter(m => m.step_number === n);
    const ch = n === 0 ? "linkedin" : (sequence[n - 1]?.channel ?? "linkedin");
    const sentN = at.filter(m => m.status === "sent").length;
    const repliesN = repliesByStep[n] ?? 0;
    return {
      label: n === 0 ? "Invite" : `Step ${n}`, channel: ch,
      replies: repliesN,
      replyRate: sentN > 0 ? Math.min(100, Math.round((repliesN / sentN) * 100)) : 0,
      sent: at.filter(m => m.status === "sent").length,
      failed: at.filter(m => m.status === "failed").length,
      skipped: at.filter(m => m.status === "skipped").length,
      pending: at.filter(m => isPending(m.status)).length,
      leads: {
        // Per-lead detail so the seller can see EXACTLY who got each step,
        // who failed and the literal reason, who was skipped and why.
        sent: at.filter(m => m.status === "sent").map(m => nameOfEarly(m.lead_id)),
        failed: at.filter(m => m.status === "failed").map(m => withDetail(m.lead_id, (m.error_details ?? failCategory(m.error_details)).slice(0, 140))),
        skipped: at.filter(m => m.status === "skipped").map(m => withDetail(m.lead_id, String((m.metadata as any)?.skipped_reason ?? "skipped"))),
        pending: at.filter(m => isPending(m.status)).map(m => withDetail(m.lead_id, m.status)),
      },
    };
  });

  const liDmsSent = sent.filter(m => m.channel === "linkedin" && m.step_number > 0).length;
  const liReplies = repliesByChannel["linkedin"]?.size ?? 0;
  const liPositive = positiveByChannel["linkedin"]?.size ?? 0;
  const linkedin = channelsUsed.includes("linkedin") ? {
    invitesSent: requestsSent, accepted, acceptRate: requestsSent ? Math.round((accepted / requestsSent) * 100) : 0,
    pendingAccept: pendingAcceptSet.size,
    dmsSent: liDmsSent,
    replies: liReplies,
    positive: liPositive,
    replyRate: pctOf(liReplies, liDmsSent),
    positiveReplyRate: pctOf(liPositive, liReplies),
    failed: msgs.filter(m => m.channel === "linkedin" && m.status === "failed").length,
  } : null;
  const emailSent = sent.filter(m => m.channel === "email").length;
  const emReplies = repliesByChannel["email"]?.size ?? 0;
  const emPositive = positiveByChannel["email"]?.size ?? 0;
  const email = channelsUsed.includes("email") ? {
    sent: emailSent, bounced: bouncedSet.size,
    bounceRate: (emailSent + bouncedSet.size) ? Math.round((bouncedSet.size / (emailSent + bouncedSet.size)) * 100) : 0,
    replies: emReplies,
    positive: emPositive,
    replyRate: pctOf(emReplies, emailSent),
    positiveReplyRate: pctOf(emPositive, emReplies),
  } : null;
  const call = channelsUsed.includes("call") ? { dialed: sent.filter(m => m.channel === "call").length } : null;

  // ── Velocity (is it moving?) + cooldown (why isn't it?) ──
  const now = Date.now();
  const dayKey = (iso: string) => { try { return new Date(iso).toISOString().slice(0, 10); } catch { return ""; } };
  const todayKey = new Date(now).toISOString().slice(0, 10);
  const sentToday = sent.filter(m => m.sent_at && dayKey(m.sent_at) === todayKey).length;
  const lastActivityAt = sent.map(m => m.sent_at).filter(Boolean).sort().slice(-1)[0] ?? null;
  const byDay: { date: string; sent: number; replies: number }[] = [];
  for (let d = 13; d >= 0; d--) {
    const key = new Date(now - d * 86400000).toISOString().slice(0, 10);
    byDay.push({
      date: key,
      sent: sent.filter(m => m.sent_at && dayKey(m.sent_at) === key).length,
      replies: replyDates.filter(r => dayKey(r) === key).length,
    });
  }
  const firstSentByLead = new Map<string, string>();
  sent.forEach(m => { if (m.sent_at) { const p = firstSentByLead.get(m.lead_id); if (!p || m.sent_at < p) firstSentByLead.set(m.lead_id, m.sent_at); } });
  const replyGaps: number[] = [];
  firstReplyAt.forEach((rAt, lid) => { const fs = firstSentByLead.get(lid); if (fs) { const g = (new Date(rAt).getTime() - new Date(fs).getTime()) / 86400000; if (g >= 0) replyGaps.push(g); } });
  const avgDaysToReply = replyGaps.length ? Math.round((replyGaps.reduce((a, b) => a + b, 0) / replyGaps.length) * 10) / 10 : null;
  const velocity = { sentToday, dailyLimit: dailyLimit ?? null, lastActivityAt, byDay, avgDaysToReply };

  // Cooldown: newest rate-limit marker on a queued LinkedIn message, still inside
  // the 4h window the dispatcher honours. Surfaces WHY nothing is sending.
  let cooldown: { until: string; channel: string } | null = null;
  const rlTimes = msgs
    .filter(m => m.status === "queued" && m.channel === "linkedin" && (m.metadata as any)?.last_rate_limit_at)
    .map(m => new Date((m.metadata as any).last_rate_limit_at).getTime())
    .filter(t => !isNaN(t));
  if (rlTimes.length) {
    const newest = Math.max(...rlTimes);
    if (now - newest < 4 * 3600 * 1000) cooldown = { until: new Date(newest + 4 * 3600 * 1000).toISOString(), channel: "linkedin" };
  }

  // ── Cold-calling — the REAL calls table (campaign_messages channel=call is
  // only the queued STEP marker). Central rules from flow-metrics-lib so
  // connect-rate / positive / unreachable are defined in ONE place (def #4). ──
  const callRows: CallRow[] = [];
  for (let i = 0; i < leadIds.length; i += 100) {
    const inClause = `(${leadIds.slice(i, i + 100).join(",")})`;
    const rows = await restGet(`calls?lead_id=in.${encodeURIComponent(inClause)}&select=lead_id,seller_id,status,duration,classification,aircall_call_id,started_at`);
    rows.forEach((r: any) => callRows.push(r as CallRow));
  }
  const realCalls = callRows.filter(isRealCall);
  const connectedCalls = realCalls.filter(isConnected);
  const callLeadSet = new Set(realCalls.map(c => c.lead_id));
  const callGroupCounts: Record<string, number> = { positive: 0, followup: 0, negative: 0, unreachable: 0, other: 0 };
  const callOutcomeCounts: Record<string, number> = {};
  realCalls.forEach(c => {
    callGroupCounts[callOutcomeGroup(c)]++;
    const raw = c.classification ?? "unclassified";
    callOutcomeCounts[raw] = (callOutcomeCounts[raw] ?? 0) + 1;
  });
  // Meetings = unique 'qualified' leads (single source, def #5). Step-3
  // conversion counts only meetings whose lead actually reached the call stage.
  const meetingsFromCalls = [...qualifiedSet].filter(id => callLeadSet.has(id)).length;
  const callStage = channelsUsed.includes("call") ? {
    made: realCalls.length,
    connected: connectedCalls.length,
    connectRate: pctOf(connectedCalls.length, realCalls.length),
    positiveOutcomes: realCalls.filter(isPositiveOutcome).length,
    meetings: meetingsFromCalls,
    meetingConversion: pctOf(meetingsFromCalls, connectedCalls.length),
    groups: callGroupCounts,
    outcomes: callOutcomeCounts,
  } : null;

  // ── Pipeline — where the leads are NOW. Buckets are mutually exclusive and
  // sum to the cohort (def #6). current_step is 0-indexed over `sequence`. ──
  const stageChannel = (step: number | null) =>
    sequence[Math.max(0, Math.min(step ?? 0, sequence.length - 1))]?.channel ?? "linkedin";
  const pipeline = { inLinkedin: 0, inEmail: 0, inCall: 0, repliedExited: 0, completedNoResponse: 0, removed: 0, other: 0 };
  const agingAcc: Record<string, { active: number; stuck: number; sumDays: number; withTs: number }> = {
    linkedin: { active: 0, stuck: 0, sumDays: 0, withTs: 0 },
    email: { active: 0, stuck: 0, sumDays: 0, withTs: 0 },
    call: { active: 0, stuck: 0, sumDays: 0, withTs: 0 },
  };
  const STUCK_DAYS = 3;
  for (const c of campRows) {
    const replied = repliedSet.has(c.lead_id);
    if (c.status === "active" || c.status === "paused") {
      const ch = stageChannel(c.current_step);
      if (ch === "linkedin") pipeline.inLinkedin++;
      else if (ch === "email") pipeline.inEmail++;
      else if (ch === "call") pipeline.inCall++;
      else pipeline.other++;
      const ag = agingAcc[ch] ?? (agingAcc[ch] = { active: 0, stuck: 0, sumDays: 0, withTs: 0 });
      ag.active++;
      if (c.last_step_at) {
        const days = (now - new Date(c.last_step_at).getTime()) / 86400000;
        if (days >= 0) { ag.withTs++; ag.sumDays += days; if (days > STUCK_DAYS) ag.stuck++; }
      }
    } else if (c.status === "completed") {
      if (replied) pipeline.repliedExited++; else pipeline.completedNoResponse++;
    } else if (c.status === "closed_lost") {
      pipeline.repliedExited++;
    } else if (c.status === "cancelled") {
      pipeline.removed++;
    } else {
      pipeline.other++;
    }
  }
  const stageAging = Object.fromEntries(Object.entries(agingAcc).map(([ch, a]) => [ch, {
    active: a.active, stuckOver3d: a.stuck, avgDays: a.withTs ? Math.round((a.sumDays / a.withTs) * 10) / 10 : null, tracked: a.withTs,
  }])) as Record<string, { active: number; stuckOver3d: number; avgDays: number | null; tracked: number }>;

  // ── Seller performance — activity → engagement → outcomes → meetings, with
  // normalized rates so different-volume sellers are comparable (def #5). ──
  const sellerIds = [...new Set(campRows.map(c => c.seller_id).filter(Boolean) as string[])];
  const sellers = sellerIds.map(sid => {
    const leadSet = new Set(campRows.filter(c => c.seller_id === sid).map(c => c.lead_id));
    const inSet = (id: string) => leadSet.has(id);
    const sCalls = realCalls.filter(c => inSet(c.lead_id));
    const contactedN = [...contactedSet].filter(inSet).length;
    const repliesN = [...repliedSet].filter(inSet).length;
    const positiveN = [...positiveSet].filter(inSet).length;
    const meetingsN = [...qualifiedSet].filter(inSet).length;
    return {
      sellerId: sid, name: sellerMap.get(sid) ?? "—",
      leads: leadSet.size, contacted: contactedN,
      linkedinSent: sent.filter(m => m.channel === "linkedin" && inSet(m.lead_id)).length,
      emailsSent: sent.filter(m => m.channel === "email" && inSet(m.lead_id)).length,
      callsMade: sCalls.length, callsConnected: sCalls.filter(isConnected).length,
      replies: repliesN, positiveReplies: positiveN,
      positiveOutcomes: sCalls.filter(isPositiveOutcome).length, meetings: meetingsN,
      connectRate: pctOf(sCalls.filter(isConnected).length, sCalls.length),
      positiveReplyRate: pctOf(positiveN, repliesN),
      meetingsPer100: contactedN > 0 ? Math.round((meetingsN / contactedN) * 1000) / 10 : 0,
      positivePer100: contactedN > 0 ? Math.round((positiveN / contactedN) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.meetings - a.meetings || b.positiveReplies - a.positiveReplies);

  const failedMsgs = msgs.filter(m => m.status === "failed");
  const failCounts: Record<string, number> = {};
  failedMsgs.forEach(m => { const c = failCategory(m.error_details); failCounts[c] = (failCounts[c] ?? 0) + 1; });
  const failureReasons = Object.entries(failCounts).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

  const statusDist = { active: 0, paused: 0, completed: 0, cancelled: 0 };
  campRows.forEach(c => { if (c.status in statusDist) (statusDist as any)[c.status]++; });

  const nameOf = (id: string): DrillLead => ({ id, name: leadInfo.get(id)?.name ?? "Unknown", company: leadInfo.get(id)?.company ?? null });

  // Per-lead activity table — one row per lead, sorted by most-recent activity.
  const byLead: Record<string, Msg[]> = {};
  msgs.forEach(m => { (byLead[m.lead_id] ||= []).push(m); });
  const campMeta = new Map(campRows.map(c => [c.lead_id, c]));
  const leadsActivity = leadIds.map(id => {
    const lm = byLead[id] ?? [];
    const sentMsgs = lm.filter(x => x.status === "sent");
    const lastActivity = sentMsgs.map(x => x.sent_at).filter(Boolean).sort().slice(-1)[0] ?? null;
    const meta = campMeta.get(id);
    return {
      id, name: leadInfo.get(id)?.name ?? "Unknown", company: leadInfo.get(id)?.company ?? null,
      channels: [...new Set(lm.map(x => x.channel))],
      inviteSent: sentMsgs.some(x => x.step_number === 0 && x.channel === "linkedin"),
      accepted: connected.has(id),
      messaged: sentMsgs.filter(x => x.step_number > 0).length,
      replied: replyClass.get(id) ?? null,
      replyText: replyText.get(id)?.text ?? null,
      bounced: bouncedSet.has(id),
      status: meta?.status ?? "—",
      currentStep: meta?.current_step ?? null,
      daysInFlow: meta?.started_at ? Math.max(0, Math.round((now - new Date(meta.started_at).getTime()) / 86400000)) : null,
      lastActivity,
    };
  }).sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));

  // Clamp every rate to 100% — a denominator/numerator mismatch (stale data,
  // dedup edge) must never render a >100% funnel ("800% of accepted").
  const pct = (num: number, den: number) => den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0;
  return {
    leadsActivity, velocity, cooldown,
    totalLeads, invitesSent: requestsSent, accepted, messaged: messagedSet.size, replied: repliedSet.size, positive: positiveSet.size,
    // Channel-agnostic funnel: Leads → Contacted → Replied → Positive.
    contacted: contactedSet.size,
    contactedRate: pct(contactedSet.size, totalLeads),
    contactedReplyRate: pct(repliedSet.size, contactedSet.size),
    acceptRate: pct(accepted, requestsSent),
    messagedRate: pct(messagedSet.size, accepted),
    replyRate: pct(repliedSet.size, messagedSet.size),
    positiveRate: pct(positiveSet.size, repliedSet.size),
    progressPct, pendingAccept: pendingAcceptSet.size, lost: lostSet.size,
    // ── Flow Metrics redesign (2026-08-27) — unique-lead outcome metrics,
    // call stage from the real calls table, pipeline distribution, sellers. ──
    meetings: qualifiedSet.size,
    meetingRate: pct(qualifiedSet.size, totalLeads),
    positiveLeadRate: pct(positiveSet.size, totalLeads),
    callStage, pipeline, stageAging, sellers,
    positivesByChannel: { linkedin: liPositive, email: emPositive },
    health: {
      bounceRate: healthOf("bounceRate", email?.bounceRate ?? 0),
      connectRate: callStage ? healthOf("connectRate", callStage.connectRate) : "healthy",
      meetingConversion: callStage ? healthOf("meetingConversion", callStage.meetingConversion) : "healthy",
      positiveReplyRate: healthOf("positiveReplyRate", pct(positiveSet.size, repliedSet.size)),
    },
    statusDist, steps, linkedin, email, call, failureReasons,
    replyBreakdown: {
      positive: [...replyClass.values()].filter(b => b === "positive").length,
      negative: [...replyClass.values()].filter(b => b === "negative").length,
      question: [...replyClass.values()].filter(b => b === "question").length,
      followup: [...replyClass.values()].filter(b => b === "followup" || b === "not_now").length,
      other: [...replyClass.values()].filter(b => b === "other" || b === "voicemail").length,
    },
    drill: {
      contacted: [...contactedSet].map(nameOf),
      accepted: [...connected].map(nameOf),
      messaged: [...messagedSet].map(nameOf),
      pendingAccept: [...pendingAcceptSet].map(nameOf),
      replied: [...replyClass].map(([id, b]) => ({ ...nameOf(id), detail: b })),
      positive: [...positiveSet].map(nameOf),
      bounced: [...bouncedSet].map(id => ({ ...nameOf(id), detail: "bounced" })),
      failed: failedMsgs.map(m => ({ ...nameOf(m.lead_id), detail: `${m.step_number === 0 ? "invite" : "step " + m.step_number} · ${failCategory(m.error_details)}` })),
    },
  };
}

export default async function CampaignDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const spStr = (k: string): string | null => { const v = sp[k]; return typeof v === "string" && v ? v : null; };
  const supabase = await getSupabaseServer();
  const { id } = await params;
  const [campaign, t] = await Promise.all([getCampaign(id), getT()]);
  if (!campaign) notFound();

  // Tenant scope for the "Add Leads" tab.
  // Use the lead's company_bio_id as the primary source — it's always correct.
  // The seller's company_bio_id is a fallback only: it can point to the wrong
  // tenant when the seller record was created under SWL by the hosted-link bug.
  const tenantBioId =
    (campaign.leads?.company_bio_id as string | null | undefined) ??
    (campaign.sellers?.company_bio_id as string | null | undefined) ??
    (campaign.company_bio_id as string | null | undefined) ??
    null;

  const [messages, siblings, unlinkedLeads, campRequest] = await Promise.all([
    getMessages(id),
    getSiblingCampaigns(campaign.name, id),
    getUnlinkedLeadsByProfile(tenantBioId),
    // Always pull the most recent APPROVED request — when a request is edited
    // the rejected version is kept in the table, so filtering by name alone
    // can return the rejected (and now-stale) message_prompts.
    supabase
      .from("campaign_requests")
      .select("message_prompts")
      .eq("name", campaign.name)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const autoReplies = campRequest?.data?.message_prompts?.channelMessages?.autoReplies ?? {};
  const connectionNote = campRequest?.data?.message_prompts?.channelMessages?.connectionRequest ?? "";
  const rawMessageTemplates: { channel: string; body: string; subject?: string }[] =
    campRequest?.data?.message_prompts?.channelMessages?.steps ?? [];

  const sequence: { channel: string; daysAfter: number }[] = campaign.sequence_steps ?? [];
  // The wizard's channelMessages.steps[] reserves index 0 for the day-0
  // Connection Request slot, but campaign.sequence_steps has that slot stripped
  // (only numbered followups). Align the templates to the followup steps by
  // dropping the leading CR slot(s), so per-step subject/body fallbacks land on
  // the right step instead of being off-by-one (which surfaced the email's
  // subject on the LinkedIn step — Fran 2026-07-07).
  const messageTemplates = rawMessageTemplates.length > sequence.length
    ? rawMessageTemplates.slice(rawMessageTemplates.length - sequence.length)
    : rawMessageTemplates;
  const channels = [...new Set(sequence.map((s: any) => s.channel))];
  // Call-advance mode (only meaningful when the flow has a call step). 'manual'
  // = the sequence WAITS at the call step for the seller to dial (so a lead
  // parked there isn't "stuck", it's by design). 'auto' = the cron skips the
  // call and advances after ~3 days. Surfacing this so a paused-looking flow
  // reads correctly. (Fran 2026-06-16)
  const hasCallStep = sequence.some((s: any) => s.channel === "call");
  const advanceMode: "auto" | "manual" = (campaign.call_advance_mode ?? "auto") === "manual" ? "manual" : "auto";
  const totalSteps = sequence.length;
  const pct = totalSteps > 0 ? Math.round((campaign.current_step / totalSteps) * 100) : 0;
  const st = statusMeta[campaign.status] ?? statusMeta.active;
  const StIcon = st.icon;
  const leadName = `${campaign.leads?.primary_first_name ?? ""} ${campaign.leads?.primary_last_name ?? ""}`.trim() || campaign.leads?.company_name || "Unknown";

  // All leads in this campaign group (current + siblings)
  const allGroupCampaigns = [
    { ...campaign, _isCurrent: true },
    ...siblings.map((s: any) => ({ ...s, _isCurrent: false })),
  ];

  // Per-campaign step-0 LinkedIn message status (for the kanban badge that
  // distinguishes "request sent — waiting accept" from "queued / cooldown /
  // failed"). Uses direct REST with service key like getMessages above —
  // the cookie-based supabase client returned empty in some cases (likely
  // RLS on campaign_messages), and we need authoritative data for the badge.
  const allCampaignIds = allGroupCampaigns.map(c => c.id);
  const step0Map: Record<string, { status: string; lastRateLimitAt: string | null; errorDetails: string | null; skippedReason: string | null } | undefined> = {};
  if (allCampaignIds.length > 0) {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const sbKey = process.env.SUPABASE_SERVICE_KEY!;
    const inClause = `(${allCampaignIds.join(",")})`;
    const url = `${sbUrl}/rest/v1/campaign_messages?campaign_id=in.${encodeURIComponent(inClause)}&step_number=eq.0&channel=eq.linkedin&select=campaign_id,status,metadata,error_details`;
    try {
      const res = await fetch(url, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
        cache: "no-store",
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<{
          campaign_id: string;
          status: string;
          metadata: Record<string, unknown> | null;
          error_details: string | null;
        }>;
        for (const row of rows) {
          step0Map[row.campaign_id] = {
            status: row.status,
            lastRateLimitAt: (row.metadata?.last_rate_limit_at as string | null) ?? null,
            errorDetails: row.error_details,
            // Surface the dispatcher's skip reason so CampaignKanban can pick
            // the right badge (ALREADY CONNECTED / INVITE PENDING / …)
            // instead of mass-labeling everything "LOCKED PROFILE".
            skippedReason: (row.metadata?.skipped_reason as string | null) ?? null,
          };
        }
      }
    } catch { /* fail open — kanban shows no badges */ }
  }
  for (const c of allGroupCampaigns) (c as any).step_0 = step0Map[c.id] ?? null;

  // Fetch the first pending/failed message (step > 0) per campaign for the
  // kanban badge. Leads beyond the connection phase (current_step > 0) need
  // their current active step surfaced, not just the connection invite.
  const currentMsgMap: Record<string, { stepNumber: number; channel: string; status: string; lastRateLimitAt: string | null; errorDetails: string | null } | undefined> = {};
  if (allCampaignIds.length > 0) {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const sbKey = process.env.SUPABASE_SERVICE_KEY!;
    const inClause = `(${allCampaignIds.join(",")})`;
    // Include `draft` so the kanban can surface "EMAIL DRAFT" / "CALL DRAFT"
    // on cards that already have an upcoming follow-up authored but not yet
    // queued by the dispatcher. Otherwise step-0 cards looked like they
    // only had a CR pending, hiding the email/call sitting one step ahead.
    const url = `${sbUrl}/rest/v1/campaign_messages?campaign_id=in.${encodeURIComponent(inClause)}&step_number=gt.0&status=in.(queued,draft,failed,dispatching)&select=campaign_id,step_number,channel,status,metadata,error_details&order=step_number.asc`;
    try {
      const res = await fetch(url, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
        cache: "no-store",
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<{
          campaign_id: string;
          step_number: number;
          channel: string;
          status: string;
          metadata: Record<string, unknown> | null;
          error_details: string | null;
        }>;
        for (const row of rows) {
          if (!currentMsgMap[row.campaign_id]) {
            currentMsgMap[row.campaign_id] = {
              stepNumber: row.step_number,
              channel: row.channel,
              status: row.status,
              lastRateLimitAt: (row.metadata?.last_rate_limit_at as string | null) ?? null,
              errorDetails: row.error_details,
            };
          }
        }
      }
    } catch { /* fail open */ }
  }
  for (const c of allGroupCampaigns) (c as any).current_msg = currentMsgMap[c.id] ?? null;

  let cumDays = 0;
  const dayPerStep = sequence.map((s: any, i: number) => {
    cumDays += i === 0 ? 0 : s.daysAfter;
    return cumDays;
  });

  // Stats
  const totalLeadsInGroup = allGroupCampaigns.length;
  const activeInGroup = allGroupCampaigns.filter(c => c.status === "active").length;
  const pausedInGroup = allGroupCampaigns.filter(c => c.status === "paused").length;
  const completedInGroup = allGroupCampaigns.filter(c => c.status === "completed").length;
  // "In flow" mirrors the Leads/Pipeline tab's `visibleCampaigns` predicate
  // (everything not completed/failed) so the header count matches what the
  // Leads tab actually lists — fixes the "header 50 vs funnel 24" mismatch.
  const inFlowInGroup = allGroupCampaigns.filter(c => c.status !== "completed" && c.status !== "failed").length;
  // Header KPIs the user actually cares about (boss 2026-06-12: "info que
  // realmente importe"): how far the flow has run + who's running it, instead
  // of paused/completed counts.
  const totalStepsInFlow = sequence.length;
  const avgFlowPct = totalStepsInFlow > 0 && totalLeadsInGroup > 0
    ? Math.round((allGroupCampaigns.reduce((s, c) => s + Math.min(1, (c.current_step ?? 0) / totalStepsInFlow), 0) / totalLeadsInGroup) * 100)
    : 0;
  const flowSellers = Array.from(new Set(
    allGroupCampaigns.map(c => (c as any).sellers?.name).filter(Boolean) as string[],
  ));

  // Channel breakdown of where active+paused leads currently sit. Reading
  // sequence_steps[current_step] tells us what channel each lead is waiting
  // on right now. Boss preference: this is more useful at a glance than
  // "Duration · 3 steps · 6d" which never changes after launch.
  const channelOfActive: Record<string, number> = {};
  for (const c of allGroupCampaigns) {
    if (c.status !== "active" && c.status !== "paused") continue;
    const steps: Array<{ channel?: string }> = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    const idx = Math.max(0, Math.min(c.current_step ?? 0, steps.length - 1));
    const ch = steps[idx]?.channel ?? "unknown";
    channelOfActive[ch] = (channelOfActive[ch] ?? 0) + 1;
  }
  const channelOrder = ["linkedin", "email", "call", "whatsapp"];
  const activeChannelEntries = Object.entries(channelOfActive)
    .sort(([a], [b]) => {
      const ai = channelOrder.indexOf(a); const bi = channelOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  // Effective currentStep for the funnel = most-advanced active lead.
  // current_step is 0-indexed over sequence_steps (0 = nothing sent, 1 = 1st DM, etc.)
  const activeLeadSteps = allGroupCampaigns
    .filter(c => c.status === "active" || c.status === "paused")
    .map(c => Math.max(0, Math.min(c.current_step ?? 0, sequence.length)));
  const effectiveCurrentStep = activeLeadSteps.length > 0
    ? Math.max(...activeLeadSteps)
    : Math.min(campaign.current_step ?? 0, sequence.length);

  // Flow-wide outreach metrics for the panel under the hero.
  const leadInfo = new Map<string, { name: string; company: string | null }>();
  for (const c of allGroupCampaigns) {
    const l = (c as any).leads;
    if (l?.id) leadInfo.set(l.id, { name: `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || l.company_name || "Unknown", company: l.company_name ?? null });
  }
  // Use the nested leads.id, NOT a top-level c.lead_id: getSiblingCampaigns
  // doesn't select the lead_id column, so c.lead_id is undefined for every
  // sibling — only the representative row (select *) had it. That collapsed
  // flowLeadIds to 1, so the whole funnel (accepted/replied/positive/bounced)
  // + the Leads activity table computed over a SINGLE lead. leads.id is present
  // on rep + siblings → fixes the counts to the full cohort.
  const flowLeadIds = [...new Set(allGroupCampaigns.map(c => ((c as any).leads?.id as string | undefined)).filter(Boolean) as string[])];
  const sellerMap = new Map<string, string>();
  for (const c of allGroupCampaigns) {
    const sid = (c as any).seller_id as string | null | undefined;
    const nm = (c as any).sellers?.name as string | null | undefined;
    if (sid && nm && !sellerMap.has(sid)) sellerMap.set(sid, nm);
  }
  const campRows = allGroupCampaigns
    .map(c => ({ lead_id: (c as any).leads?.id as string | undefined, status: c.status as string, current_step: (c.current_step ?? null) as number | null, started_at: ((c as any).started_at ?? null) as string | null, seller_id: ((c as any).seller_id ?? null) as string | null, last_step_at: ((c as any).last_step_at ?? null) as string | null }))
    .filter((r): r is { lead_id: string; status: string; current_step: number | null; started_at: string | null; seller_id: string | null; last_step_at: string | null } => !!r.lead_id);
  const sellerDailyLimit = (campaign.sellers?.linkedin_daily_limit as number | null | undefined) ?? null;

  // ── Filters + temporal cohort (2026-08-28) ──
  // POLICY: the date range picks the ENROLLMENT cohort — leads whose flow start
  // (campaigns.started_at) falls in the window. ONE cohort → every section
  // counts the same leads (totals close, zero double-counting). The Seller
  // filter subsets that cohort (in this data model a LinkedIn profile == one
  // seller / unipile account). Default `all` = the whole flow (no behavior
  // change). Pipeline is current-state → seller-filtered, not date-windowed.
  const sellerFilter = spStr("seller");
  const range = spStr("range") ?? "all";
  const nowMs = Date.now();
  const rangeDays = range === "7d" ? 7 : range === "4w" ? 28 : range === "90d" ? 90 : null;
  let winFrom: number | null = null; let winTo: number = nowMs;
  if (rangeDays) winFrom = nowMs - rangeDays * 86400000;
  else if (range === "custom") { const f = spStr("from"); const tt = spStr("to"); if (f) { winFrom = new Date(f).getTime(); winTo = tt ? new Date(tt).getTime() : nowMs; } }
  const startedMs = (r: { started_at: string | null }) => (r.started_at ? new Date(r.started_at).getTime() : null);
  const inWindow = (r: { started_at: string | null }, from: number | null, to: number) => {
    if (from == null) return true; const t = startedMs(r); return t != null && t >= from && t <= to;
  };
  const cohortRows = campRows.filter(r => (!sellerFilter || r.seller_id === sellerFilter) && inWindow(r, winFrom, winTo));
  const flowMetrics = await getFlowMetrics(allCampaignIds, cohortRows.map(r => r.lead_id), sequence, leadInfo, channels, pct, cohortRows, sellerDailyLimit, sellerMap);

  // Period-over-period vs the equal window immediately before (same seller).
  if (flowMetrics && winFrom != null) {
    const len = winTo - winFrom;
    const prevRows = campRows.filter(r => (!sellerFilter || r.seller_id === sellerFilter) && inWindow(r, winFrom - len, winFrom));
    const prev = prevRows.length
      ? await getFlowMetrics(allCampaignIds, prevRows.map(r => r.lead_id), sequence, leadInfo, channels, pct, prevRows, sellerDailyLimit, sellerMap)
      : null;
    const ppp = (a: number, b: number) => Math.round((a - b) * 10) / 10;
    const grow = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    flowMetrics.deltas = prev ? {
      meetings: { curr: flowMetrics.meetings, prev: prev.meetings, pct: grow(flowMetrics.meetings, prev.meetings) },
      positive: { curr: flowMetrics.positive, prev: prev.positive, pct: grow(flowMetrics.positive, prev.positive) },
      positiveReplyRate: { curr: flowMetrics.positiveRate, prev: prev.positiveRate, pp: ppp(flowMetrics.positiveRate, prev.positiveRate) },
      connectRate: { curr: flowMetrics.callStage?.connectRate ?? 0, prev: prev.callStage?.connectRate ?? 0, pp: ppp(flowMetrics.callStage?.connectRate ?? 0, prev.callStage?.connectRate ?? 0) },
      replyRate: { curr: flowMetrics.contactedReplyRate, prev: prev.contactedReplyRate, pp: ppp(flowMetrics.contactedReplyRate, prev.contactedReplyRate) },
    } : null;
  }
  const sellerList = [...sellerMap].map(([sid, name]) => ({ id: sid, name }));
  const activeFilters = { seller: sellerFilter, range, from: spStr("from"), to: spStr("to") };

  // Attach each lead's reply bucket to the kanban campaigns so the board can
  // badge POSITIVE / NEGATIVE / REPLIED instead of stale dispatch plumbing.
  // Source = flowMetrics.drill.replied (per-lead positive/question/negative/
  // other), which is in scope here. 2026-06-03 (re-added in-scope after the
  // earlier out-of-scope crash).
  const replyClassByLead = new Map(
    (flowMetrics?.drill?.replied ?? []).map((r: { id: string; detail?: string | null }) => [r.id, r.detail ?? null]),
  );
  for (const c of allGroupCampaigns) {
    const lid = (c as { leads?: { id?: string } }).leads?.id;
    (c as { reply_class?: string | null }).reply_class = lid ? (replyClassByLead.get(lid) ?? null) : null;
  }

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        <Link href="/campaigns" className="hover:underline flex items-center gap-1"><ArrowLeft size={12} /> Campaigns</Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{campaign.name}</span>
      </div>

      {/* ═══ CAMPAIGN HEADER — themed light card + gold accent ═══
          Redesign 2026-08 (boss): dropped the forced-dark #0F0F14 slab (read
          as a heavy navy hero even in light mode). Now a normal themed card —
          light in light mode, navy in dark mode, like every other surface —
          with a gold stripe + eyebrow as the single brand accent, consolidated
          actions, and channel chips tinted by the gold ramp (--fg*) so the
          page reads as one gold spectrum instead of a rainbow. */}
      <div
        className="rounded-2xl border overflow-hidden mb-6 relative"
        style={{ backgroundColor: C.card, borderColor: C.border2, boxShadow: C.shadowMd }}
      >
        {/* Gold ramp stripe at the very top — the brand thread. */}
        <div className="absolute inset-x-0 top-0 h-[3px] pointer-events-none"
          style={{ background: "linear-gradient(90deg, var(--fg1), var(--fg3) 45%, var(--fg4) 80%, transparent)" }} />

        <div className="p-6 pt-7 flex items-start justify-between gap-4 relative">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="h-[2px] w-4 rounded" style={{ backgroundColor: gold }} />
              <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: "var(--fg1)", letterSpacing: "0.22em" }}>{t("campaignDetail.preTitle")}</p>
            </div>
            <h1
              className="text-[25px] font-bold mb-3.5 leading-tight"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}
            >
              {campaign.name}
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <div
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1"
                style={{
                  backgroundColor: `color-mix(in srgb, ${st.color} 11%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${st.color} 34%, transparent)`,
                }}
              >
                {campaign.status === "active" && (
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: st.color }} />
                )}
                <StIcon size={11} style={{ color: st.color }} />
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: st.color, letterSpacing: "0.06em" }}>{st.label}</span>
              </div>
              {channels.map(ch => {
                const meta = channelMeta[ch];
                if (!meta) return null;
                const Icon = meta.icon;
                // Channel identity comes from the LOGO + a gold-ramp tint,
                // not a per-channel rainbow hue (boss 2026-08).
                const ramp = ch === "linkedin" ? "var(--fg1)" : ch === "email" ? "var(--fg3)" : ch === "whatsapp" ? "var(--fg2)" : "var(--fg4)";
                return (
                  <span
                    key={ch}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${ramp} 12%, transparent)`,
                      color: C.textBody,
                      border: `1px solid color-mix(in srgb, ${ramp} 30%, transparent)`,
                    }}
                  >
                    <Icon size={11} style={{ color: ramp }} /> {meta.label}
                  </span>
                );
              })}
              {hasCallStep && (() => {
                const m = advanceMode === "manual"
                  ? { color: C.yellow, Icon: Phone, label: "Manual calls", hint: "waits for the seller to dial" }
                  : { color: C.blue,   Icon: Zap,   label: "Auto-advance", hint: "skips the call after 3 days" };
                return (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    title={`Call step is ${advanceMode === "manual" ? "MANUAL — the sequence pauses here until a seller calls the lead." : "AUTO — if no one calls within 3 days the call step is skipped and the flow continues."}`}
                    style={{ backgroundColor: `color-mix(in srgb, ${m.color} 11%, transparent)`, color: m.color, border: `1px solid color-mix(in srgb, ${m.color} 30%, transparent)` }}>
                    <m.Icon size={11} /> {m.label}
                    <span style={{ opacity: 0.7, fontWeight: 500 }}>· {m.hint}</span>
                  </span>
                );
              })()}
              {campaign.started_at && (
                <span className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                  style={{ color: C.textMuted, border: `1px solid ${C.border}`, backgroundColor: C.surface }}>
                  <Clock size={11} />
                  {t("campaignDetail.started").replace("{date}", new Date(campaign.started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }))}
                </span>
              )}
            </div>
          </div>
          {/* Actions — Edit (secondary) + Add leads (primary gold). Pause/Resume
              + Save-as-template stay in their tab toolbars (client actions). */}
          <div className="shrink-0 flex items-center gap-2">
            <Link href={`/campaigns/${id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-[background-color,transform,box-shadow,border-color] hover:-translate-y-0.5"
              style={{ color: C.textBody, backgroundColor: C.surface, border: `1px solid ${C.border2}` }}>
              <Settings size={12} /> {t("campaignDetail.editFlow")}
            </Link>
            <Link href={`/campaigns/${id}?tab=add-leads`}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-[transform,box-shadow] hover:-translate-y-0.5"
              style={{
                color: "#241B04",
                background: "linear-gradient(180deg, color-mix(in srgb, var(--fg4) 85%, white), var(--fg4))",
                border: `1px solid var(--fg2)`,
                boxShadow: `0 2px 9px color-mix(in srgb, ${gold} 34%, transparent)`,
              }}>
              <UserPlus size={12} /> Add leads
            </Link>
          </div>
        </div>

        <div className="border-t" style={{ borderColor: C.border }} />

        {/* Header KPIs — total leads · progress · active · seller. Linear cells
            split by hairlines (not floating boxes). Values in ink for contrast;
            the headline (total leads) carries the gold accent. */}
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {[
            { label: t("campaignDetail.metric.totalLeads"), value: totalLeadsInGroup, gold: true,  small: false },
            { label: t("campaignDetail.metric.progress"),   value: `${avgFlowPct}%`,  gold: false, small: false },
            { label: t("campaignDetail.metric.active"),     value: inFlowInGroup,     gold: false, small: false },
            { label: flowSellers.length === 1 ? t("campaignDetail.metric.seller") : t("campaignDetail.metric.sellers"), value: flowSellers.length === 0 ? "—" : flowSellers.length <= 2 ? flowSellers.join(" · ") : `${flowSellers.length}`, gold: false, small: flowSellers.length >= 1 && flowSellers.length <= 2 },
          ].map((s, i) => (
            <div
              key={s.label}
              className="px-5 py-4"
              style={{ borderLeft: i % 4 === 0 ? "none" : `1px solid ${C.border}` }}
            >
              <p
                className={`${s.small ? "text-sm leading-tight truncate" : "text-[22px] leading-none tabular-nums"} font-bold`}
                title={s.small ? String(s.value) : undefined}
                style={{ color: s.gold ? "var(--fg1)" : C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}
              >
                {s.value}
              </p>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] mt-2" style={{ color: C.textMuted, letterSpacing: "0.12em" }}>
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ TABBED CONTENT (Client Component) — Metrics tab is first ═══ */}
      <CampaignDetailClient
        flowMetrics={flowMetrics}
        metricsSellers={sellerList}
        metricsFilters={activeFilters}
        campaignId={id}
        campaignName={campaign.name}
        campaignStatus={campaign.status}
        campaignIcpId={campaign.leads?.icp_profile_id ?? null}
        sellerName={campaign.sellers?.name ?? "Unassigned"}
        sequence={sequence}
        messages={messages}
        dayPerStep={dayPerStep}
        currentStep={effectiveCurrentStep}
        allCampaigns={JSON.parse(JSON.stringify(allGroupCampaigns))}
        leadGroups={JSON.parse(JSON.stringify(unlinkedLeads))}
        channels={channels}
        autoReplies={autoReplies}
        connectionNote={connectionNote}
        messageTemplates={messageTemplates}
      />
    </div>
  );
}
