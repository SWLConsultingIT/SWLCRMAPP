// Channel card — premium per-channel summary tile. Replaces the prior flat
// 4-stat grid with: big reply rate up top, channel icon + name on the left,
// thin volume bar at the bottom (sent / replied / positive). The top
// performer gets a gold ribbon overlay so the eye finds the winner instantly.
//
// Channel color is kept (LinkedIn blue / email green / phone orange) because
// they're universally recognizable, but the *layout* and typography are
// SWL-cohesive.

import { Share2, Mail, Phone, Smartphone, MessageSquare, Trophy } from "lucide-react";
import { C, N, T } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { Icon: React.ElementType; color: string; labelKey: string }> = {
  linkedin: { Icon: Share2,        color: "#0A66C2", labelKey: "dashx.ch.linkedin" },
  email:    { Icon: Mail,          color: "#059669", labelKey: "dashx.ch.email" },
  call:     { Icon: Phone,         color: "#EA580C", labelKey: "dashx.ch.call" },
  whatsapp: { Icon: Smartphone,    color: "#25D366", labelKey: "dashx.ch.whatsapp" },
  sms:      { Icon: MessageSquare, color: "#6B7280", labelKey: "dashx.ch.linkedin" },
};

export type ChannelRow = {
  channel: string;
  sent: number;
  contacted: number;
  replied: number;
  positive: number;
  responseRate: number;
  conversionRate: number;
};

export default function ChannelCard({
  row,
  isTop,
  t,
  topLabel,
}: {
  row: ChannelRow;
  isTop: boolean;
  t: (k: string) => string;
  topLabel: string;
}) {
  const meta = channelMeta[row.channel] ?? channelMeta.email;
  const Icon = meta.Icon;
  const channelLabel = t(meta.labelKey);

  return (
    <div
      // Hover lift + channel-color glow ring + 3px top accent rail in
      // channel color. Boss 2026-05-28 round B: "hace más lindo
      // performance by channel".
      className="group/card relative rounded-2xl border overflow-hidden p-4 sm:p-5 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-12px_var(--card-glow)] flex flex-col"
      style={{
        backgroundColor: C.card,
        borderColor: isTop ? `color-mix(in srgb, ${gold} 38%, ${C.border})` : C.border,
        boxShadow: isTop ? `0 6px 20px color-mix(in srgb, ${gold} 14%, transparent)` : "0 1px 2px rgba(0,0,0,0.03)",
        borderTop: `3px solid ${meta.color}`,
        minHeight: 178,
        ["--card-glow" as string]: `color-mix(in srgb, ${meta.color} 38%, transparent)`,
      }}
    >
      {/* Soft radial halo in the channel color — only visible on hover so
          at rest the card stays calm, on hover it lights up its identity. */}
      <span
        aria-hidden
        className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none opacity-0 group-hover/card:opacity-100 transition-opacity duration-200"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${meta.color} 12%, transparent) 0%, transparent 70%)` }}
      />
      {/* Top performer ribbon — gold gradient corner flag. Subtle but clear:
          the eye finds the winning channel before reading any number. */}
      {isTop && (
        <div
          aria-hidden
          className="absolute top-0 right-0 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] rounded-bl-xl flex items-center gap-1"
          style={{
            background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 75%, white) 100%)`,
            color: N.ink,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
          }}
        >
          <Trophy size={9} /> {topLabel}
        </div>
      )}

      {/* Channel ID row */}
      <div className="flex items-center gap-2.5 relative">
        <span
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
            color: meta.color,
            border: `1px solid color-mix(in srgb, ${meta.color} 22%, transparent)`,
          }}
        >
          <Icon size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <p className={`${T.label} truncate`} style={{ color: C.textMuted }}>
            {t("dashx.channels.channelLabel")}
          </p>
          <p className="text-[15px] font-bold leading-none mt-0.5 truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {channelLabel}
          </p>
        </div>
      </div>

      {/* Reply rate hero number */}
      <div className="mt-4 flex items-baseline gap-2 flex-1 relative">
        <span
          className="text-[40px] font-bold tabular-nums leading-none tracking-[-0.02em]"
          style={{ color: meta.color, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
        >
          {row.responseRate}
          <span className="text-[20px] ml-0.5" style={{ color: C.textMuted }}>%</span>
        </span>
        <span className="text-[10.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: C.textDim }}>
          {t("dashx.channels.respShort")}
        </span>
      </div>

      {/* Volume strip — 4 micro-stats now (added contacted so the
          denominator of the reply rate is visible alongside it). */}
      <div className="mt-3 pt-3 grid grid-cols-4 gap-2 relative" style={{ borderTop: `1px dashed ${C.border}` }}>
        <Mini label={t("dashx.channels.sent")} value={row.sent} />
        <Mini label={t("dashx.channels.contacted")} value={row.contacted} />
        <Mini label={t("dashx.channels.replied")} value={row.replied} />
        <Mini label={t("dashx.channels.positive")} value={row.positive} accent={row.positive > 0 ? C.green : undefined} />
      </div>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.14em] font-semibold" style={{ color: C.textDim }}>{label}</p>
      <p className="text-[14px] font-bold tabular-nums mt-0.5" style={{ color: accent ?? C.textPrimary }}>
        {value.toLocaleString("en-US")}
      </p>
    </div>
  );
}
