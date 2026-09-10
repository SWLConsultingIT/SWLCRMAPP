"use client";

// Small shared primitives for the redesigned Lead Detail. These are the genuine
// gaps the audit found (no InfoRow, no sub-tab bar, no compact metric strip);
// cards/badges/buttons reuse components/ui. Everything is presentational and
// theme-aware (C.* tokens) so it renders identically in the real page and in a
// harness with mock data.

import { useState, type ReactNode, type CSSProperties } from "react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

/** Uppercase section label + optional trailing action (the SectionHeader gap). */
export function SectionHeader({
  title, icon, action, className = "",
}: { title: string; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-3 ${className}`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span style={{ color: C.textMuted }} className="shrink-0">{icon}</span>}
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] truncate" style={{ color: C.textMuted }}>{title}</h3>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Label-over-value (or label + inline value) pair — the InfoRow gap. */
export function InfoRow({
  icon, label, value, children, href, external, className = "",
}: {
  icon?: ReactNode; label: string; value?: ReactNode; children?: ReactNode;
  href?: string | null; external?: boolean; className?: string;
}) {
  const body = children ?? (value ?? <span style={{ color: C.textDim }}>—</span>);
  const inner = (
    <>
      {icon && <span className="shrink-0 mt-0.5" style={{ color: C.textDim }}>{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{label}</p>
        <div className="text-[13px] font-medium break-words" style={{ color: href ? C.blue : C.textBody }}>{body}</div>
      </div>
    </>
  );
  if (href) {
    return (
      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}
        className={`flex items-start gap-2.5 hover:opacity-80 transition-opacity ${className}`}>
        {inner}
      </a>
    );
  }
  return <div className={`flex items-start gap-2.5 ${className}`}>{inner}</div>;
}

/** Compact horizontal metric strip: "Messages 4 · Replies 1 · …". */
export function MetricStrip({
  items, className = "", style,
}: { items: { label: string; value: ReactNode; tone?: string }[]; className?: string; style?: CSSProperties }) {
  return (
    <div className={`flex items-center gap-x-4 gap-y-1.5 flex-wrap ${className}`} style={style}>
      {items.map((m, i) => (
        <span key={i} className="inline-flex items-baseline gap-1.5">
          <span className="text-[15px] font-bold tabular-nums" style={{ color: m.tone ?? C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{m.value}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: C.textMuted }}>{m.label}</span>
        </span>
      ))}
    </div>
  );
}

/** Local sub-tab bar (client state, gold underline) for nesting inside a tab
 *  without touching the page-level ?tab= query param CompanyTabs owns. */
export function SubTabs({
  tabs, children, initial = 0,
}: { tabs: { label: string; count?: number }[]; children: ReactNode[]; initial?: number }) {
  const [active, setActive] = useState(initial);
  return (
    <div>
      <div className="flex items-center gap-5 border-b overflow-x-auto" style={{ borderColor: C.border }}>
        {tabs.map((tb, i) => (
          <button key={tb.label} onClick={() => setActive(i)}
            className="text-[13px] font-semibold py-2.5 relative whitespace-nowrap transition-colors"
            style={{ color: active === i ? C.textPrimary : C.textMuted }}>
            {tb.label}{tb.count !== undefined ? ` (${tb.count})` : ""}
            {active === i && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ backgroundColor: gold }} />}
          </button>
        ))}
      </div>
      <div className="mt-4">{children[active]}</div>
    </div>
  );
}

/** Compact inline empty line (not a giant box) — for in-tab empty states. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-3 text-[12.5px] flex items-center gap-2"
      style={{ borderColor: C.border, color: C.textDim }}>
      {children}
    </div>
  );
}
