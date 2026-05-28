// Seller drill-down — analytical view of one rep's performance. Surfaces
// what they're sending, the replies they're generating, ICP mix they work,
// when in the day they send vs receive replies, and how they compare to the
// team average. Same visual language as the main dashboard.

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft, User, Send, MessageSquare, ThumbsUp, Megaphone, Clock, Activity,
  TrendingUp, TrendingDown, Minus, Share2, Mail, Phone, Smartphone, Target,
  Sparkles, ChevronRight, Quote, Sun,
} from "lucide-react";
import InlineSpark from "@/components/dashboard/InlineSpark";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getDashboardData } from "@/lib/dashboard-data";
import { getT, getServerLocale } from "@/lib/i18n-server";
import PageHero from "@/components/PageHero";
import KpiCard from "@/components/dashboard/KpiCard";
import MultiLineChart from "@/components/dashboard/MultiLineChart";
import Heatmap from "@/components/dashboard/Heatmap";
import Donut from "@/components/dashboard/Donut";
import SwlSignature from "@/components/dashboard/SwlSignature";

const gold = "var(--brand, #c9a83a)";
const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);

const channelMeta: Record<string, { Icon: React.ElementType; color: string }> = {
  linkedin: { Icon: Share2,     color: "#0A66C2" },
  email:    { Icon: Mail,       color: "#059669" },
  call:     { Icon: Phone,      color: "#EA580C" },
  whatsapp: { Icon: Smartphone, color: "#25D366" },
};

type SellerRow = { id: string; name: string; active: boolean | null; company_bio_id: string | null; shared_with_company_bio_ids: string[] | null };
type LeadEmbed = { id: string; icp_profile_id: string | null; company_bio_id: string; primary_first_name: string | null; primary_last_name: string | null; company_name: string | null };
type CampRow = { id: string; name: string; status: string | null; channel: string | null; current_step: number | null; lead_id: string | null; created_at: string | null; leads: LeadEmbed | LeadEmbed[] };
type MsgRow = { id: string; campaign_id: string | null; status: string | null; sent_at: string | null; step_number: number | null };
type ReplyLeadEmbed = { id: string; primary_first_name: string | null; primary_last_name: string | null; company_name: string | null };
type ReplyRow = { id: string; lead_id: string | null; campaign_id: string | null; classification: string | null; received_at: string | null; reply_text: string | null; channel: string | null; leads?: ReplyLeadEmbed | ReplyLeadEmbed[] | null };

