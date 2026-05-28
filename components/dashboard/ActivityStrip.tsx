// Compact 30-day activity strip — boss kept saying the MultiLineChart
// was "too big". Three stat cards side by side, each with a big total,
// a delta chip vs prior period, and a sparkline. Total height ~110px
// vs the chart's 180px+. Same signal (trend over the window), much less
// vertical real estate.
//
// Server component — pure SVG, no client interactivity beyond hover
// tooltips on the cards (CSS only).

import { Send, MessageSquare, ThumbsUp, TrendingUp, TrendingDown, Minus } from "lucide-react";
import Link from "next/link";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type ActivitySeries = {
  sent: number[];
  replies: number[];
  positive: number[];
};

export default function ActivityStrip({
  current,
  prior,
  locale = "en",
  labels,
  hrefs,
}: {
  current: ActivitySeries;
  prior?: ActivitySeries;
  locale?: "en" | "es";
  labels: {
    sent: string;
    replies: string;
    positives: string;
    vsPrior: string;
    noPrior: string;
    windowLabel: string;
  };
  hrefs?: { sent?: string; replies?: string; positives?: string };
}) {
  const dateLocStr = locale === "es" ? "es-AR" : "en-US";

  const sum = (a: number[]) => a.reduce((acc, v) => acc + v, 0);
  const totalSent = sum(current.sent);
  const totalReplies = sum(current.replies);
  const totalPositives = sum(current.positive);
  const priorSent = prior ? sum(prior.sent) : null;
  const priorReplies = prior ? sum(prior.replies) : null;
  const priorPositives = prior ? sum(prior.positive) : null;

  const fmtRange = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 29);
    const f = (d: Date) => d.toLocaleDateString(dateLocStr, { day: "2-digit", month: "short" });
    return `${f(start)} → ${f(end)}`;
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: C.textMuted }}>
        {labels.windowLabel} · {fmtRange()}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ActivityCard
          icon={Send}
          color="#0A66C2"
          label={labels.sent}
          total={totalSent}
          prior={priorSent}
          data={current.sent}
          locale={locale}
          vsPriorLabel={labels.vsPrior}
          noPriorLabel={labels.noPrior}
          href={hrefs?.sent}
        />
        <ActivityCard
          icon={MessageSquare}
          color="#7C3AED"
          label={labels.replies}
          total={totalReplies}
          prior={priorReplies}
          data={current.replies}
          locale={locale}
          vsPriorLabel={labels.vsPrior}
          noPriorLabel={labels.noPrior}
          href={hrefs?.replies}
        />
        <ActivityCard
          icon={ThumbsUp}
          color="#059669"
          label={labels.positives}
          total={totalPositives}
          prior={priorPositives}
          data={current.positive}
          locale={locale}
          vsPriorLabel={labels.vsPrior}
          noPriorLabel={labels.noPrior}
          href={hrefs?.positives}
        />
      </div>
    </div>
  );
}

function ActivityCard({
  icon: Icon, color, label, total, prior, data, vsPriorLabel, noPriorLabel, href, locale,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  color: string;
  label: string;
  total: number;
  prior: number | null;
  data: number[];
  vsPriorLabel: string;
  noPriorLabel: string;
  href?: string;
  locale: "en" | "es";
}) {
  const dateLocStr = locale === "es" ? "es-AR" : "en-US";
  const delta = prior !== null && prior > 0
    ? Math.round(((total - prior) / prior) * 100)
    : (prior === 0 && total > 0 ? 100 : null);

  const Body = (
    <div
      className="group/card relative rounded-xl border overflow-hidden p-3.5 transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_10px_26px_-12px_var(--card-glow)]"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        borderLeft: `3px solid ${color}`,
        ["--card-glow" as string]: `color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none opacity-0 group-hover/card:opacity-100 transition-opacity duration-200"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${color} 14%, transparent) 0%, transparent 70%)` }}
      />
      <div className="flex items-start gap-2 relative">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
        >
          <Icon size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: C.textMuted }}>
            {label}
          </p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span
              className="text-[26px] font-bold tabular-nums leading-none tracking-[-0.02em]"
              style={{ color, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
            >
              {total.toLocaleString(dateLocStr)}
            </span>
            {delta !== null ? (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md"
                style={{
                  background: delta > 0
                    ? "color-mix(in srgb, #10B981 14%, transparent)"
                    : delta < 0
                    ? "color-mix(in srgb, #DC2626 14%, transparent)"
                    : "transparent",
                  color: delta > 0 ? "#059669" : delta < 0 ? "#DC2626" : C.textMuted,
                }}
                title={vsPriorLabel}
              >
                {delta > 0 ? <TrendingUp size={9} /> : delta < 0 ? <TrendingDown size={9} /> : <Minus size={9} />}
                {Math.abs(delta)}%
              </span>
            ) : (
              <span className="text-[9.5px]" style={{ color: C.textDim }} title={noPriorLabel}>—</span>
            )}
          </div>
        </div>
      </div>
      {/* Sparkline — narrow inline strip showing the 30d shape. Area
          under the line is tinted in the channel color. */}
      <div className="mt-2 relative">
        <Sparkline data={data} color={color} />
      </div>
    </div>
  );

  return href ? <Link href={href} className="block">{Body}</Link> : Body;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length === 0) return <div style={{ height: 32 }} />;
  const max = Math.max(1, ...data);
  const w = 100, h = 32;
  const stepX = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data.map((v, i) => ({ x: i * stepX, y: h - (v / max) * h }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${w},${h} L0,${h} Z`;
  const peakIdx = data.indexOf(max);
  const peak = points[peakIdx];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-8" aria-hidden>
      <defs>
        <linearGradient id={`spark-grad-${color.replace(/[^a-zA-Z0-9]/g, "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-grad-${color.replace(/[^a-zA-Z0-9]/g, "")})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      {max > 0 && (
        <circle cx={peak.x} cy={peak.y} r={1.8} fill={color} />
      )}
    </svg>
  );
}
