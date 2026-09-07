"use client";

// ─────────────────────────────────────────────────────────────────────────
// Shared vocabulary for every tab of the Diagnostic Console mock.
//
// Extracted verbatim from the approved Overview so the other five tabs are
// the SAME design rather than a family resemblance: one typographic ladder,
// one band, one delta, one filter control, one ranked list.
//
// The rule the whole mock is built on: a number is only rendered next to
// another number when the two are the same measurement over the same window.
// Anything that isn't gets its own group with the difference written down.
// ─────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import {
  Share2, Mail, Phone, MessageSquare, UserPlus, ChevronDown, ArrowUpRight, ArrowDownRight,
  Minus, Check, X, ArrowRight, HelpCircle,
} from "lucide-react";
import { C } from "@/lib/design";

export const gold = "var(--brand, #c9a83a)";
export const n = (x: number) => x.toLocaleString("en-US");
export const pct = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100);

export type Delta = { v: number; unit: "pp" | "pct" } | null;

/* One typographic ladder for the whole mock. The gaps between steps are wide
   on purpose: weak hierarchy comes from sizes that are too close. */
export const S = {
  answer: 52,
  major: 30,
  minor: 19,
  body: 13,
  label: 10.5,
  micro: 11,
  bandGap: 68,
};

export function DeltaTag({ d, size = S.micro }: { d: Delta; size?: number }) {
  if (!d) return null;
  const up = d.v > 0, flat = d.v === 0;
  const color = flat ? C.textMuted : up ? C.green : C.red;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const txt = d.unit === "pp" ? `${up ? "+" : ""}${d.v} pp` : `${up ? "+" : ""}${d.v}%`;
  return (
    <span className="inline-flex items-center gap-0.5 font-semibold whitespace-nowrap" style={{ fontSize: size, color }}>
      <Icon size={size} /> {txt}
    </span>
  );
}

export function Def({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle">
      <HelpCircle size={11} style={{ color: C.textDim }} className="cursor-help shrink-0" />
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-50 w-[250px] rounded-xl border px-3 py-2.5 leading-snug shadow-xl"
        style={{ fontSize: S.micro, borderColor: C.border, backgroundColor: C.card, color: C.textBody }}>
        {text}
      </span>
    </span>
  );
}

/** A band. The question is the heading; everything under it is the answer.
 *  No border, no background — the hairline above and the space around it do
 *  the separating. */
