"use client";

// ScoreTile — used inside the Campaigns "head-to-head" comparison cards on
// the dashboard. Big tabular number + small uppercase label, colored when
// `accent` is on. When `href` is provided, the tile becomes a Link that
// deep-jumps into the campaign detail at the matching anchor (e.g. #funnel,
// #leads). Stops propagation so the click doesn't also toggle the parent
// <details> summary the tile sits inside.
//
// Client component because the home `app/page.tsx` is a Server Component
// and cannot ship event handlers across the RSC boundary.

import Link from "next/link";
import { C } from "@/lib/design";

export default function ScoreTile({
  label,
  value,
  color,
  accent,
  href,
}: {
  label: string;
  value: number | string;
  color: string;
  accent?: boolean;
  href?: string;
}) {
  const cls = "rounded-lg border px-3 py-2 block transition-colors" + (href ? " hover:border-current cursor-pointer" : "");
  const styleObj: React.CSSProperties = {
    background: accent ? `color-mix(in srgb, ${color} 8%, transparent)` : C.surface,
    borderColor: accent ? `color-mix(in srgb, ${color} 28%, ${C.border})` : C.border,
    textDecoration: "none",
    color: "inherit",
  };
  const body = (
    <>
      <p className="text-[9px] font-bold uppercase tracking-wider truncate" style={{ color: C.textMuted }}>{label}</p>
      <p className="text-[22px] font-bold tabular-nums leading-tight tracking-[-0.02em]"
        style={{ color: `color-mix(in srgb, ${color}, white var(--c-accent-lift, 0%))`, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
        {value}
      </p>
    </>
  );
  if (href) {
    return (
      <Link href={href} onClick={(e) => e.stopPropagation()} className={cls} style={styleObj}>
        {body}
      </Link>
    );
  }
  return (
    <div className={cls} style={styleObj}>
      {body}
    </div>
  );
}
