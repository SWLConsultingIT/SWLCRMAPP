"use client";

import { Users, MessageSquare, TrendingUp, Megaphone, CheckCircle } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

type Stats = {
  totalLeads: number;
  leadsInCampaign: number;
  weekRepliesCount: number;
  weekPositive: number;
  transferred: number;
};

export default function DashboardStats({ data }: { data: Stats }) {
  const { t } = useLocale();
  const cards = [
    { labelKey: "dash.stat.totalLeads",    value: data.totalLeads,        color: C.textBody, icon: Users },
    { labelKey: "dash.stat.inActive",      value: data.leadsInCampaign,   color: gold,       icon: Megaphone },
    { labelKey: "dash.stat.repliesWeek",   value: data.weekRepliesCount,  color: C.blue,     icon: MessageSquare },
    { labelKey: "dash.stat.positiveWeek",  value: data.weekPositive,      color: C.green,    icon: TrendingUp },
    { labelKey: "dash.stat.transferred",   value: data.transferred,       color: C.accent,   icon: CheckCircle },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      {cards.map(({ labelKey, value, color, icon: Icon }) => (
        <div
          key={labelKey}
          data-stat
          className="rounded-2xl border px-6 py-5 card-lift relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, var(--c-card) 0%, color-mix(in srgb, ${color} 5%, var(--c-card)) 100%)`,
            borderColor: C.border,
            borderTop: `3px solid ${color}`,
          }}
        >
          <div
            className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none opacity-50"
            style={{ background: `radial-gradient(circle, color-mix(in srgb, ${color} 16%, transparent) 0%, transparent 70%)` }}
          />
          <div className="flex items-center justify-between mb-4 relative">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: C.textMuted }}>
              {t(labelKey)}
            </span>
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
                boxShadow: `0 0 16px color-mix(in srgb, ${color} 18%, transparent)`,
              }}
            >
              <Icon size={16} style={{ color }} />
            </div>
          </div>
          <p
            className="text-[30px] font-bold leading-none"
            style={{
              color,
              fontFamily: "var(--font-outfit), system-ui, sans-serif",
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}