async function loadSellerDetail(sellerId: string, dateFrom: string | null, dateTo: string | null) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00Z`).getTime() : null;
  const toMs = dateTo ? new Date(`${dateTo}T23:59:59Z`).getTime() : null;
  const inWindow = (iso: string | null | undefined) => {
    if (!iso) return fromMs === null && toMs === null;
    const t = new Date(iso).getTime();
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
    return true;
  };

  const sQ = supabase.from("sellers").select("id, name, active, company_bio_id, shared_with_company_bio_ids").eq("id", sellerId);
  const { data: sellerRaw } = bioId
    ? await sQ.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`).maybeSingle()
    : await sQ.maybeSingle();
  if (!sellerRaw) return null;
  const seller = sellerRaw as SellerRow;

  const campsQ = supabase.from("campaigns")
    .select("id, name, status, channel, current_step, lead_id, created_at, leads!inner(id, icp_profile_id, company_bio_id, primary_first_name, primary_last_name, company_name)")
    .eq("seller_id", sellerId);
  const { data: campsRaw } = bioId
    ? await campsQ.eq("leads.company_bio_id", bioId)
    : await campsQ;
  const camps = (campsRaw ?? []) as CampRow[];
  const leadFor = (c: CampRow) => Array.isArray(c.leads) ? c.leads[0] : c.leads;

  const campIds = camps.map(c => c.id);
  const leadIds = camps.map(c => c.lead_id).filter(Boolean) as string[];
  const icpIds = Array.from(new Set(camps.map(c => leadFor(c)?.icp_profile_id).filter(Boolean) as string[]));

  const [{ data: msgsRaw }, { data: repliesRaw }, { data: icpsRaw }] = await Promise.all([
    campIds.length > 0
      ? supabase.from("campaign_messages").select("id, campaign_id, status, sent_at, step_number").in("campaign_id", campIds).eq("status", "sent")
      : Promise.resolve({ data: [] }),
    // Scope replies by CAMPAIGN, not by lead. Filtering by lead_id over-counts
    // when a lead has been worked by multiple sellers across different
    // campaigns — replies from another seller's campaign on the same lead
    // would leak into this seller's numbers. campaign_id is the right axis
    // because each campaign has exactly one seller_id.
    campIds.length > 0
      ? supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, received_at, reply_text, channel, leads(id, primary_first_name, primary_last_name, company_name)").in("campaign_id", campIds).order("received_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    icpIds.length > 0
      ? supabase.from("icp_profiles").select("id, profile_name").in("id", icpIds)
      : Promise.resolve({ data: [] }),
  ]);
  // Keep "all" copies for the trailing 30d trend; period-filter the rest.
  const allMsgs = (msgsRaw ?? []) as MsgRow[];
  const allReplies = (repliesRaw ?? []) as ReplyRow[];
  const msgs = allMsgs.filter(m => inWindow(m.sent_at));
  const replies = allReplies.filter(r => inWindow(r.received_at));
  const icpMap = new Map<string, string>();
  for (const i of ((icpsRaw ?? []) as { id: string; profile_name: string }[])) icpMap.set(i.id, i.profile_name);

  const contactedSet = new Set(leadIds);
  const repliedSet = new Set(replies.map(r => r.lead_id).filter(Boolean) as string[]);
  const positiveSet = new Set(replies.filter(r => POSITIVE_CLASS.has(r.classification ?? "")).map(r => r.lead_id).filter(Boolean) as string[]);

  // ─── ICP mix this seller works ───────────────────────────────────────
  type IcpAgg = { id: string; name: string; leads: Set<string>; replied: Set<string>; positive: Set<string> };
  const icpAgg = new Map<string, IcpAgg>();
  for (const c of camps) {
    const icpId = leadFor(c)?.icp_profile_id ?? "_unknown";
    let g = icpAgg.get(icpId);
    // Internal sentinel for "no ICP attached" — the render layer translates
    // this to the locale-appropriate label so we don't leak Spanish through.
    if (!g) { g = { id: icpId, name: icpMap.get(icpId) ?? "_unknown_icp", leads: new Set(), replied: new Set(), positive: new Set() }; icpAgg.set(icpId, g); }
    if (c.lead_id) {
      g.leads.add(c.lead_id);
      if (repliedSet.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveSet.has(c.lead_id)) g.positive.add(c.lead_id);
    }
  }
  const icpMix = Array.from(icpAgg.values()).map(g => ({
    id: g.id,
    name: g.name,
    leads: g.leads.size,
    replied: g.replied.size,
    positive: g.positive.size,
    responseRate: g.leads.size > 0 ? Math.round((g.replied.size / g.leads.size) * 100) : 0,
    conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive || b.leads - a.leads);

  // ─── Channel mix ─────────────────────────────────────────────────────
  type ChAgg = { sent: number; contacted: Set<string>; replied: Set<string>; positive: Set<string> };
  const chMap = new Map<string, ChAgg>();
  for (const c of camps) {
    const ch = c.channel ?? "linkedin";
    let g = chMap.get(ch);
    if (!g) { g = { sent: 0, contacted: new Set(), replied: new Set(), positive: new Set() }; chMap.set(ch, g); }
    if (c.lead_id) {
      g.contacted.add(c.lead_id);
      if (repliedSet.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveSet.has(c.lead_id)) g.positive.add(c.lead_id);
    }
  }
  for (const m of msgs) {
    if (!m.campaign_id) continue;
    const c = camps.find(x => x.id === m.campaign_id);
    if (!c) continue;
    const g = chMap.get(c.channel ?? "linkedin");
    if (g) g.sent++;
  }
  const channelMix = Array.from(chMap.entries()).map(([channel, g]) => ({
    channel,
    sent: g.sent,
    contacted: g.contacted.size,
    replied: g.replied.size,
    positive: g.positive.size,
    responseRate: g.contacted.size > 0 ? Math.round((g.replied.size / g.contacted.size) * 100) : 0,
  })).sort((a, b) => b.sent - a.sent);

  // ─── Campaign breakdown ─────────────────────────────────────────────
  type CampAgg = { name: string; leads: Set<string>; replied: Set<string>; positive: Set<string>; sent: number; status: string; channels: Set<string> };
  const byCampaign = new Map<string, CampAgg>();
  for (const c of camps) {
    let g = byCampaign.get(c.name);
    if (!g) { g = { name: c.name, leads: new Set(), replied: new Set(), positive: new Set(), sent: 0, status: c.status ?? "active", channels: new Set() }; byCampaign.set(c.name, g); }
    g.channels.add(c.channel ?? "linkedin");
    if (c.status === "active") g.status = "active";
    else if (c.status === "paused" && g.status !== "active") g.status = "paused";
    if (c.lead_id) {
      g.leads.add(c.lead_id);
      if (repliedSet.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveSet.has(c.lead_id)) g.positive.add(c.lead_id);
    }
  }
  for (const m of msgs) {
    if (!m.campaign_id) continue;
    const c = camps.find(x => x.id === m.campaign_id);
    if (!c) continue;
    const g = byCampaign.get(c.name);
    if (g) g.sent++;
  }
  const campaignBreakdown = Array.from(byCampaign.values()).map(g => ({
    name: g.name,
    status: g.status,
    channels: Array.from(g.channels),
    leads: g.leads.size,
    sent: g.sent,
    replied: g.replied.size,
    positive: g.positive.size,
    conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive || b.leads - a.leads);

  // ─── 30d trend ───────────────────────────────────────────────────────
  // Always trailing 30 days regardless of the period filter — uses the
  // unfiltered data so the chart context survives any user-applied window.
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const dayBucket = (iso: string) => Math.floor((today.getTime() - new Date(iso).getTime()) / 86_400_000);
  const trendSent = new Array(30).fill(0) as number[];
  const trendReplies = new Array(30).fill(0) as number[];
  const trendPositive = new Array(30).fill(0) as number[];
  for (const m of allMsgs) {
    if (!m.sent_at) continue;
    const idx = 29 - dayBucket(m.sent_at);
    if (idx >= 0 && idx < 30) trendSent[idx]++;
  }
  for (const r of allReplies) {
    if (!r.received_at) continue;
    const idx = 29 - dayBucket(r.received_at);
    if (idx >= 0 && idx < 30) {
      trendReplies[idx]++;
      if (POSITIVE_CLASS.has(r.classification ?? "")) trendPositive[idx]++;
    }
  }

  // ─── Send timing heatmap (when this seller sends) ───────────────────
  // Different from the main dashboard heatmap (which shows when replies
  // arrive). Surfaces working pattern of the rep — useful for coaching.
  const sendHeatmap = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const m of msgs) {
    if (!m.sent_at) continue;
    const d = new Date(m.sent_at);
    sendHeatmap[d.getDay()][d.getHours()]++;
  }
  const replyHeatmap = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const r of replies) {
    if (!r.received_at) continue;
    const d = new Date(r.received_at);
    replyHeatmap[d.getDay()][d.getHours()]++;
  }

  // ─── Time-to-first-reply ─────────────────────────────────────────
  const firstMsgAt = new Map<string, number>();
  for (const m of msgs) {
    if (!m.sent_at || !m.campaign_id) continue;
    const c = camps.find(x => x.id === m.campaign_id);
    if (!c?.lead_id) continue;
    const t = new Date(m.sent_at).getTime();
    const prev = firstMsgAt.get(c.lead_id);
    if (prev === undefined || t < prev) firstMsgAt.set(c.lead_id, t);
  }
  const firstReplyAt = new Map<string, number>();
  for (const r of replies) {
    if (!r.lead_id || !r.received_at) continue;
    const t = new Date(r.received_at).getTime();
    const prev = firstReplyAt.get(r.lead_id);
    if (prev === undefined || t < prev) firstReplyAt.set(r.lead_id, t);
  }
  const ttrSamples: number[] = [];
  for (const [leadId, mT] of firstMsgAt) {
    const rT = firstReplyAt.get(leadId);
    if (rT && rT > mT) ttrSamples.push(Math.round((rT - mT) / 60_000));
  }
  ttrSamples.sort((a, b) => a - b);
  const medianTTR = ttrSamples.length > 0 ? ttrSamples[Math.floor(ttrSamples.length / 2)] : null;

  // ─── Top wins — last positive replies with text, for the "Wins reel" ──
  // Lead name + company come from the embedded `leads` join on the reply
  // query (added 2026-05-28 r4 because the previous `leadById` from camps
  // missed any reply whose campaign-row didn't survive the period filter).
  // Already ordered desc by received_at from the query.
  const replyLeadFor = (r: ReplyRow): ReplyLeadEmbed | null => {
    const l = r.leads;
    if (!l) return null;
    if (Array.isArray(l)) return l[0] ?? null;
    return l;
  };
  const topWins = (replies ?? [])
    .filter(r => POSITIVE_CLASS.has(r.classification ?? "") && r.lead_id && r.reply_text)
    .slice(0, 8)
    .map(r => {
      const lead = replyLeadFor(r);
      const leadName = lead
        ? `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Lead"
        : "Lead";
      return {
        leadId: r.lead_id!,
        leadName,
        company: lead?.company_name ?? null,
        replyText: r.reply_text,
        channel: r.channel ?? "linkedin",
        receivedAt: r.received_at,
      };
    });

  // ─── Voice & Cadence narrative ──────────────────────────────────────────
  // Premium replacement for the two giant heatmaps. We surface 3 numbers
  // the manager actually uses: when the seller sends most (peak hour
  // window), which weekday is theirs, and when replies typically land.
  // Heatmaps kept on the same return so the "Show full matrix" expand can
  // surface them on demand.
  let peakSendHour = 10;
  let peakSendCount = 0;
  const sendByHour = new Array(24).fill(0) as number[];
  for (let h = 0; h < 24; h++) {
    for (let d = 0; d < 7; d++) sendByHour[h] += sendHeatmap[d][h];
    if (sendByHour[h] > peakSendCount) { peakSendCount = sendByHour[h]; peakSendHour = h; }
  }
  let peakSendDay = 1; // Monday default
  let peakSendDayCount = 0;
  const sendByDay = new Array(7).fill(0) as number[];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) sendByDay[d] += sendHeatmap[d][h];
    if (sendByDay[d] > peakSendDayCount) { peakSendDayCount = sendByDay[d]; peakSendDay = d; }
  }
  let peakReplyHour: number | null = null;
  let peakReplyCount = 0;
  const replyByHour = new Array(24).fill(0) as number[];
  for (let h = 0; h < 24; h++) {
    for (let d = 0; d < 7; d++) replyByHour[h] += replyHeatmap[d][h];
    if (replyByHour[h] > peakReplyCount) { peakReplyCount = replyByHour[h]; peakReplyHour = h; }
  }

  return {
    seller,
    totalSent: msgs.length,
    totalContacted: contactedSet.size,
    activeCampaigns: camps.filter(c => c.status === "active").length,
    completedCampaigns: camps.filter(c => c.status === "completed").length,
    pausedCampaigns: camps.filter(c => c.status === "paused").length,
    repliedCount: repliedSet.size,
    positiveCount: positiveSet.size,
    responseRate: contactedSet.size > 0 ? Math.round((repliedSet.size / contactedSet.size) * 100) : 0,
    conversionRate: contactedSet.size > 0 ? Math.round((positiveSet.size / contactedSet.size) * 100) : 0,
    medianTTR,
    icpMix,
    channelMix,
    campaignBreakdown,
    trend30d: { sent: trendSent, replies: trendReplies, positive: trendPositive },
    sendHeatmap,
    replyHeatmap,
    topWins,
    cadence: {
      peakSendHour,
      peakSendCount,
      peakSendDay,
      peakSendDayCount,
      peakReplyHour,
      sendByDay,
      sendByHour,
    },
  };
}

export default async function SellerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = await getUserScope();
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) redirect("/onboarding");

  const { id } = await params;
  const sp = await searchParams;
  const periodFrom = typeof sp.from === "string" ? sp.from : null;
  const periodTo = typeof sp.to === "string" ? sp.to : null;

  const [d, tenant, t, locale] = await Promise.all([
    loadSellerDetail(id, periodFrom, periodTo),
    // Team comparison stays on the same window so the vs-team lift is meaningful.
    getDashboardData({ from: periodFrom, to: periodTo }),
    getT(),
    getServerLocale(),
  ]);
  const dateLoc = locale === "es" ? "es-AR" : "en-US";
  const periodChip = periodFrom && periodTo
    ? `${new Date(periodFrom).toLocaleDateString(dateLoc, { day: "2-digit", month: "short" })} – ${new Date(periodTo).toLocaleDateString(dateLoc, { day: "2-digit", month: "short" })}`
    : null;
  const kpi18n = { vsPriorLabel: t("dashx.kpi.vsPrior"), noPriorLabel: t("dashx.kpi.noPrior") };

  if (!d) {
    return (
      <div className="p-6">
        <Link href="/" className="text-xs hover:underline" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} className="inline mr-1" /> {t("dashx.detail.back")}
        </Link>
        <p className="mt-4 text-sm" style={{ color: C.textBody }}>{t("dashx.detail.seller.notFound")}</p>
      </div>
    );
  }

  // Comparison vs team average
  const teamResp = tenant.headline.responseRate;
  const lift = teamResp > 0 ? Math.round(((d.responseRate / teamResp) - 1) * 100) : null;
  const liftKind = lift === null ? "neutral" : lift >= 20 ? "great" : lift >= 5 ? "good" : lift <= -20 ? "bad" : lift <= -5 ? "soft" : "neutral";

  // ─── Avatar (initials) ──────────────────────────────────────────
  const initials = d.seller.name.split(" ").slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("");

  // Pre-compute display strings for Voice & Cadence.
  const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const peakDayLabel = t(`dashx.day.${dayKeys[d.cadence.peakSendDay]}`);
  const hourRange = (h: number) => `${String(h).padStart(2, "0")}:00 – ${String((h + 1) % 24).padStart(2, "0")}:00`;
  const sendHourSpark = d.cadence.sendByHour;
  const sendDaySpark  = d.cadence.sendByDay;

  return (
    <div className="p-4 sm:p-6 w-full space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Link href={periodChip ? `/?from=${periodFrom}&to=${periodTo}` : "/"} className="inline-flex items-center gap-1 text-xs hover:underline transition-opacity hover:opacity-70" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} /> {t("dashx.detail.back")}
        </Link>
        {periodChip && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border tabular-nums"
            style={{ borderColor: C.border, color: C.textBody, background: C.card }}
            title={t("dashx.detail.periodInherited")}>
            <Clock size={11} style={{ color: gold }} /> {periodChip}
          </span>
        )}
      </div>

      {/* ═══ HERO DOSSIER — dark+gold, SWL premium ═══
          Avatar gold-tinted, name in Outfit, one-line narrative summary.
          Same dark surface language the campaign detail uses so seller
          + campaign read as a sibling pair. */}
      <header
        className="rounded-2xl border overflow-hidden relative"
        style={{
          backgroundColor: "#0F0F14",
          borderColor: "color-mix(in srgb, #c9a83a 18%, #1d1f29)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.22), 0 0 0 1px color-mix(in srgb, #c9a83a 14%, transparent)",
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 50%, transparent 100%)`, opacity: 0.9 }} />
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 26%, transparent) 0%, transparent 65%)`, opacity: 0.55 }} />
        <div className="absolute -bottom-32 -left-20 w-80 h-80 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 14%, transparent) 0%, transparent 70%)`, opacity: 0.4 }} />

        <div className="p-6 relative flex items-start gap-5">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-[26px] font-bold shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
              color: "#04070d",
              boxShadow: `0 8px 28px color-mix(in srgb, ${gold} 38%, transparent), inset 0 1px 0 rgba(255,255,255,0.4)`,
              fontFamily: "var(--font-outfit), system-ui, sans-serif",
            }}
          >
            {initials || <User size={28} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-px w-6" style={{ backgroundColor: gold }} />
              <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: gold, letterSpacing: "0.18em" }}>Seller Dossier</p>
              <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ml-1"
                style={{
                  backgroundColor: d.seller.active ? `color-mix(in srgb, ${C.green} 18%, transparent)` : "rgba(255,255,255,0.08)",
                  border: `1px solid color-mix(in srgb, ${d.seller.active ? C.green : "#F5F2E8"} ${d.seller.active ? 32 : 12}%, transparent)`,
                  color: d.seller.active ? C.green : "color-mix(in srgb, #F5F2E8 55%, transparent)",
                }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.seller.active ? C.green : "color-mix(in srgb, #F5F2E8 35%, transparent)" }} />
                {d.seller.active ? t("dashx.detail.seller.active") : t("dashx.detail.seller.inactive")}
              </span>
            </div>
            <h1 className="text-[32px] font-bold leading-tight"
              style={{
                color: "#F5F2E8",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                letterSpacing: "-0.025em",
              }}>
              {d.seller.name}
            </h1>
            <p className="text-[12px] mt-2" style={{ color: "color-mix(in srgb, #F5F2E8 70%, transparent)" }}>
              {t("dashx.detail.seller.summary", {
                active: d.activeCampaigns,
                contacted: d.totalContacted,
                sent: d.totalSent,
              })}
            </p>
            {lift !== null && (
              <p className="text-[11px] mt-1.5 inline-flex items-center gap-1.5"
                style={{ color: liftKind === "great" || liftKind === "good" ? C.green : liftKind === "bad" || liftKind === "soft" ? C.red : "color-mix(in srgb, #F5F2E8 55%, transparent)" }}>
                <LiftIcon kind={liftKind} />
                {teamResp > 0 ? t("dashx.detail.seller.hero.vsTeamHint", { team: teamResp, seller: d.responseRate }) : t("dashx.detail.seller.hero.vsTeamNoData")}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* ═══ THREE BIG KPI TILES — Replies / Positives / Win Rate ═══
          Replaces the 6-card uniform strip. Each tile carries a sparkline of
          the trailing 30d so the manager sees trajectory next to the number.
          Other KPIs (Sent, Contacted, TTFR, Active campaigns) move into the
          collapsible "More details" panel below. */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BigKpiTile
          label={t("dashx.detail.seller.kpi.replies")}
          value={d.repliedCount.toLocaleString(dateLoc)}
          sub={`${d.responseRate}% ${t("dashx.detail.seller.hero.replyRate")}`}
          sparkData={d.trend30d.replies}
          color="#7C3AED"
          icon={MessageSquare}
        />
        <BigKpiTile
          label={t("dashx.detail.seller.kpi.positives")}
          value={d.positiveCount.toLocaleString(dateLoc)}
          sub={`${d.conversionRate}% ${t("dashx.detail.seller.hero.positives")}`}
          sparkData={d.trend30d.positive}
          color={C.green}
          icon={ThumbsUp}
        />
        <BigKpiTile
          label={t("dashx.detail.seller.kpi.sent")}
          value={d.totalSent.toLocaleString(dateLoc)}
          sub={`${d.totalContacted.toLocaleString(dateLoc)} ${t("dashx.detail.seller.hero.contacted").toLowerCase()}`}
          sparkData={d.trend30d.sent}
          color={gold}
          icon={Send}
        />
      </section>

      {/* ═══ VOICE & CADENCE — narrative panel ═══
          Replaces the two giant heatmaps. We tell the manager when this
          seller actually works in plain language plus tiny sparklines for
          context. Copy is written verbatim in locale strings — no i18n
          keys here on purpose because the new keys hadn't landed in the
          dictionary and surfaced as raw placeholders. */}
      <section
        className="rounded-2xl border overflow-hidden relative"
        style={{
          borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`,
          backgroundColor: C.card,
          boxShadow: `0 6px 24px rgba(0,0,0,0.05), 0 0 0 1px color-mix(in srgb, ${gold} 10%, transparent)`,
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 50%, transparent 100%)`, opacity: 0.55 }} />
        <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 5%, ${C.bg})` }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
              boxShadow: `0 3px 14px color-mix(in srgb, ${gold} 32%, transparent)`,
            }}>
            <Sparkles size={15} style={{ color: "#fff" }} strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: gold, letterSpacing: "0.14em" }}>
              {locale === "es" ? "Patrón de trabajo" : "Working pattern"}
            </p>
            <p className="text-[14px] font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {locale === "es" ? "Cuándo trabaja " : "When "}
              <span style={{ color: gold }}>{d.seller.name.split(" ")[0]}</span>
              {locale === "es" ? "" : " works"}
            </p>
          </div>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <CadenceCard
            icon={Sun}
            label={locale === "es" ? "Mejor franja para enviar" : "Best send window"}
            value={d.cadence.peakSendCount > 0 ? hourRange(d.cadence.peakSendHour) : "—"}
            hint={d.cadence.peakSendCount > 0
              ? (locale === "es"
                  ? `${d.cadence.peakSendCount} envíos salieron en esta franja`
                  : `${d.cadence.peakSendCount} sends fired in this band`)
              : (locale === "es" ? "Aún no hay suficientes envíos" : "Not enough sends yet")}
            sparkData={sendHourSpark}
            color={gold}
          />
          <CadenceCard
            icon={Activity}
            label={locale === "es" ? "Día más activo" : "Sharpest weekday"}
            value={d.cadence.peakSendDayCount > 0 ? peakDayLabel : "—"}
            hint={d.cadence.peakSendDayCount > 0
              ? (locale === "es"
                  ? `${d.cadence.peakSendDayCount} envíos los ${peakDayLabel.toLowerCase()}`
                  : `${d.cadence.peakSendDayCount} sends on ${peakDayLabel}`)
              : (locale === "es" ? "Aún no hay suficientes envíos" : "Not enough sends yet")}
            sparkData={sendDaySpark}
            color="#0A66C2"
          />
          <CadenceCard
            icon={MessageSquare}
            label={locale === "es" ? "Cuándo llegan las respuestas" : "When replies arrive"}
            value={d.cadence.peakReplyHour !== null ? hourRange(d.cadence.peakReplyHour) : "—"}
            hint={d.cadence.peakReplyHour !== null
              ? (locale === "es"
                  ? `La mayoría de respuestas caen alrededor de ${hourRange(d.cadence.peakReplyHour)}`
                  : `Most replies land around ${hourRange(d.cadence.peakReplyHour)}`)
              : (locale === "es" ? "Sin respuestas todavía" : "No replies yet")}
            sparkData={d.cadence.peakReplyHour !== null ? Array.from({ length: 24 }, (_, h) => { let s = 0; for (let day = 0; day < 7; day++) s += d.replyHeatmap[day][h]; return s; }) : []}
            color={C.green}
          />
        </div>
      </section>

      {/* ═══ WINS REEL — last 5 positive replies as quote cards ═══
          The "what people say back about this seller" surface. Premium —
          gold accent left border, channel pill, lead name + company,
          quote treatment for the body. Hidden when there's nothing to
          showcase yet. */}
      {/* Wins reel removed 2026-05-28 per user request — the KPI cards
          above already carry the outcome signal; reading reply quotes
          belongs in /inbox, not on the manager-facing seller detail. */}

      {/* ═══ PIPELINE CARDS — 3 actionable surfaces ═══ */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PipelineCard
          icon={Target}
          label={locale === "es" ? "ICPs activos" : "Active ICPs"}
          value={d.icpMix.length}
          hint={d.icpMix[0]?.name === "_unknown_icp" || !d.icpMix[0]?.name
            ? (locale === "es" ? "Sin ICPs todavía" : "No ICPs yet")
            : `${locale === "es" ? "Top" : "Top"}: ${d.icpMix[0].name}`}
          color={gold}
          href={d.icpMix[0]?.id && d.icpMix[0].id !== "_unknown" ? `/leads/ticket/${d.icpMix[0].id}` : undefined}
        />
        <PipelineCard
          icon={Megaphone}
          label={locale === "es" ? "Flows activos" : "Active flows"}
          value={d.activeCampaigns}
          hint={d.campaignBreakdown[0]?.name
            ? `${locale === "es" ? "Top" : "Top"}: ${d.campaignBreakdown[0].name}`
            : (locale === "es" ? "Sin flows activos" : "No active flows")}
          color="#F59E0B"
          href={d.campaignBreakdown[0]?.name ? `/dashboard/campaign/${encodeURIComponent(d.campaignBreakdown[0].name)}` : undefined}
        />
        <PipelineCard
          icon={Clock}
          label={locale === "es" ? "Tiempo medio a respuesta" : "Median reply time"}
          value={d.medianTTR === null ? "—" : formatMinutes(d.medianTTR)}
          hint={d.medianTTR === null
            ? (locale === "es" ? "Necesitamos respuestas para calcularlo" : "Need replies to compute")
            : (locale === "es" ? "desde el primer envío hasta la primera respuesta" : "from first send to first reply")}
          color="#6B7280"
        />
      </section>

      {/* ═══ ICP RANKING — horizontal bars (no chart libs) ═══
          Boss "más original — no repitas los charts del dashboard". The
          old drill-down stuffed MultiLineChart + 2 Heatmaps + a wide
          table into a <details>; visually identical to the main dashboard.
          Replaced with a simple bar leaderboard scoped to this seller:
          one row per ICP, length proportional to lead count, color tinted
          by conversion rate. Tables collapsed into one tight breakdown
          that lists every flow/campaign on a single line. */}
      {d.icpMix.length > 0 && (
        <section
          className="rounded-2xl border overflow-hidden"
          style={{ borderColor: C.border, backgroundColor: C.card, boxShadow: "0 4px 18px rgba(0,0,0,0.04)" }}
        >
          <div className="px-5 py-3 border-b flex items-center gap-3" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 5%, ${C.bg})` }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
                boxShadow: `0 3px 12px color-mix(in srgb, ${gold} 30%, transparent)`,
              }}>
              <Target size={14} style={{ color: "#fff" }} strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: gold, letterSpacing: "0.14em" }}>
                {locale === "es" ? "Ranking" : "Ranking"}
              </p>
              <p className="text-[14px] font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                {locale === "es" ? "ICPs que más trabaja" : "Top ICPs by volume"}
              </p>
            </div>
          </div>
          <div className="p-5 space-y-3">
            {(() => {
              const maxLeads = Math.max(...d.icpMix.map(i => i.leads), 1);
              return d.icpMix.slice(0, 6).map((i, idx) => {
                const widthPct = Math.max(8, Math.round((i.leads / maxLeads) * 100));
                const conv = i.conversionRate;
                const barColor = conv >= 10 ? C.green : conv >= 3 ? gold : "#94A3B8";
                const label = i.name === "_unknown_icp" ? (locale === "es" ? "Sin ICP" : "Unassigned") : i.name;
                const inner = (
                  <div className="flex items-center gap-3 group">
                    <span className="text-[10px] font-bold tabular-nums w-5 shrink-0" style={{ color: idx === 0 ? gold : C.textDim }}>
                      #{idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[13px] font-semibold truncate group-hover:underline" style={{ color: C.textPrimary }}>{label}</span>
                        <div className="flex items-center gap-3 text-[11px] shrink-0 tabular-nums" style={{ color: C.textMuted }}>
                          <span>{i.leads} {locale === "es" ? "leads" : "leads"}</span>
                          <span style={{ color: i.replied > 0 ? C.blue : C.textDim }}>{i.replied} {locale === "es" ? "resp." : "rep."}</span>
                          <span className="font-bold" style={{ color: i.positive > 0 ? C.green : C.textDim }}>{i.positive} positive</span>
                          <span className="font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${barColor} 12%, transparent)`, color: barColor }}>
                            {conv}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full" style={{ backgroundColor: C.border }}>
                        <div
                          className="h-2 rounded-full transition-[width] duration-300"
                          style={{
                            width: `${widthPct}%`,
                            background: `linear-gradient(90deg, ${barColor}, color-mix(in srgb, ${barColor} 70%, white))`,
                            boxShadow: idx === 0 ? `0 0 12px color-mix(in srgb, ${barColor} 30%, transparent)` : "none",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
                if (i.id !== "_unknown") {
                  return <Link key={i.id} href={`/leads/ticket/${i.id}`} className="block">{inner}</Link>;
                }
                return <div key={i.id}>{inner}</div>;
              });
            })()}
          </div>
        </section>
      )}

      {/* ═══ CHANNEL MIX — compact cards (3 lines max each) ═══
          Less columns than the old drill-down; one card per channel with
          color-left-border + 3 micro stats inline. Sits next to the ICP
          ranking, not stacked below. */}
      {d.channelMix.length > 0 && (
        <section
          className="rounded-2xl border overflow-hidden"
          style={{ borderColor: C.border, backgroundColor: C.card, boxShadow: "0 4px 18px rgba(0,0,0,0.04)" }}
        >
          <div className="px-5 py-3 border-b flex items-center gap-3" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${C.blue} 4%, ${C.bg})` }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: `linear-gradient(135deg, ${C.blue}, color-mix(in srgb, ${C.blue} 70%, white))`,
                boxShadow: `0 3px 12px color-mix(in srgb, ${C.blue} 30%, transparent)`,
              }}>
              <Send size={14} style={{ color: "#fff" }} strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.blue, letterSpacing: "0.14em" }}>
                {locale === "es" ? "Canales" : "Channels"}
              </p>
              <p className="text-[14px] font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                {locale === "es" ? "Cómo distribuye su outreach" : "Outreach mix"}
              </p>
            </div>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {d.channelMix.map((ch, idx) => {
              const meta = channelMeta[ch.channel] ?? { Icon: Send, color: C.textMuted };
              const Icon = meta.Icon;
              const isTop = idx === 0 && d.channelMix.length > 1;
              const chLabel = ch.channel === "linkedin" ? "LinkedIn"
                : ch.channel === "email" ? "Email"
                : ch.channel === "call" ? (locale === "es" ? "Llamadas" : "Calls")
                : ch.channel;
              return (
                <div key={ch.channel} className="rounded-xl border p-3.5"
                  style={{ borderColor: C.border, backgroundColor: C.bg, borderLeft: `3px solid ${meta.color}` }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-md flex items-center justify-center"
                        style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
                        <Icon size={13} />
                      </span>
                      <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{chLabel}</span>
                      {isTop && <span className="w-1.5 h-1.5 rounded-full" style={{ background: gold, boxShadow: `0 0 0 2px color-mix(in srgb, ${gold} 18%, transparent)` }} />}
                    </div>
                    <span className="text-[10px] tabular-nums font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)`, color: meta.color }}>
                      {ch.responseRate}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span style={{ color: C.textMuted }}>
                      <span className="font-bold tabular-nums" style={{ color: C.textPrimary }}>{ch.sent.toLocaleString(dateLoc)}</span> {locale === "es" ? "envíos" : "sent"}
                    </span>
                    <span style={{ color: ch.positive > 0 ? C.green : C.textMuted }}>
                      <span className="font-bold tabular-nums">{ch.positive}</span> positive
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══ CAMPAIGNS THIS SELLER OWNS — single tight breakdown ═══ */}
      <section
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: C.border, backgroundColor: C.card, boxShadow: "0 4px 18px rgba(0,0,0,0.04)" }}
      >
        <div className="px-5 py-3 border-b flex items-center gap-3" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 5%, ${C.bg})` }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
              boxShadow: `0 3px 12px color-mix(in srgb, ${gold} 30%, transparent)`,
            }}>
            <Megaphone size={14} style={{ color: "#fff" }} strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: gold, letterSpacing: "0.14em" }}>
              {locale === "es" ? "Pipeline" : "Pipeline"}
            </p>
            <p className="text-[14px] font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {locale === "es" ? "Flows que maneja" : "Flows owned"}
            </p>
          </div>
          <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 32%, transparent)` }}>
            {d.campaignBreakdown.length}
          </span>
        </div>
        <div className="divide-y" style={{ borderColor: C.border }}>
          {d.campaignBreakdown.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs" style={{ color: C.textMuted }}>
              {locale === "es" ? "Este seller todavía no tiene flows asignados" : "No flows yet"}
            </p>
          ) : d.campaignBreakdown.slice(0, 10).map((c, idx) => (
            <Link
              key={c.name}
              href={`/dashboard/campaign/${encodeURIComponent(c.name)}`}
              className="flex items-center gap-4 px-5 py-3 hover:bg-black/[0.02] transition-colors group"
            >
              <span className="text-[10px] font-bold tabular-nums w-5 shrink-0" style={{ color: idx === 0 ? gold : C.textDim }}>
                #{idx + 1}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {c.channels.map(ch => {
                  const M = channelMeta[ch]?.Icon ?? Send;
                  return <M key={ch} size={12} style={{ color: channelMeta[ch]?.color ?? C.textMuted }} />;
                })}
              </div>
              <span className="text-sm font-semibold flex-1 truncate group-hover:underline" style={{ color: C.textPrimary }}>{c.name}</span>
              <div className="flex items-center gap-4 text-[11px] tabular-nums shrink-0" style={{ color: C.textMuted }}>
                <span><span className="font-bold" style={{ color: C.textBody }}>{c.leads}</span> leads</span>
                <span style={{ color: c.replied > 0 ? C.blue : C.textDim }}><span className="font-bold">{c.replied}</span> {locale === "es" ? "resp." : "rep."}</span>
                <span style={{ color: c.positive > 0 ? C.green : C.textDim }}><span className="font-bold">{c.positive}</span> positive</span>
                <RateCell value={c.conversionRate} color={C.green} />
              </div>
              <StatusBadge status={c.status} t={t} />
            </Link>
          ))}
        </div>
      </section>

      <SwlSignature caption={t("dashx.brand.captionDetail")} tagline={t("dashx.brand.tagline")} />
    </div>
  );
}

