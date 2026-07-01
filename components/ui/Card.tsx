import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { C } from "@/lib/design";

// Canonical card — ONE look for every surface (design-system pass 2026-06-26).
// Radius 16, 1px border, one theme-aware shadow. Replaces the ad-hoc
// `rounded-2xl border + inline boxShadow` scattered across the app (12+ distinct
// shadow strings, 6 radii). Optional left accent rail for section identity.
//
// Presentational + theme-aware (uses C.* tokens → dark mode automatic).
type CardProps = {
  children: ReactNode;
  /** Left accent rail color (e.g. a zone accent). Omit for a plain card. */
  accent?: string;
  /** Inner padding. true → p-5 (20px), false → none, number → px. Default true. */
  padded?: boolean | number;
  /** Lift on hover (for clickable cards). */
  interactive?: boolean;
  className?: string;
  style?: CSSProperties;
} & Omit<HTMLAttributes<HTMLDivElement>, "style" | "className">;

export default function Card({
  children,
  accent,
  padded = true,
  interactive = false,
  className = "",
  style,
  ...rest
}: CardProps) {
  const pad = padded === true ? "20px" : padded === false ? undefined : `${padded}px`;
  return (
    <div
      {...rest}
      className={`rounded-2xl border ${interactive ? "lift" : ""} ${className}`}
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: C.shadow,
        ...(accent ? { borderLeft: `3px solid ${accent}` } : null),
        ...(pad ? { padding: pad } : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
