import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { redirect } from "next/navigation";
import { C } from "@/lib/design";
import { Share2, Mail, Phone } from "lucide-react";
import Link from "next/link";
import DashboardHero from "@/components/DashboardHero";
import DashboardStats from "@/components/DashboardStats";
import DashboardTabs from "@/components/DashboardTabs";
import DashboardFilters from "@/components/DashboardFilters";
import CollapsibleCard from "@/components/CollapsibleCard";
import ReliabilityBanner from "@/components/ReliabilityBanner";
import AlertsPanel from "@/components/AlertsPanel";
import ReportsPage from "@/app/reports/page";

export type DashboardFilterValues = {
  from: string | null;       // ISO date "YYYY-MM-DD"
  to: string | null;
  campaignNames: string[];   // filter by campaign.name (groups of leads share a name)
  sellerIds: string[];
  icpIds: string[];
};

function parseFilters(sp: Record<string, string | string[] | undefined>): DashboardFilterValues {
  const get = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : sp[k]) as string | undefined;
  const split = (v: string | undefined) => (v ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return {
    from: get("from") ?? null,
    to: get("to") ?? null,
    campaignNames: split(get("campaigns")),
    sellerIds: split(get("sellers")),
    icpIds: split(get("icps")),
  };
}

// Skip the static-or-PPR optimization attempt — this page is fully
// user-scoped (counts vary per tenant) so static gen is wasted work
// that adds 200-500ms before falling back to dynamic on every cold request.
export const dynamic = "force-dynamic";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const classColors: Record<string, { color: string; bg: string; label: string }> = {
  positive:       { color: C.green,   bg: C.greenLight, label: "Positive" },
  meeting_intent: { color: C.green,   bg: C.greenLight, label: "Meeting Intent" },
  negative:       { color: C.red,     bg: C.redLight,   label: "Negative" },
  question:       { color: "#D97706", bg: "#FFFBEB",    label: "Question" },
};

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function getDashboardData(filters: DashboardFilterValues) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  // Date window: explicit `from` / `to` overrides the default 7-day reply
  // window so KPI cards and "recent replies" both honour the same range.
  // `to` is treated as inclusive — anything sent that calendar day counts.
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const twoWeeksAgo = new Date(now - 14 * 86400000).toISOString();
  const fromIso = filters.from ? new Date(`${filters.from}T00:00:00Z`).toISOString() : weekAgo;
  const toIso = filters.to ? new Date(`${filters.to}T23:59:59Z`).toISOString() : null;

  // Pre-resolve campaign IDs from the requested campaign names so subsequent
  // counts can use `.in("campaign_id", ids)` without an extra join layer.
  // `q` is typed as any: branching the select() string yields divergent inner-
  // join shapes that the supabase-js inferred type can't reconcile, and the
  // narrowing is irrelevant — we only read `id` off the row.
  let campaignIdsForFilter: string[] | null = null;
  if (filters.campaignNames.length > 0) {
    const selectCols = filters.icpIds.length > 0
      ? "id, leads!inner(company_bio_id, icp_profile_id)"
      : "id, leads!inner(company_bio_id)";
    let q: any = supabase.from("campaigns").select(selectCols).in("name", filters.campaignNames);
    if (bioId) q = q.eq("leads.company_bio_id", bioId);
    if (filters.sellerIds.length > 0) q = q.in("seller_id", filters.sellerIds);
    if (filters.icpIds.length > 0) q = q.in("leads.icp_profile_id", filters.icpIds);
    const { data } = await q;
    const ids = (data ?? []).map((c: { id: string }) => c.id);
    campaignIdsForFilter = ids.length > 0 ? ids : ["__none__"]; // sentinel: zero results
  }

  // Leads scope: direct eq on company_bio_id. ICP + date filters apply too —
  // alert counts (pending review etc.) stay unfiltered below because those are
  // operational signals that should remain visible regardless of the view.
  let leadsCountQ = bioId
    ? supabase.from("leads").select("*", { count: "exact", head: true }).eq("company_bio_id", bioId)
    : supabase.from("leads").select("*", { count: "exact", head: true });
  if (filters.icpIds.length > 0) leadsCountQ = leadsCountQ.in("icp_profile_id", filters.icpIds);
  if (filters.from) leadsCountQ = leadsCountQ.gte("created_at", fromIso);
  if (toIso) leadsCountQ = leadsCountQ.lte("created_at", toIso);

  let activeCampsQ = bioId
    ? supabase.from("campaigns").select("id, name, status, channel, current_step, sequence_steps, lead_id, seller_id, last_step_at, leads!inner(company_bio_id, icp_profile_id)").eq("leads.company_bio_id", bioId).in("status", ["active", "paused"])
    : supabase.from("campaigns").select("id, name, status, channel, current_step, sequence_steps, lead_id, seller_id, last_step_at, leads(icp_profile_id)").in("status", ["active", "paused"]);
  if (filters.campaignNames.length > 0) activeCampsQ = activeCampsQ.in("name", filters.campaignNames);
  if (filters.sellerIds.length > 0) activeCampsQ = activeCampsQ.in("seller_id", filters.sellerIds);
  if (filters.icpIds.length > 0) activeCampsQ = activeCampsQ.in("leads.icp_profile_id", filters.icpIds);

  let transferredQ = bioId
    ? supabase.from("leads").select("*", { count: "exact", head: true }).eq("company_bio_id", bioId).not("transferred_to_odoo_at", "is", null)
    : supabase.from("leads").select("*", { count: "exact", head: true }).not("transferred_to_odoo_at", "is", null);
  if (filters.icpIds.length > 0) transferredQ = transferredQ.in("icp_profile_id", filters.icpIds);
  if (filters.from) transferredQ = transferredQ.gte("transferred_to_odoo_at", fromIso);
  if (toIso) transferredQ = transferredQ.lte("transferred_to_odoo_at", toIso);

  const pendingReviewRepliesQ = bioId
    ? supabase.from("lead_replies").select("*, leads!inner(company_bio_id)", { count: "exact", head: true }).eq("leads.company_bio_id", bioId).eq("requires_human_review", true).eq("review_status", "pending")
    : supabase.from("lead_replies").select("*", { count: "exact", head: true }).eq("requires_human_review", true).eq("review_status", "pending");

  const pendingProfilesQ = bioId
    ? supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("company_bio_id", bioId).eq("status", "pending")
    : supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("status", "pending");

  // Campaign requests: when scoped, filter to requests whose icp_profile
  // belongs to this tenant. We do this via a join in one round-trip
  // (campaign_requests!inner(icp_profiles)) instead of fetching profile IDs
  // first and then filtering — that serial await blocked the parallel
  // batch below for ~150-200ms.
  const pendingCampReviewsQ = bioId
    ? supabase
        .from("campaign_requests")
        .select("*, icp_profiles!inner(company_bio_id)", { count: "exact", head: true })
        .eq("status", "pending_review")
        .eq("icp_profiles.company_bio_id", bioId)
    : supabase.from("campaign_requests").select("*", { count: "exact", head: true }).eq("status", "pending_review");

  // Merged replies query: pull date-windowed rows for the widget. The default
  // window is 7d; an explicit `from` overrides it. weekPositive + recent are
  // both derived from this single payload. 200-row cap defends against inbox
  // explosions; widget shows top 8 and downstream counters tolerate the trim.
  let mergedRepliesQ = bioId
    ? supabase.from("lead_replies")
        .select("id, lead_id, classification, channel, reply_text, received_at, campaign_id, leads!inner(primary_first_name, primary_last_name, company_name, company_bio_id, icp_profile_id), campaigns(name)")
        .eq("leads.company_bio_id", bioId)
        .gte("received_at", fromIso)
        .order("received_at", { ascending: false })
        .limit(200)
    : supabase.from("lead_replies")
        .select("id, lead_id, classification, channel, reply_text, received_at, campaign_id, leads(primary_first_name, primary_last_name, company_name, icp_profile_id), campaigns(name)")
        .gte("received_at", fromIso)
        .order("received_at", { ascending: false })
        .limit(200);
  if (toIso) mergedRepliesQ = mergedRepliesQ.lte("received_at", toIso);
  if (filters.icpIds.length > 0) mergedRepliesQ = mergedRepliesQ.in("leads.icp_profile_id", filters.icpIds);
  if (campaignIdsForFilter) mergedRepliesQ = mergedRepliesQ.in("campaign_id", campaignIdsForFilter);

  // 14-day trend windows for KPI deltas + sparklines. Two-week window so we
  // can split into current 7d vs prior 7d for the delta calc. ICP filter only
  // applies to the leads creation query — replies/transfers already join
  // through `leads` so we filter at the join. Date filter from the bar is
  // intentionally NOT applied to trend windows: the spark/delta are about
  // "the last 14 days" by definition, independent of the date filter view.
  let leadTrendQ = bioId
    ? supabase.from("leads").select("created_at, transferred_to_odoo_at").eq("company_bio_id", bioId).gte("created_at", twoWeeksAgo)
    : supabase.from("leads").select("created_at, transferred_to_odoo_at").gte("created_at", twoWeeksAgo);
  if (filters.icpIds.length > 0) leadTrendQ = leadTrendQ.in("icp_profile_id", filters.icpIds);

  let transferTrendQ = bioId
    ? supabase.from("leads").select("transferred_to_odoo_at").eq("company_bio_id", bioId).gte("transferred_to_odoo_at", twoWeeksAgo)
    : supabase.from("leads").select("transferred_to_odoo_at").gte("transferred_to_odoo_at", twoWeeksAgo);
  if (filters.icpIds.length > 0) transferTrendQ = transferTrendQ.in("icp_profile_id", filters.icpIds);

  let replyTrendQ = bioId
    ? supabase.from("lead_replies").select("received_at, classification, leads!inner(company_bio_id, icp_profile_id), campaign_id").eq("leads.company_bio_id", bioId).gte("received_at", twoWeeksAgo)
    : supabase.from("lead_replies").select("received_at, classification, campaign_id").gte("received_at", twoWeeksAgo);
  if (filters.icpIds.length > 0) replyTrendQ = replyTrendQ.in("leads.icp_profile_id", filters.icpIds);
  if (campaignIdsForFilter) replyTrendQ = replyTrendQ.in("campaign_id", campaignIdsForFilter);

  const [
    { count: totalLeads },
    { data: activeCampaigns },
    { count: transferredCount },
    { data: pendingReviewReplies },
    { data: pendingCampReviews },
    { data: pendingProfiles },
    { data: weekAndRecentReplies },
    { data: leadTrend },
    { data: transferTrend },
    { data: replyTrend },
  ] = await Promise.all([
    leadsCountQ,
    activeCampsQ,
    transferredQ,
    pendingReviewRepliesQ,
    pendingCampReviewsQ,
    pendingProfilesQ,
    mergedRepliesQ,
    leadTrendQ,
    transferTrendQ,
    replyTrendQ,
  ]) as any;

  const weekReplies = (weekAndRecentReplies ?? []) as Array<{ classification: string | null }>;
  const recentReplies = (weekAndRecentReplies ?? []).slice(0, 8);

  // Pipeline stats
  const activeLeadIds = new Set((activeCampaigns ?? []).map((c: any) => c.lead_id).filter(Boolean));
  const weekPositive = (weekReplies ?? []).filter((r: any) => r.classification === "positive" || r.classification === "meeting_intent").length;

  // Campaign summary (group by name, top 5)
  const campGroups: Record<string, { name: string; firstId: string; channels: Set<string>; leads: number; active: number; totalSteps: number; progressSum: number; lastActivity: string | null }> = {};
  for (const c of activeCampaigns ?? []) {
    if (!campGroups[c.name]) campGroups[c.name] = { name: c.name, firstId: c.id, channels: new Set(), leads: 0, active: 0, totalSteps: 0, progressSum: 0, lastActivity: null };
    const g = campGroups[c.name];
    g.channels.add(c.channel);
    g.leads++;
    if (c.status === "active") g.active++;
    const ts = Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0;
    g.totalSteps = Math.max(g.totalSteps, ts);
    g.progressSum += ts > 0 ? (c.current_step ?? 0) / ts : 0;
    if (c.last_step_at && (!g.lastActivity || c.last_step_at > g.lastActivity)) g.lastActivity = c.last_step_at;
  }
  const topCampaigns = Object.values(campGroups)
    .map(g => ({ ...g, channels: [...g.channels], avgProgress: g.leads > 0 ? Math.round((g.progressSum / g.leads) * 100) : 0 }))
    .sort((a, b) => b.active - a.active)
    .slice(0, 5);

  // Pending calls count
  let pendingCallsCount = 0;
  for (const c of activeCampaigns ?? []) {
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    if (steps[c.current_step ?? 0]?.channel === "call") pendingCallsCount++;
  }

  // Alerts
  const alerts: { label: string; count: number; href: string; color: string }[] = [];
  if ((pendingReviewReplies as any) > 0) alerts.push({ label: "replies pending review", count: pendingReviewReplies as any, href: "/queue", color: "#D97706" });
  if (pendingCallsCount > 0) alerts.push({ label: "calls pending", count: pendingCallsCount, href: "/queue", color: "#F97316" });
  if ((pendingCampReviews as any) > 0) alerts.push({ label: "campaigns awaiting approval", count: pendingCampReviews as any, href: "/queue", color: C.blue });
  if ((pendingProfiles as any) > 0) alerts.push({ label: "profiles awaiting approval", count: pendingProfiles as any, href: "/queue", color: C.blue });

  // Recent replies formatted
  const formattedReplies = (recentReplies ?? []).map((r: any) => {
    const lead = r.leads;
    const leadName = lead ? `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown" : "Unknown";
    return {
      id: r.id,
      leadId: r.lead_id,
      leadName,
      company: lead?.company_name ?? null,
      classification: r.classification,
      channel: r.channel,
      replyText: r.reply_text,
      receivedAt: r.received_at,
      campaignName: (r.campaigns as any)?.name ?? null,
    };
  });

  // ── Compute deltas + sparklines from the 14d trend payloads ──
  // Day buckets: index 0 = 13d ago, ... index 13 = today. Current 7d = idx 7..13,
  // prior 7d = idx 0..6. Delta = (current - prior)/prior * 100; if prior is 0
  // and current > 0 we report null (undefined growth, no meaningful %).
  const dayStart = (offset: number) => new Date(now - offset * 86400000).setHours(0, 0, 0, 0);
  const dayIdx = (iso: string | null) => {
    if (!iso) return -1;
    const t = new Date(iso).getTime();
    for (let i = 0; i < 14; i++) {
      const start = dayStart(13 - i);
      const end = start + 86400000;
      if (t >= start && t < end) return i;
    }
    return -1;
  };
  const bucket = (rows: Array<{ at: string | null }>): number[] => {
    const b = Array(14).fill(0);
    for (const r of rows) {
      const i = dayIdx(r.at);
      if (i >= 0) b[i]++;
    }
    return b;
  };
  const split = (b: number[]) => ({
    prior: b.slice(0, 7).reduce((a, c) => a + c, 0),
    current: b.slice(7).reduce((a, c) => a + c, 0),
    spark: b.slice(7),
  });
  const pctDelta = (current: number, prior: number): number | null => {
    if (prior === 0) return current === 0 ? 0 : null;
    return ((current - prior) / prior) * 100;
  };

  const leadCreatedBuckets   = bucket((leadTrend     ?? []).map((r: any) => ({ at: r.created_at })));
  const transferBuckets      = bucket((transferTrend ?? []).map((r: any) => ({ at: r.transferred_to_odoo_at })));
  const replyBuckets         = bucket((replyTrend    ?? []).map((r: any) => ({ at: r.received_at })));
  const positiveReplyBuckets = bucket((replyTrend    ?? [])
    .filter((r: any) => r.classification === "positive" || r.classification === "meeting_intent")
    .map((r: any) => ({ at: r.received_at })));

  const leadsSplit     = split(leadCreatedBuckets);
  const transferSplit  = split(transferBuckets);
  const replySplit     = split(replyBuckets);
  const positiveSplit  = split(positiveReplyBuckets);

  // totalLeads delta = leads created this 7d vs prior 7d. leadsInCampaign is
  // a point-in-time snapshot (no historical), so we skip delta but show a
  // sparkline of new-leads-added per day as a proxy for pipeline momentum.
  const deltas = {
    totalLeads:        pctDelta(leadsSplit.current,    leadsSplit.prior),
    leadsInCampaign:   null,
    weekRepliesCount:  pctDelta(replySplit.current,    replySplit.prior),
    weekPositive:      pctDelta(positiveSplit.current, positiveSplit.prior),
    transferred:       pctDelta(transferSplit.current, transferSplit.prior),
  };
  const sparks = {
    totalLeads:        leadsSplit.spark,
    leadsInCampaign:   leadsSplit.spark, // proxy: new leads/day
    weekRepliesCount:  replySplit.spark,
    weekPositive:      positiveSplit.spark,
    transferred:       transferSplit.spark,
  };

  return {
    totalLeads: totalLeads ?? 0,
    leadsInCampaign: activeLeadIds.size,
    activeCampaignCount: (activeCampaigns ?? []).filter((c: any) => c.status === "active").length,
    weekRepliesCount: (weekReplies ?? []).length,
    weekPositive,
    transferred: transferredCount ?? 0,
    deltas,
    sparks,
    alerts,
    topCampaigns,
    recentReplies: formattedReplies,
  };
}

async function getFilterOptions(bioId: string | null) {
  // Distinct campaign names + active sellers + approved ICPs for the dropdowns.
  // Service role bypasses RLS so the listings are consistent regardless of the
  // caller's tier (Arqy user vs SWL super_admin); company_bio_id still gates
  // the rows we surface.
  const svc = getSupabaseService();
  const campsQ = bioId
    ? svc.from("campaigns").select("name, leads!inner(company_bio_id)").eq("leads.company_bio_id", bioId)
    : svc.from("campaigns").select("name");
  const sellersQ = bioId
    ? svc.from("sellers").select("id, name").or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`).eq("active", true).order("name")
    : svc.from("sellers").select("id, name").eq("active", true).order("name");
  const icpsQ = bioId
    ? svc.from("icp_profiles").select("id, profile_name").eq("company_bio_id", bioId).order("profile_name")
    : svc.from("icp_profiles").select("id, profile_name").order("profile_name");

  const [{ data: camps }, { data: sellers }, { data: icps }] = await Promise.all([campsQ, sellersQ, icpsQ]);
  const uniqueNames = Array.from(new Set((camps ?? []).map((c: { name: string }) => c.name).filter(Boolean))).sort();
  return {
    campaigns: uniqueNames.map(n => ({ id: n, label: n })),
    sellers: (sellers ?? []).map((s: { id: string; name: string }) => ({ id: s.id, label: s.name })),
    icps: (icps ?? []).map((p: { id: string; profile_name: string }) => ({ id: p.id, label: p.profile_name })),
  };
}

