import type { ReactNode } from "react";
import { C } from "@/lib/design";

// Canonical pill badge — consistent size/radius, color = meaning.
// tone maps to the semantic palette so a "positive" badge looks the same
// everywhere instead of each caller hand-picking a green.
export type BadgeTone = "neutral" | "brand" | "positive" | "negative" | "warning" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral:  C.textMuted,
  brand:    C.gold,
  positive: C.green,
  negative: C.red,
  warning:  C.yellow,
  info:     C.blue,
};

export default function Badge({
  children,
  tone = "neutral",
  dot = false,
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  /** Leading status dot. */
  dot?: boolean;
  className?: string;
}) {
  const color = TONES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap ${className}`}
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </span>
  );
}
