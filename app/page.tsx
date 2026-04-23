import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";
import { redirect } from "next/navigation";
import { C } from "@/lib/design";
import {
  Users, MessageSquare, Share2, Mail, Phone, TrendingUp,
  Megaphone, AlertTriangle, CheckCircle, LayoutDashboard,
} from "lucide-react";
import PageHero from "@/components/PageHero";
import Link from "next/link";
import DashboardTabs from "@/components/DashboardTabs";
import ReportsPage from "@/app/reports/page";

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

async function getDashboardData() {
  const supabase = await getSupabaseServer();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  // Leads scope: direct eq on company_bio_id
  const leadsCountQ = bioId
    ? supabase.from("leads").select("*", { count: "exact", head: true }).eq("company_bio_id", bioId)
    : supabase.from("leads").select("*", { count: "exact", head: true });

  const activeCampsQ = bioId
    ? supabase.from("campaigns").select("id, name, status, channel, current_step, sequence_steps, lead_id, last_step_at, leads!inner(company_bio_id)").eq("leads.company_bio_id", bioId).in("status", ["active", "paused"])
    : supabase.from("campaigns").select("id, name, status, channel, current_step, sequence_steps, lead_id, last_step_at").in("status", ["active", "paused"]);

  const weekRepliesQ = bioId
    ? supabase.from("lead_replies").select("id, classification, leads!inner(company_bio_id)").eq("leads.company_bio_id", bioId).gte("received_at", weekAgo)
    : supabase.from("lead_replies").select("id, classification").gte("received_at", weekAgo);

  const transferredQ = bioId
    ? supabase.from("leads").select("*", { count: "exact", head: true }).eq("company_bio_id", bioId).not("transferred_to_odoo_at", "is", null)
    : supabase.from("leads").select("*", { count: "exact", head: true }).not("transferred_to_odoo_at", "is", null);

  const pendingReviewRepliesQ = bioId
    ? supabase.from("lead_replies").select("*, leads!inner(company_bio_id)", { count: "exact", head: true }).eq("leads.company_bio_id", bioId).eq("requires_human_review", true).eq("review_status", "pending")
    : supabase.from("lead_replies").select("*", { count: "exact", head: true }).eq("requires_human_review", true).eq("review_status", "pending");

  const pendingProfilesQ = bioId
    ? supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("company_bio_id", bioId).eq("status", "pending")
    : supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("status", "pending");

  // Campaign requests: filter via icp_profile_id if scoped
  let pendingCampReviewsQ;
  if (bioId) {
    const { data: profs } = await supabase.from("icp_profiles").select("id").eq("company_bio_id", bioId);
    const profIds = (profs ?? []).map(p => p.id);
    pendingCampReviewsQ = profIds.length > 0
      ? supabase.from("campaign_requests").select("*", { count: "exact", head: true }).eq("status", "pending_review").in("icp_profile_id", profIds)
      : Promise.resolve({ count: 0 } as any);
  } else {
    pendingCampReviewsQ = supabase.from("campaign_requests").select("*", { count: "exact", head: true }).eq("status", "pending_review");
  }

  const recentRepliesQ = bioId
    ? supabase.from("lead_replies")
        .select("id, lead_id, classification, channel, reply_text, received_at, leads!inner(primary_first_name, primary_last_name, company_name, company_bio_id), campaigns(name)")
        .eq("leads.company_bio_id", bioId)
        .order("received_at", { ascending: false }).limit(8)
    : supabase.from("lead_replies")
        .select("id, lead_id, classification, channel, reply_text, received_at, leads(primary_first_name, primary_last_name, company_name), campaigns(name)")
        .order("received_at", { ascending: false }).limit(8);

  const [
    { count: totalLeads },
    { data: activeCampaigns },
    { data: weekReplies },
    { count: transferredCount },
    { data: pendingReviewReplies },
    { data: pendingCampReviews },
    { data: pendingProfiles },
    { data: recentReplies },
  ] = await Promise.all([
    leadsCountQ,
    activeCampsQ,
    weekRepliesQ,
    transferredQ,
    pendingReviewRepliesQ,
    pendingCampReviewsQ,
    pendingProfilesQ,
    recentRepliesQ,
  ]) as any;

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

  return {
    totalLeads: totalLeads ?? 0,
    leadsInCampaign: activeLeadIds.size,
    activeCampaignCount: (activeCampaigns ?? []).filter((c: any) => c.status === "active").length,
    weekRepliesCount: (weekReplies ?? []).length,
    weekPositive,
    transferred: transferredCount ?? 0,
    alerts,
    topCampaigns,
    recentReplies: formattedReplies,
  };
}

