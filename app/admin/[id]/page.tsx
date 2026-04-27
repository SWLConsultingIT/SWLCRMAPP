import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminPage } from "@/lib/auth-admin";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Target, Users, Megaphone, Clock, MapPin, Briefcase, Globe,
  ChevronRight, Share2, Mail, Phone, User, AlertTriangle, CheckCircle2,
  TrendingUp, Activity, AlertCircle,
} from "lucide-react";
import AdminActions from "../AdminActions";
import ClientResourcesTabs from "./ClientResourcesTabs";

const gold = "var(--brand, #c9a83a)";
const goldLight = "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)";
const supabase = getSupabaseService();

function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Data fetchers ──────────────────────────────────────────────────────────────

async function getClient(id: string) {
  const { data } = await supabase.from("company_bios").select("*").eq("id", id).single();
  return data;
}

async function getProfiles(bioId: string) {
  const { data } = await supabase
    .from("icp_profiles")
    .select("*")
    .eq("company_bio_id", bioId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getLeads(bioId: string) {
  const { data, count } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, status, current_channel, lead_score, primary_work_email", { count: "exact" })
    .eq("company_bio_id", bioId)
    .order("updated_at", { ascending: false })
    .limit(20);
  return { leads: data ?? [], total: count ?? 0 };
}

async function getCampaigns(bioId: string) {
  const { data: leadIds } = await supabase.from("leads").select("id").eq("company_bio_id", bioId);
  if (!leadIds?.length) return { campaigns: [], total: 0 };
  const ids = leadIds.map(l => l.id);
  const { data, count } = await supabase
    .from("campaigns")
    .select("id, name, channel, status, current_step, sequence_steps, last_step_at, leads(primary_first_name, primary_last_name, company_name), sellers(name)", { count: "exact" })
    .in("lead_id", ids)
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(20);
  return { campaigns: data ?? [], total: count ?? 0 };
}

async function getPendingCampaignRequests(_bioId: string, profileIds: string[], leadIds: string[]) {
  const requests: any[] = [];
  if (profileIds.length > 0) {
    const { data } = await supabase
      .from("campaign_requests")
      .select("*")
      .eq("status", "pending_review")
      .in("icp_profile_id", profileIds);
    if (data) requests.push(...data);
  }
  if (leadIds.length > 0) {
    const { data } = await supabase
      .from("campaign_requests")
      .select("*")
      .eq("status", "pending_review")
      .in("lead_id", leadIds)
      .is("icp_profile_id", null);
    if (data) requests.push(...data);
  }
  const seen = new Set<string>();
  return requests
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

type SellerEntry = {
  name: string;
  activeCampaigns: number;
  lastActivity: string | null;
  linkedinStatus: string;
  linkedinStatusNote: string | null;
  linkedinStatusUpdatedAt: string | null;
};

async function getMonitoringData(bioId: string) {
  const { data: allLeads } = await supabase
    .from("leads")
    .select("id, status")
    .eq("company_bio_id", bioId);

  const leadIds = (allLeads ?? []).map(l => l.id);

  if (!leadIds.length) {
    return {
      totalLeads: 0, contacted: 0, replies: 0, positive: 0, won: 0, lost: 0,
      responseRate: 0, positiveRate: 0,
      activeCampaigns: 0, pausedCampaigns: 0,
      channels: {} as Record<string, { active: number; lastActivity: string | null }>,
      sellers: [] as SellerEntry[],
      alerts: [] as { level: "red" | "yellow"; message: string }[],
    };
  }

  const [{ data: allCampaigns }, { count: replyCount }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, channel, status, last_step_at, sellers(id, name, linkedin_status, linkedin_status_note, linkedin_status_updated_at)")
      .in("lead_id", leadIds),
    supabase
      .from("lead_replies")
      .select("id", { count: "exact", head: true })
      .in("lead_id", leadIds),
  ]);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const contacted = (allLeads ?? []).filter(l => l.status && l.status !== "new").length;
  const positive  = (allLeads ?? []).filter(l => ["replied_positive", "closed_won"].includes(l.status ?? "")).length;
  const won       = (allLeads ?? []).filter(l => l.status === "closed_won").length;
  const lost      = (allLeads ?? []).filter(l => l.status === "closed_lost").length;
  const replies   = replyCount ?? 0;

  const activeCamps = (allCampaigns ?? []).filter(c => c.status === "active");
  const pausedCamps = (allCampaigns ?? []).filter(c => c.status === "paused");
  const staleCamps  = activeCamps.filter(c => !c.last_step_at || c.last_step_at < sevenDaysAgo);

  const channels: Record<string, { active: number; lastActivity: string | null }> = {};
  for (const c of allCampaigns ?? []) {
    if (!channels[c.channel]) channels[c.channel] = { active: 0, lastActivity: null };
    if (c.status === "active") channels[c.channel].active++;
    if (c.last_step_at && (!channels[c.channel].lastActivity || c.last_step_at > channels[c.channel].lastActivity!)) {
      channels[c.channel].lastActivity = c.last_step_at;
    }
  }

  const sellerMap: Record<string, SellerEntry> = {};
  for (const c of allCampaigns ?? []) {
    const s = c.sellers as any;
    if (!s?.id) continue;
    if (!sellerMap[s.id]) {
      sellerMap[s.id] = {
        name: s.name,
        activeCampaigns: 0,
        lastActivity: null,
        linkedinStatus: s.linkedin_status ?? "active",
        linkedinStatusNote: s.linkedin_status_note ?? null,
        linkedinStatusUpdatedAt: s.linkedin_status_updated_at ?? null,
      };
    }
    if (c.status === "active") sellerMap[s.id].activeCampaigns++;
    if (c.last_step_at && (!sellerMap[s.id].lastActivity || c.last_step_at > sellerMap[s.id].lastActivity!)) {
      sellerMap[s.id].lastActivity = c.last_step_at;
    }
  }

  const alerts: { level: "red" | "yellow"; message: string }[] = [];
  const bannedSellers  = Object.values(sellerMap).filter(s => s.linkedinStatus === "banned");
  const warningSellers = Object.values(sellerMap).filter(s => s.linkedinStatus === "restricted" || s.linkedinStatus === "warning");

  if (bannedSellers.length > 0)
    alerts.push({ level: "red", message: `LinkedIn account banned: ${bannedSellers.map(s => s.name).join(", ")}` });
  if (warningSellers.length > 0)
    alerts.push({ level: "yellow", message: `LinkedIn account restricted/warning: ${warningSellers.map(s => s.name).join(", ")}` });
  if (staleCamps.length > 0 && bannedSellers.length === 0)
    alerts.push({ level: "yellow", message: `${staleCamps.length} active campaign${staleCamps.length > 1 ? "s" : ""} with no activity in 7+ days` });
  if (pausedCamps.length > 0)
    alerts.push({ level: "yellow", message: `${pausedCamps.length} campaign${pausedCamps.length > 1 ? "s are" : " is"} paused` });

  return {
    totalLeads: leadIds.length, contacted, replies, positive, won, lost,
    responseRate: contacted > 0 ? Math.round((replies / contacted) * 100) : 0,
    positiveRate: contacted > 0 ? Math.round((positive / contacted) * 100) : 0,
    activeCampaigns: activeCamps.length,
    pausedCampaigns: pausedCamps.length,
    channels,
    sellers: Object.values(sellerMap),
    alerts,
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const statusStyles: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "Pending",  color: "#D97706", bg: "#FFFBEB" },
  reviewed: { label: "Reviewed", color: C.blue,    bg: C.blueLight },
  approved: { label: "Approved", color: C.green,   bg: C.greenLight },
  rejected: { label: "Rejected", color: C.red,     bg: C.redLight },
};

const leadStatusStyles: Record<string, { color: string; bg: string }> = {
  new:              { color: C.blue,    bg: C.blueLight },
  contacted:        { color: C.orange,  bg: C.orangeLight },
  connected:        { color: C.accent,  bg: C.accentLight },
  responded:        { color: C.green,   bg: C.greenLight },
  replied_positive: { color: C.green,   bg: C.greenLight },
  replied_negative: { color: C.red,     bg: C.redLight },
  qualified:        { color: C.green,   bg: C.greenLight },
  proposal_sent:    { color: C.accent,  bg: C.accentLight },
  closed_won:       { color: C.green,   bg: C.greenLight },
  closed_lost:      { color: C.red,     bg: C.redLight },
};

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: C.linkedin, label: "LinkedIn" },
  email:    { icon: Mail,     color: C.email,    label: "Email" },
  call:     { icon: Phone,    color: C.phone,    label: "Call" },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();

  const [profiles, { leads, total: totalLeads }, { campaigns, total: totalCampaigns }, monitoring] = await Promise.all([
    getProfiles(id), getLeads(id), getCampaigns(id), getMonitoringData(id),
  ]);

  const profileIds = profiles.map((p: any) => p.id);
  const { data: clientLeadIds } = await supabase.from("leads").select("id").eq("company_bio_id", id);
  const leadIdList = (clientLeadIds ?? []).map((l: any) => l.id);
  const pendingRequests = await getPendingCampaignRequests(id, profileIds, leadIdList);

  const pendingProfiles  = profiles.filter((p: any) => p.status === "pending");
  const approvedProfiles = profiles.filter((p: any) => p.status === "approved");

  const allChannels = ["linkedin", "email", "call"];

  return (
    <div className="p-6 w-full space-y-6">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs" style={{ color: C.textMuted }}>
        <Link href="/admin" className="hover:underline flex items-center gap-1"><ArrowLeft size={12} /> Admin</Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{client.company_name}</span>
      </div>

      {/* ═══ CLIENT HEADER ═══ */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6 flex items-start gap-5">
          {client.logo_url ? (
            <img src={client.logo_url} alt="" className="w-16 h-16 rounded-xl object-cover border shrink-0" style={{ borderColor: C.border }} />
          ) : (
            <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold shrink-0"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
              {client.company_name?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{client.company_name}</h1>
            <div className="flex items-center gap-4 mt-1.5">
              {client.industry && <span className="flex items-center gap-1.5 text-sm" style={{ color: C.textBody }}><Briefcase size={13} style={{ color: gold }} /> {client.industry}</span>}
              {client.location && <span className="flex items-center gap-1 text-sm" style={{ color: C.textMuted }}><MapPin size={12} /> {client.location}</span>}
              {client.website && (
                <a href={client.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm hover:underline" style={{ color: C.accent }}>
                  <Globe size={12} /> Website
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="border-t" style={{ borderColor: C.border }} />

        <div className="px-6 py-4 grid grid-cols-5 gap-4">
          {[
            { label: "Lead Gen Profiles", value: profiles.length,        color: gold },
            { label: "Pending Tickets",   value: pendingProfiles.length, color: "#D97706" },
            { label: "Approved",          value: approvedProfiles.length, color: C.green },
            { label: "Total Leads",       value: totalLeads,              color: C.blue },
            { label: "Campaigns",         value: totalCampaigns,          color: C.accent },
          ].map(m => (
            <div key={m.label}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>{m.label}</p>
              <p className="text-xl font-bold" style={{ color: m.color }}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ HEALTH ALERTS ═══ */}
      {monitoring.alerts.length > 0 ? (
        <div className="space-y-2">
          {monitoring.alerts.map((alert, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium"
              style={{
                backgroundColor: alert.level === "red" ? C.redLight : "#FFFBEB",
                borderColor: alert.level === "red" ? `${C.red}30` : "#FDE68A",
                color: alert.level === "red" ? C.red : "#92400E",
              }}>
              <AlertTriangle size={15} />
              {alert.message}
            </div>
          ))}
        </div>
      ) : monitoring.activeCampaigns > 0 ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium"
          style={{ backgroundColor: C.greenLight, borderColor: `${C.green}30`, color: C.green }}>
          <CheckCircle2 size={15} />
          All systems operational — no issues detected
        </div>
      ) : null}

      {/* ═══ MONITORING METRICS ═══ */}
      <div className="grid grid-cols-2 gap-6">

        {/* Conversion Funnel */}
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="px-5 py-4 flex items-center gap-2 border-b" style={{ borderColor: C.border }}>
            <TrendingUp size={14} style={{ color: gold }} />
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Conversion Funnel</h2>
          </div>
          <div className="p-5 space-y-3">
            {[
              { label: "Total Leads",  value: monitoring.totalLeads,  color: C.blue,   pct: 100 },
              { label: "Contacted",    value: monitoring.contacted,   color: C.orange, pct: monitoring.totalLeads > 0 ? Math.round((monitoring.contacted / monitoring.totalLeads) * 100) : 0 },
              { label: "Replied",      value: monitoring.replies,     color: C.accent, pct: monitoring.totalLeads > 0 ? Math.round((monitoring.replies / monitoring.totalLeads) * 100) : 0 },
              { label: "Positive",     value: monitoring.positive,    color: C.green,  pct: monitoring.totalLeads > 0 ? Math.round((monitoring.positive / monitoring.totalLeads) * 100) : 0 },
              { label: "Won",          value: monitoring.won,         color: gold,     pct: monitoring.totalLeads > 0 ? Math.round((monitoring.won / monitoring.totalLeads) * 100) : 0 },
            ].map(row => (
              <div key={row.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium" style={{ color: C.textBody }}>{row.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums font-bold" style={{ color: row.color }}>{row.value}</span>
                    <span className="text-[10px] w-8 text-right tabular-nums" style={{ color: C.textDim }}>{row.pct}%</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full" style={{ backgroundColor: C.bg }}>
                  <div className="h-1.5 rounded-full transition-all" style={{ width: `${row.pct}%`, backgroundColor: row.color }} />
                </div>
              </div>
            ))}

            <div className="pt-3 border-t flex gap-4" style={{ borderColor: C.border }}>
              <div className="flex-1 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>Response Rate</p>
                <p className="text-xl font-bold" style={{ color: monitoring.responseRate > 20 ? C.green : monitoring.responseRate > 10 ? "#D97706" : C.red }}>
                  {monitoring.responseRate}%
                </p>
              </div>
              <div className="w-px" style={{ backgroundColor: C.border }} />
              <div className="flex-1 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>Positive Rate</p>
                <p className="text-xl font-bold" style={{ color: monitoring.positiveRate > 10 ? C.green : monitoring.positiveRate > 5 ? "#D97706" : C.red }}>
                  {monitoring.positiveRate}%
                </p>
              </div>
              <div className="w-px" style={{ backgroundColor: C.border }} />
              <div className="flex-1 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>Lost</p>
                <p className="text-xl font-bold" style={{ color: C.textMuted }}>{monitoring.lost}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Channel Status + Seller Health */}
        <div className="space-y-4">

          {/* Channel Status */}
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="px-5 py-4 flex items-center gap-2 border-b" style={{ borderColor: C.border }}>
              <Activity size={14} style={{ color: C.blue }} />
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Channel Status</h2>
            </div>
            <div className="divide-y" style={{ borderColor: C.border }}>
              {allChannels.map(ch => {
                const meta  = channelMeta[ch];
                const stats = monitoring.channels[ch];
                const Icon  = meta.icon;
                const isActive = (stats?.active ?? 0) > 0;
                const lastAct  = stats?.lastActivity ?? null;
                const stale    = lastAct && lastAct < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                const statusColor = !stats ? C.textDim : isActive && !stale ? C.green : stale ? C.red : "#D97706";
                const statusLabel = !stats ? "No campaigns" : isActive && !stale ? "Active" : stale ? "Stale" : "Paused";
                return (
                  <div key={ch} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${meta.color}12` }}>
                      <Icon size={15} style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium" style={{ color: C.textPrimary }}>{meta.label}</p>
                      <p className="text-[11px]" style={{ color: C.textDim }}>
                        {stats ? `${stats.active} active · last: ${timeAgo(lastAct)}` : "No activity"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
                      <span className="text-xs font-semibold" style={{ color: statusColor }}>{statusLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Seller Health */}
          {monitoring.sellers.length > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="px-5 py-4 flex items-center gap-2 border-b" style={{ borderColor: C.border }}>
                <Share2 size={14} style={{ color: C.linkedin }} />
                <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Seller Accounts</h2>
              </div>
              <div className="divide-y" style={{ borderColor: C.border }}>
                {monitoring.sellers.map((seller, i) => {
                  const ls = seller.linkedinStatus;
                  const statusColor = ls === "banned" ? C.red : ls === "restricted" || ls === "warning" ? "#D97706" : C.green;
                  const statusLabel = ls === "banned" ? "Banned" : ls === "restricted" ? "Restricted" : ls === "warning" ? "Warning" : "Active";
                  return (
                    <div key={i} className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                          {seller.name[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{seller.name}</p>
                          <p className="text-[11px]" style={{ color: C.textDim }}>
                            {seller.activeCampaigns} active · last: {timeAgo(seller.lastActivity)}
                          </p>
                        </div>
                        <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                          style={{ backgroundColor: `${statusColor}15`, color: statusColor }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
                          {statusLabel}
                        </span>
                      </div>
                      {seller.linkedinStatusNote && (
                        <p className="mt-1.5 ml-10 text-[11px] px-2 py-1 rounded-md"
                          style={{ backgroundColor: `${statusColor}10`, color: statusColor }}>
                          {seller.linkedinStatusNote}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ PENDING TICKETS ═══ */}
      {pendingProfiles.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid #D97706` }}>
          <div className="px-6 py-4 flex items-center gap-2.5 border-b" style={{ borderColor: C.border, background: "rgba(217,119,6,0.04)" }}>
            <Clock size={15} style={{ color: "#D97706" }} />
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Pending Tickets</h2>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
              {pendingProfiles.length}
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: C.border }}>
            {pendingProfiles.map((p: any) => (
              <div key={p.id} className="px-6 py-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>{p.profile_name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{timeAgo(p.created_at)}</p>
                  </div>
                  <AdminActions id={p.id} table="icp_profiles" />
                </div>
                <div className="flex flex-wrap gap-4 text-xs" style={{ color: C.textBody }}>
                  {p.target_industries?.length > 0 && <span><span className="font-medium" style={{ color: C.textMuted }}>Industries:</span> {p.target_industries.join(", ")}</span>}
                  {p.target_roles?.length > 0 && <span><span className="font-medium" style={{ color: C.textMuted }}>Roles:</span> {p.target_roles.join(", ")}</span>}
                  {p.geography?.length > 0 && <span><span className="font-medium" style={{ color: C.textMuted }}>Geo:</span> {p.geography.join(", ")}</span>}
                  {p.company_size && <span><span className="font-medium" style={{ color: C.textMuted }}>Size:</span> {p.company_size}</span>}
                </div>
                {p.pain_points && <p className="text-xs mt-2" style={{ color: C.textBody }}><span className="font-medium" style={{ color: C.textMuted }}>Pain: </span>{p.pain_points}</p>}
                {p.solutions_offered && <p className="text-xs mt-1" style={{ color: C.textBody }}><span className="font-medium" style={{ color: C.textMuted }}>Solution: </span>{p.solutions_offered}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ PENDING CAMPAIGN REVIEWS ═══ */}
      {pendingRequests.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.blue}` }}>
          <div className="px-6 py-4 flex items-center gap-2.5 border-b" style={{ borderColor: C.border, background: `${C.blue}06` }}>
            <Megaphone size={15} style={{ color: C.blue }} />
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Pending Campaign Reviews</h2>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: C.blueLight, color: C.blue }}>
              {pendingRequests.length}
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: C.border }}>
            {pendingRequests.map((req: any) => {
              const prompts  = req.message_prompts ?? {};
              const sequence: { channel: string; daysAfter: number }[] = prompts.sequence ?? [];
              const channels: string[] = req.channels ?? [...new Set(sequence.map((s: any) => s.channel))];
              const isIndividual = !!req.lead_id && req.target_leads_count === 1;
              let totalDays = 0;
              sequence.forEach((s: any, i: number) => { totalDays += i === 0 ? 0 : s.daysAfter; });
              return (
                <div key={req.id} className="px-6 py-5">
                  <div className="flex items-start justify-between mb-4">
                    <Link href={`/admin/review/${req.id}`} className="flex-1 hover:opacity-80 transition-opacity">
                      <div className="flex items-center gap-2 mb-1">
                        {isIndividual && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                            style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>
                            <User size={10} /> Individual
                          </span>
                        )}
                        <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>{req.name}</h3>
                        <span className="text-xs" style={{ color: gold }}>View details →</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: C.textMuted }}>
                        <span>{timeAgo(req.created_at)}</span>
                        <span>·</span>
                        <span>{req.target_leads_count} {req.target_leads_count === 1 ? "lead" : "leads"}</span>
                        <span>·</span>
                        <span>{sequence.length} steps · ~{totalDays} days</span>
                        {prompts.language && <><span>·</span><span>{prompts.language.toUpperCase()}</span></>}
                      </div>
                    </Link>
                    <AdminActions id={req.id} table="campaign_requests" />
                  </div>
                  <div className="flex items-center gap-2">
                    {channels.map((ch: string) => {
                      const meta = channelMeta[ch];
                      if (!meta) return null;
                      const Icon = meta.icon;
                      return (
                        <span key={ch} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md"
                          style={{ backgroundColor: `${meta.color}12`, color: meta.color }}>
                          <Icon size={11} /> {meta.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ TWO COLUMNS: Profiles + Leads ═══ */}
      <div className="grid grid-cols-2 gap-6">
        {/* Lead Gen Profiles */}
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <div className="px-6 py-4 flex items-center justify-between border-b"
            style={{ borderColor: C.border, background: `linear-gradient(90deg, ${goldLight} 0%, transparent 50%)` }}>
            <div className="flex items-center gap-2">
              <Target size={14} style={{ color: gold }} />
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Lead Gen Profiles</h2>
            </div>
            <span className="text-xs" style={{ color: C.textMuted }}>{profiles.length} total</span>
          </div>
          {profiles.length === 0 ? (
            <div className="px-6 py-8 text-center"><p className="text-sm" style={{ color: C.textDim }}>No profiles created yet</p></div>
          ) : (
            <div className="divide-y" style={{ borderColor: C.border }}>
              {profiles.map((p: any) => {
                const st = statusStyles[p.status] ?? statusStyles.pending;
                return (
                  <Link key={p.id} href={`/admin/${id}/profile/${p.id}`}
                    className="px-6 py-3.5 flex items-center gap-3 table-row-hover">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{p.profile_name}</p>
                      <p className="text-xs" style={{ color: C.textMuted }}>
                        {[...(p.target_industries ?? []), ...(p.target_roles ?? [])].slice(0, 3).join(", ")}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold shrink-0"
                      style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
                    {p.status === "approved" && p.execution_status && p.execution_status !== "not_started" && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-md shrink-0"
                        style={{
                          backgroundColor: p.execution_status === "completed" ? C.greenLight : p.execution_status === "uploaded" ? C.blueLight : "#FFFBEB",
                          color: p.execution_status === "completed" ? C.green : p.execution_status === "uploaded" ? C.blue : "#D97706",
                        }}>
                        {p.execution_status === "completed" ? "Done" : p.execution_status === "uploaded" ? "Leads Uploaded" : "In Progress"}
                      </span>
                    )}
                    <ChevronRight size={14} style={{ color: C.textDim }} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Leads */}
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.blue}` }}>
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: C.border, background: `${C.blue}08` }}>
            <div className="flex items-center gap-2">
              <Users size={14} style={{ color: C.blue }} />
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Leads</h2>
            </div>
            <span className="text-xs" style={{ color: C.textMuted }}>{totalLeads} total</span>
          </div>
          {leads.length === 0 ? (
            <div className="px-6 py-8 text-center"><p className="text-sm" style={{ color: C.textDim }}>No leads assigned yet</p></div>
          ) : (
            <div className="divide-y" style={{ borderColor: C.border }}>
              {leads.map((lead: any) => {
                const st = leadStatusStyles[lead.status] ?? { color: C.textMuted, bg: "#F3F4F6" };
                return (
                  <Link key={lead.id} href={`/leads/${lead.id}`} className="flex items-center gap-3 px-6 py-3 table-row-hover">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                      {(lead.primary_first_name?.[0] ?? "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{lead.primary_first_name} {lead.primary_last_name}</p>
                      <p className="text-xs truncate" style={{ color: C.textMuted }}>{lead.company_name}</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md capitalize shrink-0"
                      style={{ backgroundColor: st.bg, color: st.color }}>
                      {lead.status?.replace("_", " ")}
                    </span>
                    <ChevronRight size={14} style={{ color: C.textDim }} />
                  </Link>
                );
              })}
              {totalLeads > 20 && (
                <div className="px-6 py-3 text-center">
                  <Link href="/leads" className="text-xs font-semibold" style={{ color: gold }}>View all {totalLeads} leads →</Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ CAMPAIGNS ═══ */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.green}` }}>
        <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: C.border, background: `${C.green}08` }}>
          <div className="flex items-center gap-2">
            <Megaphone size={14} style={{ color: C.green }} />
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Campaigns</h2>
          </div>
          <span className="text-xs" style={{ color: C.textMuted }}>{totalCampaigns} total</span>
        </div>
        {campaigns.length === 0 ? (
          <div className="px-6 py-8 text-center"><p className="text-sm" style={{ color: C.textDim }}>No campaigns running yet</p></div>
        ) : (
          <div className="divide-y" style={{ borderColor: C.border }}>
            {campaigns.map((c: any) => {
              const ch = channelMeta[c.channel] ?? channelMeta.email;
              const ChIcon = ch.icon;
              const totalSteps = c.sequence_steps?.length ?? 0;
              const pct = totalSteps > 0 ? Math.round((c.current_step / totalSteps) * 100) : 0;
              const isActive = c.status === "active";
              const stale = c.last_step_at && c.last_step_at < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
              return (
                <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center gap-4 px-6 py-3.5 table-row-hover">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: C.textPrimary }}>{c.leads?.primary_first_name} {c.leads?.primary_last_name}</p>
                    <p className="text-xs" style={{ color: C.textMuted }}>{c.leads?.company_name}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ChIcon size={13} style={{ color: ch.color }} />
                    <span className="text-xs font-semibold capitalize" style={{ color: ch.color }}>{c.channel}</span>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md capitalize shrink-0"
                    style={{ backgroundColor: isActive ? (stale ? C.redLight : C.greenLight) : "#F3F4F6", color: isActive ? (stale ? C.red : C.green) : C.textMuted }}>
                    {isActive && stale ? "stale" : c.status}
                  </span>
                  <div className="flex items-center gap-2 w-24 shrink-0">
                    <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }} />
                    </div>
                    <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>{c.current_step}/{totalSteps}</span>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: C.textBody }}>{c.sellers?.name ?? "—"}</span>
                  <span className="text-xs tabular-nums shrink-0" style={{ color: c.last_step_at && stale ? C.red : C.textMuted }}>{c.last_step_at ? timeAgo(c.last_step_at) : "—"}</span>
                  <ChevronRight size={14} style={{ color: C.textDim }} />
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ CLIENT RESOURCES (Users, Sellers, Aircall, Emails) ═══ */}
      <ClientResourcesTabs companyBioId={id} companyName={client.company_name} />
    </div>
  );
}
