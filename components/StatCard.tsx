import type { LucideIcon } from "lucide-react";
import { C } from "@/lib/design";

type Variant = "gold" | "cyan" | "green" | "red" | "muted";

const variants: Record<Variant, {
  iconBg: string; iconColor: string; valueColor: string;
  topBorder: string; iconGlow: string;
}> = {
  gold:  { iconBg: C.goldGlow,  iconColor: C.gold,      valueColor: C.gold,      topBorder: C.gold,      iconGlow: "0 0 18px rgba(201,168,58,0.35)" },
  cyan:  { iconBg: C.cyanGlow,  iconColor: C.cyan,      valueColor: C.cyan,      topBorder: C.cyan,      iconGlow: "0 0 18px rgba(0,229,255,0.25)" },
  green: { iconBg: C.greenGlow, iconColor: C.green,     valueColor: C.green,     topBorder: C.green,     iconGlow: "0 0 18px rgba(61,220,132,0.28)" },
  red:   { iconBg: C.redGlow,   iconColor: C.red,       valueColor: C.red,       topBorder: C.red,       iconGlow: "0 0 18px rgba(255,95,95,0.28)" },
  muted: { iconBg: "rgba(78,90,114,0.12)", iconColor: C.textMuted, valueColor: C.textBody, topBorder: C.border2, iconGlow: "none" },
};

export default function StatCard({
  label, value, icon: Icon, variant = "gold", sub,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  variant?: Variant;
  sub?: string;
}) {
  const v = variants[variant];
  return (
    <div
      className="rounded-xl p-4 border fade-in relative overflow-hidden"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        borderTop: `2px solid ${v.topBorder}`,
        background: `linear-gradient(160deg, #131d2e 0%, ${C.card} 60%)`,
      }}
    >
      {/* Subtle background glow blob */}
      <div
        className="absolute -top-4 -right-4 w-16 h-16 rounded-full pointer-events-none"
        style={{ background: v.topBorder, opacity: 0.05, filter: "blur(14px)" }}
      />

      <div className="flex items-center justify-between mb-4 relative">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
          {label}
        </span>
        <div
          className="rounded-lg p-2"
          style={{ backgroundColor: v.iconBg, boxShadow: v.iconGlow }}
        >
          <Icon size={15} style={{ color: v.iconColor }} />
        </div>
      </div>

      <p className="text-3xl font-bold tracking-tight tabular-nums relative" style={{ color: v.valueColor }}>
        {value}
      </p>
      {sub && <p className="text-xs mt-2" style={{ color: C.textDim }}>{sub}</p>}
    </div>
  );
}
