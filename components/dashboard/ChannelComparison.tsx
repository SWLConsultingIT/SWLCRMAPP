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
}: {
  channels: Row[];
  t: (k: string) => string;
  emptyLabel?: string;
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
          <div key={r.channel} className="flex items-center gap-3 py-1.5">
            {/* Left: channel icon + name */}
            <div className="w-32 shrink-0 flex items-center gap-2">
              <span
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}
              >
                <Icon size={13} />
              </span>
              <span className="text-[13px] font-medium" style={{ color: C.textPrimary }}>{channelLabel}</span>
            </div>

            {/* Bar */}
            <div className="flex-1 relative h-8 rounded-md" style={{ background: C.surface }}>
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

            {/* Counts on the right — fixed-width columns for clean alignment */}
            <div className="hidden md:flex items-center gap-4 text-[11px] tabular-nums shrink-0" style={{ color: C.textMuted }}>
              <Stat label={t("dashx.channels.sent")} value={r.sent} width={50} />
              <Stat label={t("dashx.channels.replied")} value={r.replied} width={40} />
              <Stat label={t("dashx.channels.positive")} value={r.positive} width={40} accent={r.positive > 0 ? C.green : undefined} />
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

function Stat({ label, value, width, accent }: { label: string; value: number; width: number; accent?: string }) {
  return (
    <div style={{ width }} className="text-right">
      <p className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>{label}</p>
      <p className="text-[12px] font-semibold tabular-nums" style={{ color: accent ?? C.textPrimary }}>{value.toLocaleString("en-US")}</p>
    </div>
  );
}
