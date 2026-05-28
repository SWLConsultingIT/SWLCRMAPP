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
    .limit(500);
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

  const { data: activeCampLeadIds } = await supabase
    .from("campaigns").select("lead_id").in("status", ["active", "paused"]);
  const activeSet = new Set((activeCampLeadIds ?? []).map(c => c.lead_id).filter(Boolean));

  const { data: rawAllLeads } = await supabase
    .from("leads")
    .select("id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, primary_title_role, lead_score, allow_linkedin, allow_email, allow_call, icp_profile_id, company_bio_id")
    .eq("company_bio_id", companyBioId)
    .order("created_at", { ascending: false }).limit(200);
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
          <Link href={`/campaigns/${id}/edit`}
            className="shrink-0 flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 75%, white))`,
              color: "#1A1505",
              boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 38%, transparent)`,
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

      {/* ═══ TABBED CONTENT (Client Component) ═══ */}
      <CampaignDetailClient
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
