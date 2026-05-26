// Tiny sparkline (60x16) for use INSIDE table rows. No fill, no axis — just
// the trend line. Stripe/Linear use this exact pattern in their leaderboards
// so you can see the trajectory without leaving the row.

import { C } from "@/lib/design";

export default function InlineSpark({
  data,
  color = C.gold,
  width = 60,
  height = 16,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data || data.length === 0 || data.every(v => v === 0)) {
    return <div style={{ width, height }} className="opacity-30">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke={C.border} strokeDasharray="2,2" />
      </svg>
    </div>;
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(1, max - min);
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
    </svg>
  );
}
