// Inline SVG sparkline — no chart lib dependency, fully RSC-safe.
// Used in every KPI card to show the 30d trend behind the headline number.

import { C } from "@/lib/design";

export default function Sparkline({
  data,
  color = C.gold,
  width = 120,
  height = 32,
  filled = true,
  strokeWidth = 1.5,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  filled?: boolean;
  strokeWidth?: number;
}) {
  if (!data || data.length === 0) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(1, max - min);
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const linePath = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0] + "," + p[1]).join(" ");
  const fillPath = `${linePath} L${width},${height} L0,${height} Z`;
  const gradId = `spk-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg width={width} height={height} aria-hidden viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {filled && <path d={fillPath} fill={`url(#${gradId})`} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
