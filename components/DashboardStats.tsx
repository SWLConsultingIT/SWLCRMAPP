"use client";

import { Users, MessageSquare, TrendingUp, Megaphone, CheckCircle } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import KpiCard, { type KpiTone } from "./KpiCard";

type Stats = {
  totalLeads: number;
  leadsInCampaign: number;
  weekRepliesCount: number;
  weekPositive: number;
  transferred: number;
};

type Deltas = Partial<Record<keyof Stats, number | null>>;
type Sparks = Partial<Record<keyof Stats, number[] | null>>;

// Maps each KPI to a tone. "brand" gets gold (active pipeline = the brand
// promise); replies+positive get cool/positive tones; transferred is the win
// state. Keeping just 5 distinct tones — no rainbow.
const KPI_TONE: Record<keyof Stats, KpiTone> = {
  totalLeads:        "neutral",
  leadsInCampaign:   "brand",
  weekRepliesCount:  "info",
  weekPositive:      "positive",
  transferred:       "neutral",
};

// Pre-rendered icon elements so KpiCard (server component) doesn't receive
// a function across an RSC boundary. KpiCard renders this node as-is.
const KPI_ICON = {
  totalLeads:       <Users size={14} />,
  leadsInCampaign:  <Megaphone size={14} />,
  weekRepliesCount: <MessageSquare size={14} />,
  weekPositive:     <TrendingUp size={14} />,
  transferred:      <CheckCircle size={14} />,
} as const;

export default function DashboardStats({
  data, deltas, sparks,
}: { data: Stats; deltas?: Deltas; sparks?: Sparks }) {
  const { t } = useLocale();
  const cards: Array<{ key: keyof Stats; labelKey: string }> = [
    { key: "totalLeads",       labelKey: "dash.stat.totalLeads" },
    { key: "leadsInCampaign",  labelKey: "dash.stat.inActive" },
    { key: "weekRepliesCount", labelKey: "dash.stat.repliesWeek" },
    { key: "weekPositive",     labelKey: "dash.stat.positiveWeek" },
    { key: "transferred",      labelKey: "dash.stat.transferred" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
      {cards.map(({ key, labelKey }) => (
        <KpiCard
          key={key}
          label={t(labelKey)}
          value={data[key]}
          icon={KPI_ICON[key]}
          tone={KPI_TONE[key]}
          delta={deltas?.[key] ?? null}
          spark={sparks?.[key] ?? null}
          sub={deltas && deltas[key] != null ? "vs prior 7d" : undefined}
        />
      ))}
    </div>
  );
}
