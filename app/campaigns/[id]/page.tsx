import { getSupabaseServer } from "@/lib/supabase-server";
import { C } from "@/lib/design";
import { getT } from "@/lib/i18n-server";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, PlayCircle, PauseCircle, CheckCircle, XCircle,
  Users, Clock, Settings,
} from "lucide-react";
import CampaignDetailClient from "./CampaignDetailClient";
import { type FlowMetrics, type DrillLead } from "@/components/FlowMetricsPanel";
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
  completed: { label: "Completed", color: C.textMuted, bg: C.surface,    icon: CheckCircle },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight,    icon: XCircle },
};

async function getCampaign(id: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("*, leads(id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, company_industry, icp_profile_id), sellers(name, company_bio_id)")
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
  const { data } = await supabase
    .from("campaigns")
    .select("id, status, current_step, sequence_steps, channel, last_step_at, seller_id, leads(id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, lead_score, is_priority, allow_linkedin, allow_email, allow_call), sellers(name)")
    .eq("name", campaignName)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    // Was 500: a flow with >501 enrolled leads silently truncated the Leads
    // tab and the "Total Leads" stat (De Vera read a fake 501 off a 536-row
    // flow). Pathway flows already exceed this. Raised so large flows count
    // and list in full.
    .limit(5000);
  const rows = data ?? [];
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
  const TERMINAL_LEAD_STATUSES = ["closed_lost", "closed_won", "won"];
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
  campRows: { lead_id: string; status: string }[],
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
  const connected = new Set<string>(); const bouncedSet = new Set<string>(); const lostSet = new Set<string>();
  for (let i = 0; i < leadIds.length; i += 100) {
    const inClause = `(${leadIds.slice(i, i + 100).join(",")})`;
    const rows = await restGet(`leads?id=in.${encodeURIComponent(inClause)}&select=id,linkedin_connected,primary_email_status,status`);
    rows.forEach((r: any) => {
      if (r.linkedin_connected) connected.add(r.id);
      if (r.primary_email_status === "bounced") bouncedSet.add(r.id);
      if (r.status === "closed_lost") lostSet.add(r.id);
    });
  }
  // Reply classification per lead (strongest: positive > question > negative > other)
  // + the latest reply text so the UI can show exactly what each lead said.
  const replyClass = new Map<string, string>();
  const replyText = new Map<string, { text: string; at: string; channel: string }>();
  const repliesByChannel: Record<string, Set<string>> = {};
  const rank: Record<string, number> = { positive: 4, question: 3, negative: 2, other: 1 };
  for (let i = 0; i < leadIds.length; i += 100) {
    const inClause = `(${leadIds.slice(i, i + 100).join(",")})`;
    const rows = await restGet(`lead_replies?lead_id=in.${encodeURIComponent(inClause)}&select=lead_id,classification,channel,reply_text,received_at`);
    rows.forEach((r: any) => {
      const c = (r.classification ?? "").toLowerCase();
      const bucket = c.includes("positive") ? "positive" : c.includes("question") ? "question" : c.includes("negative") ? "negative" : "other";
      const prev = replyClass.get(r.lead_id);
      if (!prev || rank[bucket] > rank[prev]) replyClass.set(r.lead_id, bucket);
      const at = r.received_at ?? "";
      const prevText = replyText.get(r.lead_id);
      if (r.reply_text && (!prevText || at > prevText.at)) replyText.set(r.lead_id, { text: r.reply_text, at, channel: r.channel ?? "other" });
      const ch = r.channel ?? "other"; (repliesByChannel[ch] ||= new Set()).add(r.lead_id);
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
  const pendingAcceptSet = new Set([...step0SentLeads].filter(id => !connected.has(id) && !lostSet.has(id)));

  // Per-step breakdown (CR = step 0, then sequence steps).
  const nameOfEarly = (id: string): DrillLead => ({ id, name: leadInfo.get(id)?.name ?? "Unknown", company: leadInfo.get(id)?.company ?? null });
  const withDetail = (id: string, detail: string): DrillLead => ({ ...nameOfEarly(id), detail });
  const isPending = (s: string) => s === "queued" || s === "draft" || s === "dispatching";
  const stepNums = [...(channelsUsed.includes("linkedin") ? [0] : []), ...Array.from({ length: sequence.length }, (_, i) => i + 1)];
  const steps = stepNums.map(n => {
    const at = msgs.filter(m => m.step_number === n);
    const ch = n === 0 ? "linkedin" : (sequence[n - 1]?.channel ?? "linkedin");
    return {
      label: n === 0 ? "Invite" : `Step ${n}`, channel: ch,
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

  const linkedin = channelsUsed.includes("linkedin") ? {
    invitesSent: requestsSent, accepted, acceptRate: requestsSent ? Math.round((accepted / requestsSent) * 100) : 0,
    pendingAccept: pendingAcceptSet.size,
    dmsSent: sent.filter(m => m.channel === "linkedin" && m.step_number > 0).length,
    replies: repliesByChannel["linkedin"]?.size ?? 0,
    failed: msgs.filter(m => m.channel === "linkedin" && m.status === "failed").length,
  } : null;
  const emailSent = sent.filter(m => m.channel === "email").length;
  const email = channelsUsed.includes("email") ? {
    sent: emailSent, bounced: bouncedSet.size,
    bounceRate: (emailSent + bouncedSet.size) ? Math.round((bouncedSet.size / (emailSent + bouncedSet.size)) * 100) : 0,
    replies: repliesByChannel["email"]?.size ?? 0,
  } : null;
  const call = channelsUsed.includes("call") ? { dialed: sent.filter(m => m.channel === "call").length } : null;

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
  const campStatusByLead = new Map(campRows.map(c => [c.lead_id, c.status]));
  const leadsActivity = leadIds.map(id => {
    const lm = byLead[id] ?? [];
    const sentMsgs = lm.filter(x => x.status === "sent");
    const lastActivity = sentMsgs.map(x => x.sent_at).filter(Boolean).sort().slice(-1)[0] ?? null;
    return {
      id, name: leadInfo.get(id)?.name ?? "Unknown", company: leadInfo.get(id)?.company ?? null,
      channels: [...new Set(lm.map(x => x.channel))],
      inviteSent: sentMsgs.some(x => x.step_number === 0 && x.channel === "linkedin"),
      accepted: connected.has(id),
      messaged: sentMsgs.filter(x => x.step_number > 0).length,
      replied: replyClass.get(id) ?? null,
      replyText: replyText.get(id)?.text ?? null,
      bounced: bouncedSet.has(id),
      status: campStatusByLead.get(id) ?? "—",
      lastActivity,
    };
  }).sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));

  return {
    leadsActivity,
    totalLeads, invitesSent: requestsSent, accepted, messaged: messagedSet.size, replied: repliedSet.size, positive: positiveSet.size,
    acceptRate: requestsSent ? Math.round((accepted / requestsSent) * 100) : 0,
    messagedRate: accepted ? Math.round((messagedSet.size / accepted) * 100) : 0,
    replyRate: messagedSet.size ? Math.round((repliedSet.size / messagedSet.size) * 100) : 0,
    positiveRate: repliedSet.size ? Math.round((positiveSet.size / repliedSet.size) * 100) : 0,
    progressPct, pendingAccept: pendingAcceptSet.size, lost: lostSet.size,
    statusDist, steps, linkedin, email, call, failureReasons,
    replyBreakdown: {
      positive: [...replyClass.values()].filter(b => b === "positive").length,
      negative: [...replyClass.values()].filter(b => b === "negative").length,
      question: [...replyClass.values()].filter(b => b === "question").length,
      other: [...replyClass.values()].filter(b => b === "other").length,
    },
    drill: {
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

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await getSupabaseServer();
  const { id } = await params;
  const [campaign, t] = await Promise.all([getCampaign(id), getT()]);
  if (!campaign) notFound();

  // Tenant scope for the "Add Leads" tab — campaign → seller → company_bio.
  // Falls back to campaign.company_bio_id (if column exists) or null (no leads shown).
  const tenantBioId =
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
  const messageTemplates: { channel: string; body: string; subject?: string }[] =
    campRequest?.data?.message_prompts?.channelMessages?.steps ?? [];

  const sequence: { channel: string; daysAfter: number }[] = campaign.sequence_steps ?? [];
  const channels = [...new Set(sequence.map((s: any) => s.channel))];
  const totalSteps = sequence.length;
  const pct = totalSteps > 0 ? Math.round((campaign.current_step / totalSteps) * 100) : 0;
  const st = statusMeta[campaign.status] ?? statusMeta.active;
  const StIcon = st.icon;
  const leadName = `${campaign.leads?.primary_first_name ?? ""} ${campaign.leads?.primary_last_name ?? ""}`.trim() || "Unknown";

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
    if (l?.id) leadInfo.set(l.id, { name: `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || "Unknown", company: l.company_name ?? null });
  }
  // Use the nested leads.id, NOT a top-level c.lead_id: getSiblingCampaigns
  // doesn't select the lead_id column, so c.lead_id is undefined for every
  // sibling — only the representative row (select *) had it. That collapsed
  // flowLeadIds to 1, so the whole funnel (accepted/replied/positive/bounced)
  // + the Leads activity table computed over a SINGLE lead. leads.id is present
  // on rep + siblings → fixes the counts to the full cohort.
  const flowLeadIds = [...new Set(allGroupCampaigns.map(c => ((c as any).leads?.id as string | undefined)).filter(Boolean) as string[])];
  const campRows = allGroupCampaigns
    .map(c => ({ lead_id: (c as any).leads?.id as string | undefined, status: c.status as string }))
    .filter((r): r is { lead_id: string; status: string } => !!r.lead_id);
  const flowMetrics = await getFlowMetrics(allCampaignIds, flowLeadIds, sequence, leadInfo, channels, pct, campRows);

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        <Link href="/campaigns" className="hover:underline flex items-center gap-1"><ArrowLeft size={12} /> Campaigns</Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{campaign.name}</span>
      </div>

      {/* ═══ CAMPAIGN HEADER — SWL dark + gold treatment ═══
          Premium hero band that mirrors the dossier surface used on
          /dashboard/seller/[id] and the now-deleted /overview header.
          Boss feedback 2026-05-28 r12: "asi blanco es horrible". */}
      <div
        className="rounded-2xl border overflow-hidden mb-6 relative"
        style={{
          backgroundColor: "#0F0F14",
          borderColor: "color-mix(in srgb, #c9a83a 18%, #1d1f29)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.22), 0 0 0 1px color-mix(in srgb, #c9a83a 14%, transparent)",
        }}
      >
        {/* Gold gradient stripe at the top + soft radial corner glows */}
        <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 50%, transparent 100%)`, opacity: 0.9 }} />
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 26%, transparent) 0%, transparent 65%)`, opacity: 0.55 }} />
        <div className="absolute -bottom-32 -left-20 w-80 h-80 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 14%, transparent) 0%, transparent 70%)`, opacity: 0.4 }} />

        <div className="p-6 flex items-start justify-between gap-4 relative">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-px w-6" style={{ backgroundColor: gold }} />
              <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: gold, letterSpacing: "0.18em" }}>{t("campaignDetail.preTitle")}</p>
            </div>
            <h1
              className="text-[28px] font-bold mb-4 leading-tight"
              style={{
                color: "#F5F2E8",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                letterSpacing: "-0.02em",
              }}
            >
              {campaign.name}
            </h1>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
                style={{
                  backgroundColor: `color-mix(in srgb, ${st.color} 18%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${st.color} 38%, transparent)`,
                  boxShadow: campaign.status === "active" ? `0 0 14px color-mix(in srgb, ${st.color} 30%, transparent)` : "none",
                }}
              >
                {campaign.status === "active" && (
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: st.color }} />
                )}
                <StIcon size={12} style={{ color: st.color }} />
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: st.color, letterSpacing: "0.08em" }}>{st.label}</span>
              </div>
              {channels.map(ch => {
                const meta = channelMeta[ch];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <span
                    key={ch}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${meta.color} 16%, rgba(255,255,255,0.02))`,
                      color: meta.color,
                      border: `1px solid color-mix(in srgb, ${meta.color} 32%, transparent)`,
                    }}
                  >
                    <Icon size={11} /> {meta.label}
                  </span>
                );
              })}
              {campaign.started_at && (
                <span className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                  style={{ color: "color-mix(in srgb, #F5F2E8 62%, transparent)", border: "1px solid color-mix(in srgb, #F5F2E8 10%, transparent)", backgroundColor: "rgba(255,255,255,0.02)" }}>
                  <Clock size={11} />
                  {t("campaignDetail.started").replace("{date}", new Date(campaign.started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }))}
                </span>
              )}
            </div>
          </div>
          {/* Edit Flow CTA — outlined gold pill on the dark hero. Earlier
              version used a gold→light-gold gradient that washed out into
              a muddy mustard against the ink background. The clean glass-
              outlined pill matches the in-hero channel chips and reads
              "primary action" without competing for attention. */}
          <Link href={`/campaigns/${id}/edit`}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-[background-color,transform,box-shadow] hover:-translate-y-0.5"
            style={{
              color: gold,
              backgroundColor: "color-mix(in srgb, white 6%, transparent)",
              border: `1px solid color-mix(in srgb, ${gold} 50%, transparent)`,
              boxShadow: `0 0 0 1px color-mix(in srgb, ${gold} 20%, transparent), 0 4px 14px color-mix(in srgb, ${gold} 12%, transparent)`,
            }}>
            <Settings size={12} /> {t("campaignDetail.editFlow")}
          </Link>
        </div>

        <div className="border-t" style={{ borderColor: "color-mix(in srgb, #c9a83a 18%, #1d1f29)" }} />

        {/* Stats grid — five tiles each with a top-border KPI accent +
            inset halo so the bar reads like premium gauges, not plain
            text rows. Active In replaces the redundant "Active" stat. */}
        <div className="px-2 py-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 relative">
          {[
            { label: t("campaignDetail.metric.totalLeads"), value: totalLeadsInGroup,                                color: gold },
            { label: t("campaignDetail.metric.paused"),     value: pausedInGroup,                                    color: "#D97706" },
            { label: t("campaignDetail.metric.completed"),  value: completedInGroup,                                 color: "color-mix(in srgb, #F5F2E8 65%, transparent)" },
            { label: t("campaignDetail.metric.progress"),   value: `${pct}%`,                                        color: gold },
          ].map(s => (
            <div
              key={s.label}
              className="px-3 py-3 rounded-xl relative overflow-hidden"
              style={{
                backgroundColor: "rgba(255,255,255,0.025)",
                borderTop: `2px solid color-mix(in srgb, ${s.color} 70%, transparent)`,
                boxShadow: `0 0 18px color-mix(in srgb, ${s.color} 8%, transparent) inset`,
              }}
            >
              <p
                className="text-[9px] font-bold uppercase tracking-[0.14em] mb-1"
                style={{ color: "color-mix(in srgb, #F5F2E8 55%, transparent)", letterSpacing: "0.14em" }}
              >
                {s.label}
              </p>
              <p
                className="text-[22px] font-bold leading-none tabular-nums"
                style={{
                  color: s.color,
                  fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  letterSpacing: "-0.02em",
                }}
              >
                {s.value}
              </p>
            </div>
          ))}
          <div
            className="px-3 py-3 rounded-xl relative overflow-hidden"
            style={{
              backgroundColor: "rgba(255,255,255,0.025)",
              borderTop: `2px solid color-mix(in srgb, ${gold} 70%, transparent)`,
              boxShadow: `0 0 18px color-mix(in srgb, ${gold} 8%, transparent) inset`,
            }}
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] mb-1.5" style={{ color: "color-mix(in srgb, #F5F2E8 55%, transparent)", letterSpacing: "0.14em" }}>{t("campaignDetail.metric.activeIn")}</p>
            {activeChannelEntries.length === 0 ? (
              <p className="text-[16px] font-bold leading-none" style={{ color: "color-mix(in srgb, #F5F2E8 35%, transparent)", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>—</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                {activeChannelEntries.map(([ch, count]) => {
                  const meta = ({
                    linkedin: { label: "LinkedIn", color: "#5BA9FF" },
                    email:    { label: "Email",    color: "#B093FF" },
                    call:     { label: "Call",     color: "#FF9D5B" },
                    whatsapp: { label: "WhatsApp", color: "#5BE89A" },
                  } as Record<string, { label: string; color: string }>)[ch] ?? { label: ch, color: "color-mix(in srgb, #F5F2E8 70%, transparent)" };
                  return (
                    <span key={ch}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 border"
                      title={`${count} lead${count === 1 ? "" : "s"} currently on a ${meta.label} step`}
                      style={{
                        backgroundColor: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
                        color: meta.color,
                        borderColor: `color-mix(in srgb, ${meta.color} 38%, transparent)`,
                      }}>
                      <span className="font-bold tabular-nums">{count}</span> {meta.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ TABBED CONTENT (Client Component) — Metrics tab is first ═══ */}
      <CampaignDetailClient
        flowMetrics={flowMetrics}
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
