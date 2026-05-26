// Campaign drill-down — deep analytical view of one campaign name (the wizard
// groups campaigns by name across leads). Surfaces the sequence timeline,
// per-step performance, reply classification + timing, sellers running the
// campaign, and the lead-level engagement state.

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft, Megaphone, Send, MessageSquare, ThumbsUp, Users, Share2, Mail,
  Phone, Smartphone, Trophy, Calendar, Clock, Activity, AlertTriangle,
} from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getT, getServerLocale } from "@/lib/i18n-server";
import PageHero from "@/components/PageHero";
import KpiCard from "@/components/dashboard/KpiCard";
import MultiLineChart from "@/components/dashboard/MultiLineChart";
import Donut from "@/components/dashboard/Donut";
import Heatmap from "@/components/dashboard/Heatmap";
import StepPerformance from "@/components/dashboard/StepPerformance";

const gold = "var(--brand, #c9a83a)";
const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);
const NEGATIVE_CLASS = new Set(["negative", "not_now", "unsubscribe"]);

const channelMeta: Record<string, { Icon: React.ElementType; color: string }> = {
  linkedin: { Icon: Share2,     color: "#0A66C2" },
  email:    { Icon: Mail,       color: "#059669" },
  call:     { Icon: Phone,      color: "#EA580C" },
  whatsapp: { Icon: Smartphone, color: "#25D366" },
};

type CampRow = {
  id: string;
  name: string;
  status: string | null;
  channel: string | null;
  current_step: number | null;
  sequence_steps: unknown;
  lead_id: string | null;
  seller_id: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  stop_reason: string | null;
  paused_until: string | null;
  leads: { id: string; primary_first_name: string | null; primary_last_name: string | null; primary_title: string | null; company_name: string | null; status: string | null; icp_profile_id: string | null; company_bio_id: string } | { id: string; primary_first_name: string | null; primary_last_name: string | null; primary_title: string | null; company_name: string | null; status: string | null; icp_profile_id: string | null; company_bio_id: string }[];
};
type ReplyRow = { id: string; lead_id: string | null; campaign_id: string | null; classification: string | null; channel: string | null; received_at: string | null };
type MsgRow = { id: string; campaign_id: string | null; step_number: number | null; status: string | null; sent_at: string | null; channel: string | null };

