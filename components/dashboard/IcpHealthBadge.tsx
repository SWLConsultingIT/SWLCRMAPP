// Health badge for the ICP leaderboard. Composite score 0–100 derived
// from reply rate + conversion rate, with a "needs data" state when the
// ICP hasn't been contacted enough times to be evaluated fairly.
//
// Bucket → color → label:
//   ≥ 65 → green ("Healthy")
//   ≥ 35 → amber ("Cooling")
//   < 35 → red ("Stalled")
// (Pure server component — no client interactivity needed.)

import { C } from "@/lib/design";

export function computeIcpHealthScore(responseRate: number, conversionRate: number): number {
  // Reply rate and conversion are already percentages (0-100). Composite
  // weights them equally; capped at 100. A purely volume-based weighting
  // (e.g. lift by total positives) would punish smaller ICPs unfairly,
  // so we leave volume to the "needs data" flag.
  return Math.max(0, Math.min(100, Math.round((responseRate + conversionRate) / 2)));
}

export default function IcpHealthBadge({
  responseRate,
  conversionRate,
  contacted,
  labelHealthy = "Healthy",
  labelCooling = "Cooling",
  labelStalled = "Stalled",
  labelNeedsData = "Low data",
  minContacted = 10,
}: {
  responseRate: number;
  conversionRate: number;
  contacted: number;
  labelHealthy?: string;
  labelCooling?: string;
  labelStalled?: string;
  labelNeedsData?: string;
  minContacted?: number;
}) {
  const lowVolume = contacted < minContacted;
  const score = computeIcpHealthScore(responseRate, conversionRate);

  const tone = lowVolume
    ? { color: C.textDim, bg: "color-mix(in srgb, var(--c-textMuted) 8%, transparent)", label: labelNeedsData }
    : score >= 65
      ? { color: "#059669", bg: "color-mix(in srgb, #10B981 14%, transparent)", label: labelHealthy }
      : score >= 35
        ? { color: "#D97706", bg: "color-mix(in srgb, #D97706 14%, transparent)", label: labelCooling }
        : { color: "#DC2626", bg: "color-mix(in srgb, #DC2626 14%, transparent)", label: labelStalled };

  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-[3px] rounded-md text-[10.5px] font-bold tabular-nums"
      style={{ backgroundColor: tone.bg, color: tone.color }}
      title={lowVolume ? `${tone.label} · ${contacted} contacted (need ≥ ${minContacted})` : `${tone.label} · score ${score}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: tone.color, boxShadow: `0 0 0 2px color-mix(in srgb, ${tone.color} 28%, transparent)` }}
      />
      {lowVolume ? "—" : score}
    </span>
  );
}
