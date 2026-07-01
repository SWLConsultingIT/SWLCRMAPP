"use client";

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { C } from "@/lib/design";

// Canonical button — 4 variants, 2 sizes, one radius/height system.
// Replaces per-caller inline button styling (each screen hand-rolled its own
// colors/padding). `accent` overrides the brand color for solid/soft (e.g. a
// zone accent) without forking the component.
type Variant = "solid" | "soft" | "ghost" | "danger";
type Size = "sm" | "md";

const SIZES: Record<Size, string> = {
  sm: "text-[12px] px-3 py-1.5 gap-1.5 rounded-lg",
  md: "text-[13px] px-4 py-2.5 gap-2 rounded-xl",
};

export default function Button({
  children,
  variant = "solid",
  size = "md",
  accent,
  className = "",
  style,
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  accent?: string;
  className?: string;
  style?: CSSProperties;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "className">) {
  const brand = accent ?? C.gold;
  const variantStyle: CSSProperties =
    variant === "solid"
      ? { background: `linear-gradient(135deg, ${brand}, color-mix(in srgb, ${brand} 72%, white))`, color: "#1a1505" }
      : variant === "soft"
      ? { backgroundColor: `color-mix(in srgb, ${brand} 12%, transparent)`, color: `color-mix(in srgb, ${brand} 78%, black)` }
      : variant === "danger"
      ? { backgroundColor: `color-mix(in srgb, ${C.red} 10%, transparent)`, color: C.red, border: `1px solid color-mix(in srgb, ${C.red} 25%, transparent)` }
      : { backgroundColor: C.card, color: C.textBody, border: `1px solid ${C.border}` };

  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center font-semibold whitespace-nowrap transition-[opacity,transform,box-shadow] hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none ${SIZES[size]} ${className}`}
      style={{ ...variantStyle, ...style }}
    >
      {children}
    </button>
  );
}