export function Band({ question, sub, aside, children }: {
  question: string; sub?: string; aside?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section style={{ paddingTop: S.bandGap }}>
      <div className="flex items-baseline gap-4 flex-wrap pb-5" style={{ borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
        <h2 className="font-semibold tracking-tight" style={{ fontSize: 17, color: C.textPrimary }}>{question}</h2>
        {sub && <span style={{ fontSize: 12.5, color: C.textMuted }}>{sub}</span>}
        <div className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The first section of a tab: same heading treatment, no hairline above it
 *  (nothing to separate from). */
export function Opening({ question, sub, aside, children }: {
  question: string; sub?: string; aside?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="pt-7">
      <div className="flex items-baseline gap-4 flex-wrap pb-5">
        <h2 className="font-semibold tracking-tight" style={{ fontSize: 17, color: C.textPrimary }}>{question}</h2>
        {sub && <span style={{ fontSize: 12.5, color: C.textMuted }}>{sub}</span>}
        <div className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Eyebrow({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="font-semibold uppercase tracking-wider mb-4" style={{ fontSize: S.label, color: C.textMuted }}>
      {children}
      {note && <span className="font-normal normal-case tracking-normal" style={{ color: C.textDim }}> · {note}</span>}
    </div>
  );
}

export function Drill({ label }: { label: string }) {
  return (
    <button className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: 11.5, color: gold }}>
      {label} <ArrowRight size={11} />
    </button>
  );
}

/** The caveat line. Everywhere a number needed a qualifier the qualifier is
 *  rendered, never dropped — that is the difference between this mock and
 *  the live dashboard. */
export function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-5" style={{ fontSize: 11, color: C.textDim, lineHeight: 1.55, maxWidth: 820 }}>{children}</p>;
}

export const ICONS = { in: Share2, dm: MessageSquare, email: Mail, call: Phone } as const;
export const ICOLOR = { in: C.linkedin, dm: C.linkedin, email: C.email, call: C.phone } as const;
export type IconKey = keyof typeof ICONS;

/* ── filters ────────────────────────────────────────────────────────────── */

export function Pick({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const on = value !== options[0];
  return (
    <div className="relative">
      <div className="inline-flex items-center rounded-full border overflow-hidden"
        style={{ borderColor: on ? gold : C.border, backgroundColor: on ? `color-mix(in srgb, ${gold} 10%, transparent)` : "transparent" }}>
        <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 font-medium max-w-[180px]"
          style={{ fontSize: 12.5, color: on ? gold : C.textBody }}>
          <span className="truncate">{on ? value : label}</span>
          <ChevronDown size={12} className="shrink-0" />
        </button>
        {on && (
          <button onClick={() => onChange(options[0])} aria-label={`Clear ${label}`} className="pr-2.5 pl-1 py-1" style={{ color: gold }}>
            <X size={11} />
          </button>
        )}
      </div>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1.5 min-w-[220px] rounded-2xl border py-1.5 shadow-xl left-0"
            style={{ borderColor: C.border, backgroundColor: C.card }}>
            {options.map(o => (
              <button key={o} onClick={() => { onChange(o); setOpen(false); }} className="flex items-center gap-2 w-full text-left px-3.5 py-1.5"
                style={{ fontSize: 12.5, color: o === value ? gold : C.textBody }}>
                <span className="w-3 shrink-0">{o === value && <Check size={11} />}</span>
                <span className="truncate">{o}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── ranked rows ─────────────────────────────────────────────────────────
   Not a table. No column headers, no rules: the name, the bar, the rate.
   Volume is the quiet line under the name, because it is context for the
   rate rather than a number to compare on its own. */

export function Ranked({ rows, note, unit = "contacted" }: {
  rows: Array<{ name: string; contacted: number; replies: number; rate: number }>;
  note?: React.ReactNode;
  unit?: string;
}) {
  const best = Math.max(...rows.map(r => r.rate), 1);
  return (
    <div>
      <div className="flex flex-col" style={{ gap: 15 }}>
        {rows.map(r => (
          <div key={r.name} className="flex items-center gap-4">
            <div className="w-[176px] shrink-0 min-w-0">
              <div className="font-medium truncate" style={{ fontSize: 13, color: C.textPrimary }}>{r.name}</div>
              <div className="tabular-nums" style={{ fontSize: 11, color: C.textDim }}>
                {r.replies} of {n(r.contacted)} {unit}
              </div>
            </div>
            <div className="flex-1 h-1.5 rounded-full min-w-[40px]" style={{ backgroundColor: C.surface }}>
              <div className="h-full rounded-full" style={{ width: `${(r.rate / best) * 100}%`, backgroundColor: gold, opacity: .9 }} />
            </div>
            <span className="w-[46px] shrink-0 text-right font-semibold tabular-nums" style={{ fontSize: 15, color: C.textPrimary }}>
              {r.rate}%
            </span>
          </div>
        ))}
      </div>
      {note && <Note>{note}</Note>}
    </div>
  );
}

/** A horizontal stack of channel volumes. Same swatch order everywhere in
 *  the mock so the reader learns it once. */
export const CH_COLOR: Record<string, string> = {
  li_cr: "#5B9BD5",
  li_dm: "#0A66C2",
  email: "#D97757",
  call: "#E0A32E",
};
export const CH_LABEL: Record<string, string> = {
  li_cr: "LinkedIn invite",
  li_dm: "LinkedIn DM",
  email: "Email",
  call: "Call",
};
export const CH_ICON: Record<string, React.ElementType> = {
  li_cr: UserPlus, li_dm: MessageSquare, email: Mail, call: Phone,
};

/** The channel mark: the icon in its own tinted tile. Used wherever a
 *  channel is the subject rather than a segment of a bar. */
export function ChannelMark({ ch, size = 34 }: { ch: string; size?: number }) {
  const Icon = CH_ICON[ch] ?? Mail;
  const c = CH_COLOR[ch] ?? C.textMuted;
  return (
    <span className="inline-flex items-center justify-center rounded-xl shrink-0"
      style={{ width: size, height: size, backgroundColor: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}>
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

/** Two figures on one line: the big count and what it was out of. */
export function Stat({ value, label, sub, color, size = 26 }: {
  value: string | number; label: string; sub?: string; color?: string; size?: number;
}) {
  return (
    <div className="min-w-0">
      <div className="font-semibold tabular-nums truncate" style={{ fontSize: size, letterSpacing: "-0.02em", color: color ?? C.textPrimary }}>
        {typeof value === "number" ? n(value) : value}
      </div>
      <div className="truncate" style={{ fontSize: 11, color: C.textMuted }}>{label}</div>
      {sub && <div className="tabular-nums truncate" style={{ fontSize: 10.5, color: C.textDim }}>{sub}</div>}
    </div>
  );
}

/** Outcome mix as one stacked hairline plus its key. */
export const TONE: Record<string, string> = {
  good: "#22C55E", info: "#38BDF8", neutral: "#E0A32E", bad: "#C0553F", muted: "#5C6478", warn: "#E08A1E",
};

export function OutcomeBar({ rows, height = 7 }: {
  rows: { label: string; n: number; tone: string }[]; height?: number;
}) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (total === 0) return <div className="rounded-full" style={{ height, backgroundColor: C.surface }} />;
  return (
    <div className="flex rounded-full overflow-hidden" style={{ height, backgroundColor: C.surface }}>
      {rows.filter(r => r.n > 0).map(r => (
        <div key={r.label} title={`${r.label} · ${r.n}`} style={{ width: `${(r.n / total) * 100}%`, backgroundColor: TONE[r.tone] ?? C.textDim }} />
      ))}
    </div>
  );
}

export function ChannelBar({ mix, total, height = 6 }: {
  mix: Record<string, number>; total: number; height?: number;
}) {
  const keys = ["li_cr", "li_dm", "email", "call"].filter(k => (mix[k] ?? 0) > 0);
  if (total === 0) return <div className="rounded-full" style={{ height, backgroundColor: C.surface }} />;
  return (
    <div className="flex rounded-full overflow-hidden" style={{ height, backgroundColor: C.surface }}>
      {keys.map(k => (
        <div key={k} title={`${CH_LABEL[k]} · ${n(mix[k])}`} style={{ width: `${(mix[k] / total) * 100}%`, backgroundColor: CH_COLOR[k] }} />
      ))}
    </div>
  );
}

export function ChannelLegend({ keys = ["li_cr", "li_dm", "email", "call"] }: { keys?: string[] }) {
  return (
    <div className="flex flex-wrap items-center" style={{ gap: 16 }}>
      {keys.map(k => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="rounded-sm shrink-0" style={{ width: 8, height: 8, backgroundColor: CH_COLOR[k] }} />
          <span style={{ fontSize: 11, color: C.textMuted }}>{CH_LABEL[k]}</span>
        </span>
      ))}
    </div>
  );
}

/** The banner used once per tab, at most, for the single thing worth saying
 *  out loud. Facts only — each line a measurement with its base. */
export function WorthALook({ title, facts }: { title: string; facts: string[] }) {
  return (
    <div className="rounded-2xl px-7 py-6"
      style={{
        background: `linear-gradient(115deg, color-mix(in srgb, ${gold} 8%, ${C.card}) 0%, ${C.card} 60%)`,
        border: `1px solid color-mix(in srgb, ${gold} 24%, transparent)`,
      }}>
      <div className="font-semibold uppercase tracking-wider mb-3" style={{ fontSize: S.label, color: gold }}>Worth a look</div>
      <p className="font-semibold tracking-tight mb-4" style={{ fontSize: 22, lineHeight: 1.3, color: C.textPrimary, letterSpacing: "-0.018em" }}>
        {title}
      </p>
      <ul className="flex flex-col" style={{ gap: 7 }}>
        {facts.map((f, i) => (
          <li key={i} className="flex items-baseline gap-2.5">
            <span className="shrink-0 rounded-full" style={{ width: 4, height: 4, backgroundColor: gold, transform: "translateY(-2px)" }} />
            <span style={{ fontSize: 13, color: C.textBody, lineHeight: 1.5 }}>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rows the screen deliberately isn't ranking — kept visible rather than
 *  filtered away, so nothing silently disappears from a list. */
export function Excluded({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 pt-4 flex items-baseline gap-2 flex-wrap" style={{ borderTop: `1px dashed ${C.border}` }}>
      <span className="font-semibold uppercase tracking-wider shrink-0" style={{ fontSize: 9.5, color: C.textDim }}>Not ranked</span>
      <span style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}
