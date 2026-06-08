// Channel comparison — horizontal bars ranked by reply rate so the eye
// reads "this channel rinde N× better than that one" without doing the
// per-card cross-reference. Each row carries the channel icon + name,
// a length-encoded bar (reply rate vs the matrix max so the leader hits
// 100% width), and the raw counts inline.

import { Share2, Mail, Phone, Smartphone, MessageSquare } from "lucide-react";
import { C } from "@/lib/design";

const channelMeta: Record<string, { Icon: React.ElementType; color: string; labelKey: string }> = {
  linkedin: { Icon: Share2,        color: "#0A66C2", labelKey: "dashx.ch.linkedin" },
  email:    { Icon: Mail,          color: "#059669", labelKey: "dashx.ch.email" },
  call:     { Icon: Phone,         color: "#EA580C", labelKey: "dashx.ch.call" },
  whatsapp: { Icon: Smartphone,    color: "#25D366", labelKey: "dashx.ch.whatsapp" },
  sms:      { Icon: MessageSquare, color: "#6B7280", labelKey: "dashx.ch.linkedin" },
};

type Row = {
  channel: string;
  sent: number;
  contacted: number;
  replied: number;
  positive: number;
  responseRate: number;
  conversionRate: number;
};

export default function ChannelComparison({
  channels,
  t,
  emptyLabel = "No channel activity yet.",
  linkedinConnections,
}: {
  channels: Row[];
  t: (k: string) => string;
  emptyLabel?: string;
  /** LinkedIn invite leg (sent → accepted). Boss 2026-06-08: the head-to-head
   * was missing LinkedIn connections; surfaced inline on the LinkedIn row. */
  linkedinConnections?: { sent: number; accepted: number } | null;
}) {
  if (channels.length === 0) {
    return (
      <div className="py-10 text-center text-[12.5px]" style={{ color: C.textMuted }}>
        {emptyLabel}
      </div>
    );
  }

  // Sort by reply rate descending so the eye starts at the winner.
  const sorted = [...channels].sort((a, b) => b.responseRate - a.responseRate);
  const maxRate = Math.max(...sorted.map(r => r.responseRate), 1);

  return (
    <div className="space-y-2">
      {sorted.map((r, i) => {
        const meta = channelMeta[r.channel] ?? { Icon: Share2, color: C.textMuted, labelKey: "" };
        const Icon = meta.Icon;
        const channelLabel = meta.labelKey ? t(meta.labelKey) : r.channel;
        const widthPct = maxRate > 0 ? Math.max(6, (r.responseRate / maxRate) * 100) : 6;
        const isTop = i === 0 && sorted.length > 1 && r.responseRate > 0;

        return (
          <div
            key={r.channel}
            className="grid items-center gap-3 py-1.5"
            // Boss feedback 2026-05-27: bar was hogging the row, metrics were
            // cramped. Cap bar at ~40% of the row, give metrics ~46% so the
            // numbers can breathe and read at scan distance.
            style={{ gridTemplateColumns: "150px minmax(160px, 2fr) minmax(280px, 2.2fr)" }}
          >
            {/* Left: channel icon + name */}
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}
              >
                <Icon size={15} />
              </span>
              <div className="min-w-0">
                <span className="text-[13px] font-medium truncate block" style={{ color: C.textPrimary }} title={channelLabel}>{channelLabel}</span>
                {r.channel === "linkedin" && linkedinConnections && linkedinConnections.sent > 0 && (
                  <span className="text-[10px] truncate block" style={{ color: C.textDim }}
                    title={t("dashx.channels.connectionsHint")}>
                    {t("dashx.channels.connectionsInline")
                      .replace("{sent}", linkedinConnections.sent.toLocaleString("en-US"))
                      .replace("{accepted}", linkedinConnections.accepted.toLocaleString("en-US"))
                      .replace("{pct}", String(linkedinConnections.sent > 0 ? Math.round((linkedinConnections.accepted / linkedinConnections.sent) * 100) : 0))}
                  </span>
                )}
              </div>
            </div>

            {/* Bar */}
            <div className="relative h-8 rounded-md" style={{ background: C.surface }}>
              <div
                className="absolute inset-y-0 left-0 rounded-md flex items-center px-3 transition-[width]"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, ${meta.color}, color-mix(in srgb, ${meta.color} 75%, white))`,
                  minWidth: 56,
                  boxShadow: isTop ? `0 0 0 1.5px color-mix(in srgb, ${meta.color} 40%, transparent)` : undefined,
                }}
              >
                <span
                  className="text-[13px] font-bold tabular-nums"
                  style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
                >
                  {r.responseRate}%
                </span>
              </div>
            </div>

            {/* Counts on the right — wider cells so the numbers read at scan distance */}
            <div className="hidden md:grid items-center gap-3 tabular-nums" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
              <Stat label={t("dashx.channels.sent")} value={r.sent} hint={t("dashx.channels.sentHint")} />
              <Stat label={t("dashx.channels.contacted")} value={r.contacted} hint={t("dashx.channels.contactedHint")} />
              <Stat label={t("dashx.channels.replied")} value={r.replied} />
              <Stat label={t("dashx.channels.positive")} value={r.positive} accent={r.positive > 0 ? C.green : undefined} />
            </div>
          </div>
        );
      })}

      {/* Footnote — what's the bar measuring */}
      <p className="pt-2 text-[10.5px]" style={{ color: C.textDim }}>
        {t("dashx.channels.compFootnote")}
      </p>
    </div>
  );
}

function Stat({ label, value, accent, hint }: { label: string; value: number; accent?: string; hint?: string }) {
  return (
    <div className="text-right min-w-0" title={hint ?? label}>
      <p className="text-[9.5px] uppercase tracking-wider truncate" style={{ color: C.textDim }}>{label}{hint && <span className="opacity-60 ml-0.5" style={{ cursor: "help" }}>ⓘ</span>}</p>
      <p className="text-[14px] font-bold tabular-nums" style={{ color: accent ?? C.textPrimary }}>{value.toLocaleString("en-US")}</p>
    </div>
  );
}
