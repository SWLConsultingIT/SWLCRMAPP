"use client";

import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

type Props = {
  totalMsgsSent: number;
  totalReplies: number;
  positiveReplies: number;
  campaignStep: string;
};

export default function LeadStatsBar({
  totalMsgsSent,
  totalReplies,
  positiveReplies,
  campaignStep,
}: Props) {
  const { t } = useLocale();
  const stats = [
    { label: t("lead.stat.messages"), value: totalMsgsSent },
    { label: t("lead.stat.replies"),  value: totalReplies },
    { label: t("lead.stat.positive"), value: positiveReplies },
    { label: t("lead.stat.step"),     value: campaignStep },
  ];

  return (
    <div
      className="mx-6 mb-5 px-5 py-4 rounded-xl grid grid-cols-4 gap-4 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 8%, var(--c-card)) 0%, color-mix(in srgb, ${gold} 4%, var(--c-card)) 100%)`,
        border: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
      }}
    >
      <div
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none opacity-50"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 14%, transparent) 0%, transparent 70%)` }}
      />
      {stats.map((s) => (
        <div key={s.label} className="text-center relative">
          <p
            className="text-2xl font-bold tabular-nums"
            style={{
              color: C.textPrimary,
              fontFamily: "var(--font-outfit), system-ui, sans-serif",
              letterSpacing: "-0.02em",
            }}
          >
            {s.value}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] mt-0.5" style={{ color: C.textMuted }}>
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}
