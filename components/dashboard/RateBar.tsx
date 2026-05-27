// Inline rate visual — a thin horizontal bar with the percentage label
// stacked above it. Used inside leaderboard tables to give the eye an
// instant visual rank without needing to read the number column-by-column.
//
// Width is normalized against the table's *max* rate (not 100%) so the
// leader fills the bar and the rest scale relative to them. Stripe pattern:
// rank by visual length, not raw value.

import { C } from "@/lib/design";

export default function RateBar({
  value,
  max,
  color,
  label,
  width = 80,
}: {
  value: number;
  max: number;
  color: string;
  /** Optional secondary text (e.g. "21%") shown above the bar — defaults to value%. */
  label?: string;
  width?: number;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const display = label ?? `${value}%`;
  return (
    <div className="flex flex-col items-end gap-1" style={{ width }}>
      <span
        className="text-[12px] font-bold tabular-nums leading-none"
        style={{ color: value > 0 ? color : C.textDim }}
      >
        {display}
      </span>
      <div
        className="w-full h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${pct}%`,
            background: value > 0
              ? `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, white))`
              : "transparent",
            boxShadow: value > 0 ? `0 0 6px color-mix(in srgb, ${color} 30%, transparent)` : "none",
          }}
        />
      </div>
    </div>
  );
}