export default async function DashboardPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Force new clients through onboarding if they haven't completed company_bio yet.
  const scope = await getUserScope();
  // super_admin (SWL ops) doesn't need a tenant — they operate cross-tenant.
  // Every other tier (owner/manager/seller/viewer) needs a company_bio_id;
  // if missing, push through onboarding.
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) {
    redirect("/onboarding");
  }

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const bioId = scope.isScoped ? scope.companyBioId! : null;
  const [data, options] = await Promise.all([
    getDashboardData(filters),
    getFilterOptions(bioId),
  ]);

  return (
    <div className="p-4 sm:p-6 w-full">
      <ReliabilityBanner />
      <DashboardHero />

      <DashboardFilters campaigns={options.campaigns} sellers={options.sellers} icps={options.icps} />

      <DashboardTabs>
        {/* ═══ TAB 0: OVERVIEW ═══ */}
        <div>
          <DashboardStats
            data={{
              totalLeads: data.totalLeads,
              leadsInCampaign: data.leadsInCampaign,
              weekRepliesCount: data.weekRepliesCount,
              weekPositive: data.weekPositive,
              transferred: data.transferred,
            }}
            deltas={data.deltas}
            sparks={data.sparks}
          />

          {/* Alerts */}
          {data.alerts.length > 0 && <AlertsPanel alerts={data.alerts} />}

          {/* Two-thirds Active Campaigns (operational priority) + one-third
              Recent Replies (reactive). On narrow screens the grid collapses
              to a single column so the campaigns table always reads first. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            {/* Active Campaigns (2/3) */}
            <div className="lg:col-span-2">
            <CollapsibleCard
              title="Active Campaigns"
              description={`${data.activeCampaignCount} active across ${data.topCampaigns.length} campaigns`}
              storageKey="live.activeCampaigns"
              rightSlot={<Link href="/leads" className="text-[10px] font-semibold hover:underline" style={{ color: gold }}>View all</Link>}
            >
              {data.topCampaigns.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm" style={{ color: C.textDim }}>No active campaigns</p>
                </div>
              ) : (
                data.topCampaigns.map((camp, i) => (
                  <Link key={camp.name} href={`/campaigns/${camp.firstId}`}
                    className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-black/[0.015] group"
                    style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="text-xs font-semibold truncate group-hover:underline" style={{ color: C.textPrimary }}>{camp.name}</p>
                        {camp.channels.map(ch => {
                          const meta = channelMeta[ch] ?? channelMeta.email;
                          const Icon = meta.icon;
                          return <Icon key={ch} size={10} style={{ color: meta.color }} />;
                        })}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
                          <div className="h-1.5 rounded-full" style={{ width: `${camp.avgProgress}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }} />
                        </div>
                        <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.textMuted }}>{camp.avgProgress}%</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      <p className="text-xs font-bold tabular-nums" style={{ color: C.textPrimary }}>{camp.leads}</p>
                      <p className="text-[9px]" style={{ color: C.textMuted }}>leads</p>
                    </div>
                    <div className="text-right shrink-0 hidden md:block" style={{ minWidth: 70 }}>
                      <p className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>
                        {camp.lastActivity ? timeAgo(camp.lastActivity) : "—"}
                      </p>
                      <p className="text-[9px]" style={{ color: C.textDim }}>last activity</p>
                    </div>
                  </Link>
                ))
              )}
            </CollapsibleCard>
            </div>

            {/* Recent Replies (1/3 sidebar) */}
            <CollapsibleCard
              title="Recent Replies"
              description="Latest responses"
              storageKey="live.recentReplies"
              rightSlot={<Link href="/queue" className="text-[10px] font-semibold hover:underline" style={{ color: gold }}>Queue</Link>}
            >
              {data.recentReplies.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm" style={{ color: C.textDim }}>No replies yet</p>
                </div>
              ) : (
                data.recentReplies.map((r: any, i: number) => {
                  const cls = classColors[r.classification] ?? { color: C.textMuted, bg: C.surface, label: r.classification ?? "Reply" };
                  const chMeta = channelMeta[r.channel] ?? channelMeta.email;
                  const ChIcon = chMeta.icon;
                  return (
                    <Link key={r.id} href={`/leads/${r.leadId}`}
                      className="flex gap-3 px-5 py-3.5 transition-colors hover:bg-black/[0.015]"
                      style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                        style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                        {(r.leadName[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{r.leadName}</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: cls.bg, color: cls.color }}>
                            {cls.label}
                          </span>
                          <ChIcon size={9} style={{ color: chMeta.color }} />
                        </div>
                        {r.replyText ? (
                          <p className="text-[11px] line-clamp-1 leading-snug" style={{ color: C.textMuted }}>
                            &ldquo;{r.replyText}&rdquo;
                          </p>
                        ) : (
                          <p className="text-[10px] italic" style={{ color: C.textDim }}>No text</p>
                        )}
                      </div>
                      <span className="text-[10px] shrink-0 mt-1" style={{ color: C.textDim }}>{timeAgo(r.receivedAt)}</span>
                    </Link>
                  );
                })
              )}
            </CollapsibleCard>
          </div>
        </div>

        {/* ═══ TAB 1: REPORTS ═══ */}
        <ReportsPage searchParams={Promise.resolve(sp)} />
      </DashboardTabs>
    </div>
  );
}
