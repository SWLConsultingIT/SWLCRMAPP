import type { LucideIcon } from "lucide-react";
import { C } from "@/lib/design";

type Variant = "accent" | "green" | "orange" | "red" | "blue" | "muted";

const variants: Record<Variant, {
  iconBg: string; iconColor: string; accentColor: string; barColor: string;
}> = {
  accent: { iconBg: C.accentLight, iconColor: C.accent,  accentColor: C.accent,  barColor: C.accent },
  green:  { iconBg: C.greenLight,  iconColor: C.green,   accentColor: C.green,   barColor: C.green },
  orange: { iconBg: C.orangeLight, iconColor: C.orange,  accentColor: C.orange,  barColor: C.orange },
  red:    { iconBg: C.redLight,    iconColor: C.red,     accentColor: C.red,     barColor: C.red },
  blue:   { iconBg: C.blueLight,   iconColor: C.blue,    accentColor: C.blue,    barColor: C.blue },
  muted:  { iconBg: "#F3F4F6",     iconColor: C.textMuted, accentColor: C.textMuted, barColor: "#D1D5DB" },
};

export default function StatCard({
  label, value, icon: Icon, variant = "accent", sub, change, progress,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  variant?: Variant;
  sub?: string;
  change?: { value: string; positive: boolean };
  progress?: number;
}) {
  const v = variants[variant];
  return (
    <div className="rounded-xl p-5 border fade-in"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
          {label}
        </span>
        {change && (
          <span className="text-xs font-semibold px-1.5 py-0.5 rounded"
            style={{
              color: change.positive ? C.green : C.red,
              backgroundColor: change.positive ? C.greenLight : C.redLight,
            }}>
            {change.positive ? "+" : ""}{change.value}
          </span>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-3xl font-bold tracking-tight tabular-nums" style={{ color: C.textPrimary }}>
            {value}
          </p>
          {sub && <p className="text-xs mt-1.5" style={{ color: C.textDim }}>{sub}</p>}
        </div>
        <div className="rounded-lg p-2.5" style={{ backgroundColor: v.iconBg }}>
          <Icon size={18} style={{ color: v.iconColor }} />
        </div>
      </div>

      {progress !== undefined && (
        <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#F3F4F6" }}>
          <div className="h-full rounded-full animate-fill"
            style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: v.barColor }} />
        </div>
      )}
    </div>
  );
}