export default async function DashboardPage() {
  // Force new clients through onboarding if they haven't completed company_bio yet.
  const scope = await getUserScope();
  if (scope.userId && scope.role !== "admin" && !scope.companyBioId) {
    redirect("/onboarding");
  }

  const data = await getDashboardData();

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={LayoutDashboard}
        section="Main"
        title="Dashboard"
        description="Pipeline overview — active campaigns, replies, and key performance metrics."
        accentColor={gold}
        status={{ label: "Live", active: true }}
      />

      <DashboardTabs>
        {/* ═══ TAB 0: OVERVIEW ═══ */}
        <div>
          {/* Pipeline Snapshot */}
          <div className="grid grid-cols-5 gap-4 mb-6">
            {[
              { label: "Total Leads", value: data.totalLeads, color: C.textBody, icon: Users },
              { label: "In Active Campaign", value: data.leadsInCampaign, color: gold, icon: Megaphone },
              { label: "Replies This Week", value: data.weekRepliesCount, color: C.blue, icon: MessageSquare },
              { label: "Positive This Week", value: data.weekPositive, color: C.green, icon: TrendingUp },
              { label: "Transferred to CRM", value: data.transferred, color: C.accent, icon: CheckCircle },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="rounded-xl border p-4 card-lift" style={{ background: `linear-gradient(135deg, var(--c-card) 0%, ${color}09 100%)`, borderColor: C.border, borderTop: `2px solid ${color}` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
                  <div className="rounded-lg p-1.5" style={{ backgroundColor: `${color}15` }}>
                    <Icon size={13} style={{ color }} />
                  </div>
                </div>
                <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Alerts */}
          {data.alerts.length > 0 && (
            <div className="rounded-xl border px-5 py-4 mb-6 flex items-center gap-4 flex-wrap"
              style={{ backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }}>
              <div className="flex items-center gap-2 shrink-0">
                <AlertTriangle size={16} style={{ color: "#D97706" }} />
                <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>Needs Attention</span>
              </div>
              {data.alerts.map((a, i) => (
                <Link key={i} href={a.href}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors hover:bg-orange-50"
                  style={{ borderColor: "#FBBF24", color: "#B45309", backgroundColor: "#FFFDF5" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: a.color }} />
                  {a.count} {a.label}
                </Link>
              ))}
            </div>
          )}

          {/* Two columns: Active Campaigns + Recent Replies */}
          <div className="grid grid-cols-2 gap-6">
            {/* Active Campaigns */}
            <div className="rounded-xl border overflow-hidden card-shadow" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
                <div>
                  <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Active Campaigns</h2>
                  <p className="text-[10px] mt-0.5" style={{ color: C.textMuted }}>{data.activeCampaignCount} active across {data.topCampaigns.length} campaigns</p>
                </div>
                <Link href="/leads" className="text-[10px] font-semibold hover:underline" style={{ color: gold }}>View all</Link>
              </div>
              {data.topCampaigns.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm" style={{ color: C.textDim }}>No active campaigns</p>
                </div>
              ) : (
                data.topCampaigns.map((camp, i) => (
                  <Link key={camp.name} href={`/campaigns/${camp.firstId}`}
                    className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-black/[0.015] group"
                    style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-semibold truncate group-hover:underline" style={{ color: C.textPrimary }}>{camp.name}</p>
                        {camp.channels.map(ch => {
                          const meta = channelMeta[ch] ?? channelMeta.email;
                          const Icon = meta.icon;
                          return <Icon key={ch} size={10} style={{ color: meta.color }} />;
                        })}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                          <div className="h-1.5 rounded-full" style={{ width: `${camp.avgProgress}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }} />
                        </div>
                        <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.textMuted }}>{camp.avgProgress}%</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold tabular-nums" style={{ color: C.textPrimary }}>{camp.leads}</p>
                      <p className="text-[9px]" style={{ color: C.textMuted }}>leads</p>
                    </div>
                  </Link>
                ))
              )}
            </div>

            {/* Recent Replies */}
            <div className="rounded-xl border overflow-hidden card-shadow" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
                <div>
                  <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Recent Replies</h2>
                  <p className="text-[10px] mt-0.5" style={{ color: C.textMuted }}>Latest responses from leads</p>
                </div>
                <Link href="/queue" className="text-[10px] font-semibold hover:underline" style={{ color: gold }}>View queue</Link>
              </div>
              {data.recentReplies.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm" style={{ color: C.textDim }}>No replies yet</p>
                </div>
              ) : (
                data.recentReplies.map((r: any, i: number) => {
                  const cls = classColors[r.classification] ?? { color: C.textMuted, bg: "#F3F4F6", label: r.classification ?? "Reply" };
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
            </div>
          </div>
        </div>

        {/* ═══ TAB 1: REPORTS ═══ */}
        <ReportsPage />
      </DashboardTabs>
    </div>
  );
}
