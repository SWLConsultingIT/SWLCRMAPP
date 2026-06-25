"use client";

import { useLocale } from "@/lib/i18n";

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

  // Lives inside the navy hero — styled as a translucent dark strip so it reads
  // as part of the command bar, not a bright light block.
  return (
    <div
      className="mx-4 sm:mx-6 mb-5 rounded-xl grid grid-cols-4 relative overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      {stats.map((s, i) => (
        <div key={s.label} className="text-center relative px-3 py-3.5"
          style={i > 0 ? { borderLeft: "1px solid rgba(255,255,255,0.08)" } : undefined}>
          <p
            className="text-xl sm:text-2xl font-bold tabular-nums"
            style={{
              color: "#FFFFFF",
              fontFamily: "var(--font-outfit), system-ui, sans-serif",
              letterSpacing: "-0.02em",
            }}
          >
            {s.value}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] mt-0.5" style={{ color: "#8E9AB4" }}>
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}