async function loadCampaignDetail(name: string) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const campsQ = supabase.from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, lead_id, seller_id, created_at, started_at, completed_at, stop_reason, paused_until, leads!inner(id, primary_first_name, primary_last_name, primary_title, company_name, status, icp_profile_id, company_bio_id)")
    .eq("name", name);
  const { data: campRaw } = bioId
    ? await campsQ.eq("leads.company_bio_id", bioId)
    : await campsQ;
  const camps = (campRaw ?? []) as CampRow[];
  if (camps.length === 0) return null;

  const leadFor = (c: CampRow) => Array.isArray(c.leads) ? c.leads[0] : c.leads;
  const campIds = camps.map(c => c.id);
  const sellerIds = Array.from(new Set(camps.map(c => c.seller_id).filter(Boolean) as string[]));
  const icpIds = Array.from(new Set(camps.map(c => leadFor(c)?.icp_profile_id).filter(Boolean) as string[]));

  const [{ data: msgsRaw }, { data: repliesRaw }, { data: sellersRaw }, { data: icpsRaw }] = await Promise.all([
    supabase.from("campaign_messages").select("id, campaign_id, step_number, status, sent_at, channel").in("campaign_id", campIds),
    supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, channel, received_at").in("campaign_id", campIds),
    sellerIds.length > 0
      ? supabase.from("sellers").select("id, name").in("id", sellerIds)
      : Promise.resolve({ data: [] }),
    icpIds.length > 0
      ? supabase.from("icp_profiles").select("id, profile_name").in("id", icpIds)
      : Promise.resolve({ data: [] }),
  ]);
  const msgs = (msgsRaw ?? []) as MsgRow[];
  const replies = (repliesRaw ?? []) as ReplyRow[];
  const sellerMap = new Map<string, string>();
  for (const s of ((sellersRaw ?? []) as { id: string; name: string }[])) sellerMap.set(s.id, s.name);
  const icpMap = new Map<string, string>();
  for (const i of ((icpsRaw ?? []) as { id: string; profile_name: string }[])) icpMap.set(i.id, i.profile_name);

  // ─── Aggregations ────────────────────────────────────────────────
  const sentMsgs = msgs.filter(m => m.status === "sent");
  const repliedLeadIds = new Set(replies.map(r => r.lead_id).filter(Boolean) as string[]);
  const positiveLeadIds = new Set(replies.filter(r => POSITIVE_CLASS.has(r.classification ?? "")).map(r => r.lead_id).filter(Boolean) as string[]);
  const negativeLeadIds = new Set(replies.filter(r => NEGATIVE_CLASS.has(r.classification ?? "")).map(r => r.lead_id).filter(Boolean) as string[]);
  const meetingLeadIds = new Set(camps.filter(c => leadFor(c)?.status === "qualified").map(c => c.lead_id).filter(Boolean) as string[]);
  const wonLeadIds = new Set(camps.filter(c => leadFor(c)?.status === "closed_won").map(c => c.lead_id).filter(Boolean) as string[]);

  const totalLeads = camps.length;
  const totalSent = sentMsgs.length;
  const repliedCount = repliedLeadIds.size;
  const positiveCount = positiveLeadIds.size;
  const negativeCount = negativeLeadIds.size;
  const meetingCount = meetingLeadIds.size;
  const wonCount = wonLeadIds.size;

  // Sequence steps from the first campaign (all share template)
  const sequenceSteps: { channel: string; daysAfter: number; daysAfterPrev?: number }[] =
    Array.isArray(camps[0].sequence_steps) ? (camps[0].sequence_steps as { channel: string; daysAfter: number; daysAfterPrev?: number }[]) : [];

  // Per-step performance (reuses the same attribution as main dashboard)
  type StepAgg = { sent: number; replied: number };
  const stepAgg = new Map<number, StepAgg>();
  const ensureStep = (n: number) => {
    let g = stepAgg.get(n);
    if (!g) { g = { sent: 0, replied: 0 }; stepAgg.set(n, g); }
    return g;
  };
  for (const m of sentMsgs) ensureStep(m.step_number ?? 0).sent++;
  const sentByCamp = new Map<string, MsgRow[]>();
  for (const m of sentMsgs) {
    if (!m.campaign_id || !m.sent_at) continue;
    const list = sentByCamp.get(m.campaign_id) ?? [];
    list.push(m); sentByCamp.set(m.campaign_id, list);
  }
  for (const [, list] of sentByCamp) list.sort((a, b) => (a.sent_at && b.sent_at ? new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime() : 0));
  for (const r of replies) {
    if (!r.campaign_id || !r.received_at) continue;
    const list = sentByCamp.get(r.campaign_id);
    if (!list) continue;
    const rT = new Date(r.received_at).getTime();
    let step: number | null = null;
    for (const m of list) {
      if (!m.sent_at) continue;
      if (new Date(m.sent_at).getTime() <= rT) step = m.step_number ?? 0;
      else break;
    }
    if (step !== null) ensureStep(step).replied++;
  }
  const stepPerformance = Array.from(stepAgg.entries()).map(([step, g]) => ({
    step,
    sent: g.sent,
    replied: g.replied,
    replyRate: g.sent >= 5 ? Math.round((g.replied / g.sent) * 100) : null,
  })).sort((a, b) => a.step - b.step);

  // ─── 30d trend + classification + heatmap ────────────────────────
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const dayBucket = (iso: string) => Math.floor((today.getTime() - new Date(iso).getTime()) / 86_400_000);
  const trendSent = new Array(30).fill(0) as number[];
  const trendReplies = new Array(30).fill(0) as number[];
  const trendPositive = new Array(30).fill(0) as number[];
  for (const m of sentMsgs) {
    if (!m.sent_at) continue;
    const idx = 29 - dayBucket(m.sent_at);
    if (idx >= 0 && idx < 30) trendSent[idx]++;
  }
  const classCounts: Record<string, number> = {};
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const r of replies) {
    const cls = r.classification ?? "unclassified";
    classCounts[cls] = (classCounts[cls] ?? 0) + 1;
    if (r.received_at) {
      const idx = 29 - dayBucket(r.received_at);
      if (idx >= 0 && idx < 30) {
        trendReplies[idx]++;
        if (POSITIVE_CLASS.has(cls)) trendPositive[idx]++;
      }
      const d = new Date(r.received_at);
      heatmap[d.getDay()][d.getHours()]++;
    }
  }

  // ─── Time-to-first-reply ─────────────────────────────────────────
  const firstMsgAt = new Map<string, number>();
  for (const m of sentMsgs) {
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

  // ─── Status mix + stop reasons ───────────────────────────────────
  const statusMix: Record<string, number> = {};
  for (const c of camps) {
    const s = c.status ?? "unknown";
    statusMix[s] = (statusMix[s] ?? 0) + 1;
  }
  const stopReasons: Record<string, number> = {};
  for (const c of camps) {
    if (c.stop_reason) stopReasons[c.stop_reason] = (stopReasons[c.stop_reason] ?? 0) + 1;
  }

  // ─── Sellers within this campaign ────────────────────────────────
  type SellerAgg = { id: string; name: string; leads: Set<string>; sent: number; replied: Set<string>; positive: Set<string> };
  const sellerAgg = new Map<string, SellerAgg>();
  for (const c of camps) {
    if (!c.seller_id) continue;
    let g = sellerAgg.get(c.seller_id);
    if (!g) { g = { id: c.seller_id, name: sellerMap.get(c.seller_id) ?? "—", leads: new Set(), sent: 0, replied: new Set(), positive: new Set() }; sellerAgg.set(c.seller_id, g); }
    if (c.lead_id) {
      g.leads.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id);
    }
  }
  for (const m of sentMsgs) {
    if (!m.campaign_id) continue;
    const c = camps.find(x => x.id === m.campaign_id);
    if (c?.seller_id && sellerAgg.has(c.seller_id)) sellerAgg.get(c.seller_id)!.sent++;
  }
  const sellers = Array.from(sellerAgg.values()).map(g => ({
    id: g.id,
    name: g.name,
    leads: g.leads.size,
    sent: g.sent,
    replied: g.replied.size,
    positive: g.positive.size,
    conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive);

  // ─── Lead-level engagement ──────────────────────────────────────
  const leadDetail = camps.map(c => {
    const l = leadFor(c);
    return {
      campaignId: c.id,
      leadId: c.lead_id,
      name: `${l?.primary_first_name ?? ""} ${l?.primary_last_name ?? ""}`.trim() || "—",
      title: l?.primary_title ?? null,
      company: l?.company_name ?? null,
      step: c.current_step ?? 0,
      status: c.status ?? "",
      replied: c.lead_id ? repliedLeadIds.has(c.lead_id) : false,
      positive: c.lead_id ? positiveLeadIds.has(c.lead_id) : false,
      negative: c.lead_id ? negativeLeadIds.has(c.lead_id) : false,
      seller: c.seller_id ? (sellerMap.get(c.seller_id) ?? null) : null,
    };
  }).sort((a, b) => {
    const aw = (a.positive ? 4 : 0) + (a.replied ? 2 : 0) - (a.negative ? 1 : 0);
    const bw = (b.positive ? 4 : 0) + (b.replied ? 2 : 0) - (b.negative ? 1 : 0);
    return bw - aw || b.step - a.step;
  });

  return {
    name,
    totalLeads, totalSent, repliedCount, positiveCount, negativeCount, meetingCount, wonCount,
    responseRate: totalLeads > 0 ? Math.round((repliedCount / totalLeads) * 100) : 0,
    positiveRate: repliedCount > 0 ? Math.round((positiveCount / repliedCount) * 100) : 0,
    conversionRate: totalLeads > 0 ? Math.round((positiveCount / totalLeads) * 100) : 0,
    medianTTR,
    statusMix,
    stopReasons,
    channels: Array.from(new Set(camps.map(c => c.channel).filter(Boolean) as string[])),
    icpNames: icpIds.map(id => icpMap.get(id) ?? "—"),
    icpIds,
    sellers,
    sequenceSteps,
    stepPerformance,
    trend30d: { sent: trendSent, replies: trendReplies, positive: trendPositive },
    classCounts,
    heatmap,
    leadDetail: leadDetail.slice(0, 18),
    startedAt: camps[0].started_at ?? camps[0].created_at,
    completedAt: camps.find(c => c.status === "completed")?.completed_at ?? null,
  };
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const scope = await getUserScope();
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) redirect("/onboarding");

  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const [d, t, locale] = await Promise.all([
    loadCampaignDetail(name),
    getT(),
    getServerLocale(),
  ]);
  const dateLoc = locale === "es" ? "es-AR" : "en-US";

  if (!d) {
    return (
      <div className="p-6">
        <Link href="/" className="text-xs hover:underline" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} className="inline mr-1" /> {t("dashx.detail.back")}
        </Link>
        <p className="mt-4 text-sm" style={{ color: C.textBody }}>{t("dashx.detail.campaign.notFound")}</p>
      </div>
    );
  }

  const classColors: Record<string, string> = {
    positive: "#16A34A", meeting_intent: "#059669", negative: "#DC2626", not_now: "#F59E0B",
    unsubscribe: "#9CA3AF", needs_info: "#7C3AED", question: "#0A66C2", nurturing: "#6B7280",
    spam: "#374151", auto_reply: "#94A3B8", unclassified: "#9CA3AF",
  };
  const donutSlices = Object.entries(d.classCounts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      label: t(`dashx.reply.${k}`) === `dashx.reply.${k}` ? k : t(`dashx.reply.${k}`),
      value: v,
      color: classColors[k] ?? "#9CA3AF",
    }))
    .sort((a, b) => b.value - a.value);

  const aggStatus = d.statusMix.active ? "active" : d.statusMix.paused ? "paused" : "completed";
  const aggStatusLabel = aggStatus === "active" ? t("dashx.tbl.status.active") : aggStatus === "paused" ? t("dashx.tbl.status.paused") : t("dashx.tbl.status.completed");

  return (
    <div className="p-4 sm:p-6 w-full space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs hover:underline transition-opacity hover:opacity-70" style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> {t("dashx.detail.back")}
      </Link>

      <PageHero
        icon={Megaphone}
        section={t("dashx.detail.campaign.section")}
        title={d.name}
        description={[
          d.channels.map(ch => t(`dashx.ch.${ch}`) || ch).join(" + "),
          d.icpNames.length > 0 ? `${t("dashx.detail.campaign.icp")}: ${d.icpNames.join(", ")}` : null,
        ].filter(Boolean).join(" · ")}
        accentColor={gold}
        status={{ label: aggStatusLabel, active: aggStatus === "active" }}
      />

      {/* ─── Status band: started, status mix, stop reason ─────────────── */}
      <section className="rounded-2xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: C.border }}>
          <StatusTile
            label={t("dashx.detail.campaign.tile.started")}
            value={d.startedAt ? new Date(d.startedAt).toLocaleDateString(dateLoc, { day: "2-digit", month: "short", year: "numeric" }) : "—"}
            hint={d.startedAt ? `${Math.round((Date.now() - new Date(d.startedAt).getTime()) / 86_400_000)} ${t("dashx.detail.campaign.tile.daysAgo")}` : undefined}
            icon={Calendar}
          />
          <StatusTile
            label={t("dashx.detail.campaign.tile.statusMix")}
            value={`${d.statusMix.active ?? 0}/${d.totalLeads}`}
            hint={t("dashx.detail.campaign.tile.statusMixHint", { active: d.statusMix.active ?? 0, paused: d.statusMix.paused ?? 0, completed: d.statusMix.completed ?? 0 })}
            icon={Activity}
          />
          <StatusTile
            label={t("dashx.detail.campaign.tile.ttfr")}
            value={d.medianTTR === null ? "—" : formatMinutes(d.medianTTR)}
            hint={t("dashx.detail.campaign.tile.ttfrHint")}
            icon={Clock}
          />
          <StatusTile
            label={t("dashx.detail.campaign.tile.stopReason")}
            value={Object.keys(d.stopReasons).length > 0 ? `${Object.values(d.stopReasons).reduce((a, b) => a + b, 0)}` : "0"}
            hint={Object.keys(d.stopReasons).length > 0
              ? Object.entries(d.stopReasons).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}`).join(" · ")
              : t("dashx.detail.campaign.tile.stopReasonClean")}
            icon={AlertTriangle}
            tone={Object.keys(d.stopReasons).length > 0 ? "warning" : "neutral"}
          />
        </div>
      </section>

      {/* ─── KPI band ─────────────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label={t("dashx.detail.campaign.kpi.leads")} value={d.totalLeads.toLocaleString(dateLoc)} icon={Users} accent={gold} />
          <KpiCard label={t("dashx.detail.campaign.kpi.sent")} value={d.totalSent.toLocaleString(dateLoc)} icon={Send} accent="#0A66C2" trend={d.trend30d.sent} />
          <KpiCard label={t("dashx.detail.campaign.kpi.replies")} value={d.repliedCount.toLocaleString(dateLoc)} icon={MessageSquare} accent="#7C3AED" trend={d.trend30d.replies} hint={t("dashx.detail.campaign.kpi.repliesHint", { n: d.responseRate })} />
          <KpiCard label={t("dashx.detail.campaign.kpi.positives")} value={d.positiveCount.toLocaleString(dateLoc)} icon={ThumbsUp} accent={C.green} trend={d.trend30d.positive} hint={t("dashx.detail.campaign.kpi.positivesHint", { n: d.positiveRate })} />
          <KpiCard label={t("dashx.detail.campaign.kpi.meetings")} value={d.meetingCount.toLocaleString(dateLoc)} icon={Calendar} accent="#F59E0B" />
          <KpiCard label={t("dashx.detail.campaign.kpi.wins")} value={d.wonCount.toLocaleString(dateLoc)} icon={Trophy} accent="#DC2626" hint={t("dashx.detail.campaign.kpi.winsHint", { n: d.conversionRate })} />
        </div>
      </section>

      {/* ─── Sequence timeline ────────────────────────────────────── */}
      {d.sequenceSteps.length > 0 && (
        <section>
          <SectionHeader icon={Activity} title={t("dashx.detail.campaign.seq.title")} subtitle={t("dashx.detail.campaign.seq.subtitle")} />
          <Panel>
            <SequenceTimeline steps={d.sequenceSteps} t={t} />
          </Panel>
        </section>
      )}

      {/* ─── Step performance ───────────────────────────────────── */}
      <section>
        <SectionHeader icon={Send} title={t("dashx.detail.campaign.step.title")} subtitle={t("dashx.detail.campaign.step.subtitle")} />
        <Panel>
          <StepPerformance steps={d.stepPerformance} locale={locale} />
        </Panel>
      </section>

      {/* ─── 30d trend + classification donut ───────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Panel title={t("dashx.trend.title")} subtitle={t("dashx.detail.campaign.trend.subtitle")} className="lg:col-span-7">
          <MultiLineChart series={[
            { name: t("dashx.trend.sent"),      color: "#0A66C2", data: d.trend30d.sent },
            { name: t("dashx.trend.replies"),   color: "#7C3AED", data: d.trend30d.replies },
            { name: t("dashx.trend.positives"), color: C.green,    data: d.trend30d.positive },
          ]} />
        </Panel>
        <Panel title={t("dashx.detail.campaign.donut.title")} subtitle={t("dashx.detail.campaign.donut.subtitle")} className="lg:col-span-5">
          {donutSlices.length > 0
            ? <Donut data={donutSlices} />
            : <div className="py-10 text-center text-[12px]" style={{ color: C.textMuted }}>{t("dashx.detail.campaign.donut.empty")}</div>}
        </Panel>
      </section>

      {/* ─── Heatmap: when replies arrive ───────────────────────── */}
      <section>
        <SectionHeader icon={Clock} title={t("dashx.detail.campaign.heat.title")} subtitle={t("dashx.detail.campaign.heat.subtitle")} />
        <Panel>
          <Heatmap matrix={d.heatmap} />
        </Panel>
      </section>

      {/* ─── Sellers running this campaign ─────────────────────── */}
      {d.sellers.length > 0 && (
        <section>
          <SectionHeader icon={Users} title={t("dashx.detail.campaign.sellers.title")} subtitle={t("dashx.detail.campaign.sellers.subtitle")} />
          <Panel>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                  <Th align="left">{t("dashx.tbl.col.seller")}</Th>
                  <Th align="right">{t("dashx.tbl.col.leads")}</Th>
                  <Th align="right">{t("dashx.tbl.col.sent")}</Th>
                  <Th align="right">{t("dashx.tbl.col.replied")}</Th>
                  <Th align="right">{t("dashx.tbl.col.positive")}</Th>
                  <Th align="right">{t("dashx.tbl.col.convPct")}</Th>
                </tr>
              </thead>
              <tbody>
                {d.sellers.map((s, idx) => (
                  <tr key={s.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <TopRankDot rank={idx} />
                        <Link href={`/dashboard/seller/${s.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{s.name}</Link>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{s.leads}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{s.sent}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{s.replied}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: s.positive > 0 ? C.green : C.textMuted }}>{s.positive}</td>
                    <td className="px-3 py-2 text-right"><RateCell value={s.conversionRate} color={C.green} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>
      )}

      {/* ─── Lead-level engagement ─────────────────────────────── */}
      <section>
        <SectionHeader icon={Users} title={t("dashx.detail.campaign.leads.title")} subtitle={t("dashx.detail.campaign.leads.subtitle")} />
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left">{t("dashx.detail.icp.leads.col.lead")}</Th>
                <Th align="left">{t("dashx.detail.icp.leads.col.company")}</Th>
                <Th align="left">{t("dashx.tbl.col.seller")}</Th>
                <Th align="right">{t("dashx.detail.campaign.leads.col.step")}</Th>
                <Th align="left">{t("dashx.detail.icp.leads.col.engagement")}</Th>
              </tr>
            </thead>
            <tbody>
              {d.leadDetail.map(l => (
                <tr key={l.campaignId} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                  <td className="px-3 py-2">
                    {l.leadId ? <Link href={`/leads/${l.leadId}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{l.name}</Link>
                              : <span style={{ color: C.textMuted }}>{l.name}</span>}
                    {l.title && <p className="text-[10.5px] mt-0.5" style={{ color: C.textDim }}>{l.title}</p>}
                  </td>
                  <td className="px-3 py-2" style={{ color: C.textMuted }}>{l.company ?? "—"}</td>
                  <td className="px-3 py-2" style={{ color: C.textMuted }}>{l.seller ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{l.step}</td>
                  <td className="px-3 py-2">
                    {l.positive ? <Pill color={C.green}>{t("dashx.reply.positive")}</Pill> :
                     l.negative ? <Pill color={C.red}>{t("dashx.reply.negative")}</Pill> :
                     l.replied  ? <Pill color="#7C3AED">{t("dashx.detail.icp.leads.replied")}</Pill> :
                     <Pill color={C.textMuted}>{t("dashx.detail.campaign.leads.inflow")}</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>
    </div>
  );
}

// ─── Local primitives (kept inline for now; will extract if a 4th page lands) ─

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
    <div className="mb-2.5 flex items-center gap-2.5">
      {Icon && (
        <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`, color: gold }}>
          <Icon size={12} />
        </span>
      )}
      <div className="flex-1 min-w-0 flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold leading-tight" style={{ color: C.textPrimary }}>{title}</h2>
        <p className="text-[11px] truncate" style={{ color: C.textMuted }}>· {subtitle}</p>
      </div>
    </div>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align: "left" | "right" }) {
  return <th className={`px-3 py-2 font-semibold text-${align}`}>{children}</th>;
}