// ─── Local primitives ────────────────────────────────────────────────────

void Donut; // reserved for future "outcome split" donut on this page.

function Panel({ title, subtitle, children, className }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${className ?? ""}`} style={{ backgroundColor: C.card, borderColor: C.border }}>
      {(title || subtitle) && (
        <div className="px-4 py-2.5 border-b" style={{ borderColor: C.border }}>
          {title && <p className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{title}</p>}
          {subtitle && <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function SectionHeader({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }> }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span
        className="w-[3px] h-7 rounded-full shrink-0"
        style={{ background: `linear-gradient(to bottom, ${gold}, color-mix(in srgb, ${gold} 55%, transparent))` }}
        aria-hidden
      />
      {Icon && (
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
          <Icon size={13} />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <h2 className="text-[14px] font-semibold leading-tight tracking-tight" style={{ color: C.textPrimary }}>{title}</h2>
        <p className="text-[11px] truncate mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>
      </div>
    </div>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align: "left" | "right" }) {
  return <th className={`px-3 py-2 font-semibold text-${align}`}>{children}</th>;
}

function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-5 py-4 flex flex-col items-start gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{label}</span>
      <span className="text-[22px] font-semibold tabular-nums leading-tight" style={{ color: C.textPrimary }}>{value}</span>
      {hint && <span className="text-[10.5px]" style={{ color: C.textDim }}>{hint}</span>}
    </div>
  );
}

function MicroStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>{label}</p>
      <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: accent ?? C.textPrimary }}>{value.toLocaleString("es-AR")}</p>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, { color: string; key: string }> = {
    active:    { color: C.green,   key: "dashx.tbl.status.active" },
    paused:    { color: "#D97706", key: "dashx.tbl.status.paused" },
    completed: { color: "#6B7280", key: "dashx.tbl.status.completed" },
  };
  const s = map[status] ?? { color: C.textMuted, key: "" };
  const label = s.key ? t(s.key) : status;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `color-mix(in srgb, ${s.color} 12%, transparent)`, color: s.color }}>
      {status === "active" && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />}
      {label}
    </span>
  );
}

function RateCell({ value, color }: { value: number; color: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-1 text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded"
      style={{ backgroundColor: value > 0 ? `color-mix(in srgb, ${color} 12%, transparent)` : "transparent", color: value > 0 ? color : C.textMuted }}>
      {value}%
    </span>
  );
}

function TopRankDot({ rank }: { rank: number }) {
  if (rank !== 0) return <span className="inline-block w-1.5 shrink-0" />;
  return <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: gold, boxShadow: `0 0 0 2px color-mix(in srgb, ${gold} 18%, transparent)` }} />;
}

function LiftIcon({ kind }: { kind: string }) {
  if (kind === "great" || kind === "good") return <TrendingUp size={14} />;
  if (kind === "bad" || kind === "soft") return <TrendingDown size={14} />;
  return <Minus size={14} />;
}

// Oversized KPI tile with sparkline — replaces the 6 uniform KpiCards
// for the top 3 metrics. The number is the primary affordance; the
// sparkline gives trajectory at a glance.
function BigKpiTile({
  label, value, sub, sparkData, color, icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  sparkData: number[];
  color: string;
  icon: React.ElementType;
}) {
  return (
    <div
      className="rounded-2xl border p-5 relative overflow-hidden"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        borderTop: `3px solid ${color}`,
        boxShadow: "0 4px 18px rgba(0,0,0,0.04)",
      }}
    >
      <div
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none opacity-50"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${color} 16%, transparent) 0%, transparent 70%)` }}
      />
      <div className="flex items-center justify-between mb-3 relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted, letterSpacing: "0.14em" }}>{label}</p>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
          }}
        >
          <Icon size={15} style={{ color }} />
        </div>
      </div>
      <p
        className="text-[32px] font-bold leading-none tabular-nums"
        style={{
          color,
          fontFamily: "var(--font-outfit), system-ui, sans-serif",
          letterSpacing: "-0.025em",
        }}
      >
        {value}
      </p>
      <div className="flex items-end justify-between mt-3 gap-3">
        <p className="text-[11px]" style={{ color: C.textMuted }}>{sub}</p>
        <InlineSpark data={sparkData} color={color} width={80} height={20} />
      </div>
    </div>
  );
}