function StatusTile({ label, value, hint, icon: Icon, tone = "neutral" }: { label: string; value: string; hint?: string; icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; tone?: "neutral" | "warning" }) {
  const accent = tone === "warning" ? "#D97706" : C.textMuted;
  return (
    <div className="px-5 py-4 flex items-start gap-3">
      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}>
        <Icon size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textMuted }}>{label}</p>
        <p className="text-[16px] font-semibold tabular-nums mt-0.5 truncate" style={{ color: C.textPrimary }}>{value}</p>
        {hint && <p className="text-[10.5px] mt-0.5 truncate" style={{ color: C.textDim }} title={hint}>{hint}</p>}
      </div>
    </div>
  );
}

function SequenceTimeline({ steps, t }: { steps: { channel: string; daysAfter: number; daysAfterPrev?: number }[]; t: (k: string, vars?: Record<string, string | number>) => string }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex items-stretch gap-2 min-w-fit pb-1">
        {steps.map((s, i) => {
          const meta = channelMeta[s.channel] ?? { Icon: Send, color: C.textMuted };
          const Icon = meta.Icon;
          const day = s.daysAfter ?? 0;
          return (
            <div key={i} className="flex items-center gap-2 shrink-0">
              <div className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border min-w-[140px]"
                style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${meta.color} 5%, ${C.card})` }}>
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
                  {i === 0 ? t("dashx.detail.campaign.seq.first") : t("dashx.detail.campaign.seq.day", { n: day })}
                </span>
                <span className="w-8 h-8 rounded-md flex items-center justify-center"
                  style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
                  <Icon size={14} />
                </span>
                <span className="text-[12px] font-medium" style={{ color: C.textPrimary }}>
                  {t(`dashx.ch.${s.channel}`) || s.channel}
                </span>
                <span className="text-[10px]" style={{ color: C.textDim }}>
                  {t("dashx.detail.campaign.seq.step", { n: i + 1 })}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className="h-px w-6" style={{ background: C.border }} aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </div>
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

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      {children}
    </span>
  );
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