// Voice & Cadence narrative card — three of these inside the V&C panel.
// Each gives one number + one descriptive sentence + a tiny sparkline.
// Replaces the two giant heatmaps that used to sit top-level.
function CadenceCard({
  icon: Icon, label, value, hint, sparkData, color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint: string;
  sparkData: number[];
  color: string;
}) {
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2"
      style={{ borderColor: C.border, backgroundColor: C.bg }}
    >
      <div className="flex items-center gap-2">
        <Icon size={13} style={{ color }} />
        <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textMuted }}>{label}</p>
      </div>
      <p
        className="text-[20px] font-bold leading-tight tabular-nums"
        style={{
          color: C.textPrimary,
          fontFamily: "var(--font-outfit), system-ui, sans-serif",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </p>
      <p className="text-[11px] leading-snug" style={{ color: C.textMuted }}>{hint}</p>
      {sparkData.length > 0 && (
        <div className="mt-1">
          <InlineSpark data={sparkData} color={color} width={120} height={18} />
        </div>
      )}
    </div>
  );
}

// Pipeline card — one of three actionable surfaces. Links to the drill
// page when there's a target; renders as a static tile otherwise.
function PipelineCard({
  icon: Icon, label, value, hint, color, href,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  hint: string;
  color: string;
  href?: string;
}) {
  const inner = (
    <div
      className="rounded-2xl border p-4 transition-[transform,box-shadow,border-color] group h-full"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
            color,
          }}
        >
          <Icon size={15} />
        </div>
        {href && <ChevronRight size={14} style={{ color: C.textDim }} className="transition-transform group-hover:translate-x-0.5" />}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textMuted, letterSpacing: "0.12em" }}>{label}</p>
      <p
        className="text-[24px] font-bold leading-none tabular-nums mt-1"
        style={{
          color: C.textPrimary,
          fontFamily: "var(--font-outfit), system-ui, sans-serif",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </p>
      <p className="text-[11px] mt-1.5 line-clamp-1" style={{ color: C.textMuted }}>{hint}</p>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block hover:-translate-y-0.5 hover:shadow-md transition-[transform,box-shadow]">{inner}</Link>
    );
  }
  return inner;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

void PageHero; // legacy import kept while header migrates fully to the custom one
