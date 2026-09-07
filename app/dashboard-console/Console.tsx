"use client";

// ─────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC CONSOLE — new Overview proposal, built from scratch.
// Mock only: no query, no write, static data in ./data.ts. Shares nothing
// with the earlier mock and nothing with the live dashboard except tokens.
//
// THE IDEA
// The screen is organised as answers to the questions a manager actually
// arrives with, and the questions are written on the screen. You never have
// to work out what "Contacted" is for — the band above it says what it is
// answering. That removes the interpretation step, which is the step that
// costs the 15 seconds.
//
// THE FORM
// No cards. Full-width bands separated by whitespace and a hairline, with
// the answer set large. A grid of bordered boxes is what makes a dashboard
// read as an admin template; bands with real vertical rhythm read as a
// document that happens to be live.
//
// ONE dominant visualisation — the flow ribbon — and it encodes exactly one
// variable (volume), to scale. The collapse from 2,977 to 104 is the whole
// point of the screen, so it is drawn honestly rather than flattened into
// five equal bars.
// ─────────────────────────────────────────────────────────────────────────

import {
  Share2, Mail, Phone, MessageSquare,
} from "lucide-react";
import { C } from "@/lib/design";
import {
  gold, n, S, Band, DeltaTag, Def, Drill,
} from "./ui";
import * as D from "./data";

const ICONS = { in: Share2, dm: MessageSquare, email: Mail, call: Phone } as const;
const ICOLOR = { in: C.linkedin, dm: C.linkedin, email: C.email, call: C.phone } as const;

/* ═══ THE ANSWER LINE ═════════════════════════════════════════════════════
   Not a KPI row. Three figures on one baseline, joined by the rate that
   converts one into the next — so the sentence reads left to right and the
   rates are attached to the transition they describe rather than floating
   in a card of their own. */

/* ═══ THE FLOW ═══════════════════════════════════════════════════════════
   Three stages, because only these three nest inside the period. Leads
   loaded and enrolled during the window are NOT supersets of the leads
   contacted — most contacted leads were loaded earlier — so a period funnel
   that included them would be arithmetically wrong. They sit in Workspace.

   Wording is neutral throughout: a lead that has not replied has not
   replied. Nothing in the data says it is lost. */

function Flow() {
  const st = D.funnel.stages;
  const W = 1180, H = 232, TOP = 30, BODY = 118;
  const max = st[0].n;
  const colW = W / st.length;
  const hOf = (v: number) => (v === 0 ? 0 : Math.max((v / max) * BODY, 1.5));
  const xOf = (i: number) => i * colW + colW / 2;
  const pts = st.map((x, i) => ({ x: xOf(i), h: hOf(x.n), cy: TOP + BODY / 2 }));
  const ribbon = `${pts.map(p => `${p.x},${p.cy - p.h / 2}`).join(" ")} ${[...pts].reverse().map(p => `${p.x},${p.cy + p.h / 2}`).join(" ")}`;
  const wedges = st.slice(1).map((x, i) => {
    const a = pts[i], b = pts[i + 1];
    return { i: i + 1, d: `M ${a.x},${a.cy + a.h / 2} L ${b.x},${b.cy + b.h / 2} L ${b.x},${b.cy + a.h / 2} Z` };
  });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 232 }} role="img"
        aria-label="Leads contacted, replied and positive within the selected period">
        <defs>
          <linearGradient id="flowgrad" x1="0" x2="1">
            <stop offset="0%" stopColor={gold} stopOpacity=".62" />
            <stop offset="100%" stopColor={gold} stopOpacity=".88" />
          </linearGradient>
        </defs>
        {wedges.map(w => <path key={w.i} d={w.d} fill={C.border2} opacity=".4" />)}
        <polygon points={ribbon} fill="url(#flowgrad)" />
        {st.map((x, i) => {
          const p = pts[i], zero = x.n === 0;
          return (
            <g key={x.key}>
              <line x1={p.x} x2={p.x} y1={TOP - 10} y2={TOP + BODY + 8} stroke={C.border} strokeWidth="1" />
              <circle cx={p.x} cy={p.cy} r={3} fill={zero ? C.border2 : gold} stroke={C.card} strokeWidth="1.5" />
              {/* The funnel now carries the headline figures. There is no
                  separate KPI row above it: contacted / replied / positive
                  were appearing twice on the same screen. */}
              <text x={p.x} y={TOP + BODY + 48} textAnchor="middle" className="tabular-nums"
                style={{ fill: zero ? C.textMuted : C.textPrimary, fontSize: 42, fontWeight: 600, letterSpacing: "-0.03em" }}>
                {n(x.n)}
              </text>
              <text x={p.x} y={TOP + BODY + 70} textAnchor="middle"
                style={{ fill: C.textBody, fontSize: 13 }}>{x.label}</text>
            </g>
          );
        })}
        {st.slice(1).map((x, i) => (
          <text key={x.key} x={(pts[i].x + pts[i + 1].x) / 2} y={TOP - 12} textAnchor="middle" className="tabular-nums"
            style={{ fill: C.textMuted, fontSize: 13, fontWeight: 600 }}>
            {((x.n / st[i].n) * 100).toFixed(1)}%
          </text>
        ))}
      </svg>

      {/* deltas as HTML under the svg, aligned to the stage columns */}
      <div className="flex" style={{ marginTop: -6 }}>
        {st.map(x => (
          <div key={x.key} className="flex-1 flex justify-center" style={{ minHeight: 18 }}>
            {x.delta ? <DeltaTag d={x.delta} size={12} />
              : <span style={{ fontSize: 11, color: C.textDim }}>{x.n === 0 ? "no comparison" : ""}</span>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-10 gap-y-2 mt-5">
        {D.funnel.notAdvanced.map(x => (
          <p key={x.text} style={{ fontSize: 12.5, color: C.textBody }}>
            <strong className="tabular-nums" style={{ color: C.textPrimary }}>{n(x.n)}</strong> {x.text}
          </p>
        ))}
      </div>
      <p className="mt-3" style={{ fontSize: 11, color: C.textDim, maxWidth: 760 }}>
        Every stage is the same cohort filtered further, so the chain is a strict subset. Ribbon height is to scale. {D.funnel.cohortNote}
      </p>
    </div>
  );
}

/* ═══ CHANNELS ═══════════════════════════════════════════════════════════
   Two groups, and the difference between them is stated rather than implied.
   A reply rate and an acceptance rate are not the same measurement, so they
   never share a scale, a bar, or a column. */

function Channels() {
  const best = Math.max(...D.replyRates.rows.map(r => r.rate));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12" style={{ gap: 48 }}>
      <div className="lg:col-span-7">
        <div className="flex items-baseline gap-2 mb-5">
          <span className="font-semibold uppercase tracking-wider" style={{ fontSize: S.label, color: C.textPrimary }}>{D.replyRates.title}</span>
          <span style={{ fontSize: 11, color: C.textDim }}>{D.replyRates.note}</span>
        </div>
        <div className="flex flex-col" style={{ gap: 24 }}>
          {D.replyRates.rows.map(r => {
            const Icon = ICONS[r.icon];
            const lead = r.rate === best;
            return (
              <div key={r.key}>
                <div className="flex items-baseline gap-3">
                  <Icon size={14} style={{ color: ICOLOR[r.icon] }} className="self-center shrink-0" />
                  <span className="font-semibold" style={{ fontSize: 14, color: C.textPrimary }}>{r.label}</span>
                  <div className="flex-1" />
                  <span className="font-semibold tabular-nums" style={{ fontSize: S.major, letterSpacing: "-0.025em", color: C.textPrimary }}>{r.rate}%</span>
                  <DeltaTag d={r.delta} size={12} />
                </div>
                <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ backgroundColor: C.surface }}>
                  <div className="h-full rounded-full" style={{ width: `${(r.rate / best) * 100}%`, backgroundColor: lead ? gold : C.border2 }} />
                </div>
                <div className="mt-1.5 tabular-nums" style={{ fontSize: 11.5, color: C.textDim }}>
                  {r.replies} of {n(r.reached)} leads reached · {n(r.sent)} messages sent
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="lg:col-span-5 lg:pl-11" style={{ borderLeft: `1px solid ${C.border}` }}>
        <div className="flex items-baseline gap-2 mb-5">
          <span className="font-semibold uppercase tracking-wider" style={{ fontSize: S.label, color: C.textMuted }}>{D.otherChannel.title}</span>
        </div>
        <p className="mb-5" style={{ fontSize: 11, color: C.textDim }}>{D.otherChannel.note}</p>
        <div className="flex flex-col" style={{ gap: 22 }}>
          {D.otherChannel.rows.map(r => {
            const Icon = ICONS[r.icon];
            return (
              <div key={r.key}>
                <div className="flex items-baseline gap-2">
                  <Icon size={13} style={{ color: ICOLOR[r.icon] }} className="self-center shrink-0" />
                  <span className="font-medium" style={{ fontSize: 12.5, color: C.textBody }}>{r.label}</span>
                  <div className="flex-1" />
                  <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textPrimary }}>{r.value}%</span>
                </div>
                <div className="tabular-nums mt-1" style={{ fontSize: 11.5, color: C.textDim }}>
                  {n(r.num)} of {n(r.den)} {r.unit} · {r.basis}
                </div>
                <div className="mt-0.5" style={{ fontSize: 10.5, color: C.textDim }}>{r.caveat}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══ THE LINKEDIN NOTE ══════════════════════════════════════════════════
   Three sentences, each one a measurement with its numerator and its base.
   No claim about cause, about what a lead is reachable on, or about which
   step is "the constraint" — the data supports none of those. */

function LinkedInNote() {
  return (
    <div className="rounded-2xl px-7 py-6"
      style={{ background: `linear-gradient(115deg, color-mix(in srgb, ${gold} 8%, ${C.card}) 0%, ${C.card} 60%)`,
               border: `1px solid color-mix(in srgb, ${gold} 24%, transparent)` }}>
      <div className="font-semibold uppercase tracking-wider mb-3" style={{ fontSize: S.label, color: gold }}>Worth a look</div>
      <p className="font-semibold tracking-tight mb-4" style={{ fontSize: 22, lineHeight: 1.3, color: C.textPrimary, letterSpacing: "-0.018em" }}>
        {D.linkedinNote.title}
      </p>
      <ul className="flex flex-col" style={{ gap: 7 }}>
        {D.linkedinNote.facts.map((f, i) => (
          <li key={i} className="flex items-baseline gap-2.5">
            <span className="shrink-0 rounded-full" style={{ width: 4, height: 4, backgroundColor: gold, transform: "translateY(-2px)" }} />
            <span style={{ fontSize: 13, color: C.textBody, lineHeight: 1.5 }}>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ═══ WHO IS PERFORMING ═══════════════════════════════════════════════════
   Ranked rows, not a table. No column headers, no rules: the name, the bar,
   the rate. Volume is the quiet line under the name, because it is context
   for the rate rather than a number to compare on its own. */

function Ranked({ rows, note }: {
  rows: Array<{ name: string; contacted: number; replies: number; rate: number }>;
  note: React.ReactNode;
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
                {r.replies} of {n(r.contacted)} contacted
              </div>
            </div>
            <div className="flex-1 h-1.5 rounded-full min-w-[40px]" style={{ backgroundColor: C.surface }}>
              <div className="h-full rounded-full" style={{ width: `${(r.rate / best) * 100}%`, backgroundColor: gold, opacity: .9 }} />
            </div>
            <span className="w-[46px] shrink-0 text-right font-semibold tabular-nums" style={{ fontSize: 15, color: C.textPrimary }}>{r.rate}%</span>
          </div>
        ))}
      </div>
      <p className="mt-5" style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>{note}</p>
    </div>
  );
}

/* ═══ QUIET DETAIL ═══════════════════════════════════════════════════════ */

/** Reply quality. The unit is stated twice — in the figure line and in the
 *  note — because "81 replies" and "66 leads" are both true and a reader who
 *  compares one against the funnel's 66 has to be able to reconcile them. */
function ReplyQuality() {
  const q = D.replyQuality;
  const max = Math.max(...q.rows.map(r => r.n), 1);
  const tone = { info: C.blue, bad: C.red, neutral: C.yellow, good: C.green, muted: C.textDim } as const;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textPrimary }}>{q.events}</span>
        <span style={{ fontSize: 12, color: C.textMuted }}>reply events</span>
        <span style={{ fontSize: 12, color: C.textDim }}>·</span>
        <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textBody }}>{q.leads}</span>
        <span style={{ fontSize: 12, color: C.textMuted }}>leads</span>
      </div>
      <p className="mb-4" style={{ fontSize: 11, color: C.textDim }}>{q.note}</p>
      <div className="flex flex-col" style={{ gap: 11 }}>
        {q.rows.map(r => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-[92px] shrink-0" style={{ fontSize: 12.5, color: r.n === 0 ? C.textDim : C.textBody }}>{r.label}</span>
            <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.surface }}>
              {r.n > 0 && <div className="h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, backgroundColor: tone[r.tone], opacity: .85 }} />}
            </div>
            <span className="w-[24px] shrink-0 text-right tabular-nums font-semibold"
              style={{ fontSize: 12.5, color: r.n === 0 ? C.textDim : C.textPrimary }}>{r.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Trend() {
  const { sent, replies, prior, totals } = D.activity;
  const W = 720, H = 132, P = 5;
  const maxS = Math.max(...sent, ...prior, 1), maxR = Math.max(...replies, 1);
  const line = (d: number[], m: number) => d.map((v, i) => `${P + (i / (d.length - 1)) * (W - P * 2)},${H - P - (v / m) * (H - P * 2)}`).join(" ");
  return (
    <div>
      <div className="flex items-baseline gap-5 mb-3 flex-wrap">
        <span className="inline-flex items-baseline gap-1.5">
          <span className="w-2 h-2 rounded-full self-center" style={{ backgroundColor: C.blue }} />
          <span style={{ fontSize: 11.5, color: C.textMuted }}>sent</span>
          <span className="tabular-nums font-semibold" style={{ fontSize: 13, color: C.textPrimary }}>{n(totals.sent)}</span>
        </span>
        <span className="inline-flex items-baseline gap-1.5">
          <span className="w-2 h-2 rounded-full self-center" style={{ backgroundColor: gold }} />
          <span style={{ fontSize: 11.5, color: C.textMuted }}>replies</span>
          <span className="tabular-nums font-semibold" style={{ fontSize: 13, color: C.textPrimary }}>{totals.replies}</span>
        </span>
        <span style={{ fontSize: 11, color: C.textDim }}>dashed = previous period</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 132 }} role="img" aria-label="Sends and replies over the period">
        <polyline points={line(prior, maxS)} fill="none" stroke={C.textDim} strokeWidth="1.3" strokeDasharray="5 4" opacity=".5" />
        <polyline points={line(sent, maxS)} fill="none" stroke={C.blue} strokeWidth="1.9" />
        <polyline points={line(replies, maxR)} fill="none" stroke={gold} strokeWidth="1.9" />
      </svg>
    </div>
  );
}

function Timing() {
  const t = D.timing;
  const max = Math.max(...t.grid.flat(), 1);
  const totals = t.grid.map(r => r.reduce((a, b) => a + b, 0));
  const bestDay = totals.indexOf(Math.max(...totals));
  const grand = t.grid.flat().reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="flex gap-1.5 mb-1.5" style={{ paddingLeft: 42 }}>
        {t.blocks.map(b => <span key={b} className="flex-1 text-center tabular-nums" style={{ fontSize: 11, color: C.textMuted }}>{b}</span>)}
        <span style={{ width: 34 }} />
      </div>
      {t.grid.map((row, i) => (
        <div key={t.days[i]} className="flex items-center gap-1.5 mb-1.5">
          <span className="shrink-0" style={{ width: 38, fontSize: 11.5, color: i === bestDay ? C.textPrimary : C.textMuted }}>{t.days[i]}</span>
          {row.map((v, j) => (
            <div key={j} className="flex-1 rounded-md flex items-center justify-center" title={`${t.days[i]} ${t.blocks[j]} · ${v} replies`}
              style={{ height: 30, backgroundColor: v === 0 ? C.surface : `color-mix(in srgb, ${gold} ${Math.round((v / max) * 76) + 7}%, transparent)` }}>
              <span className="tabular-nums" style={{ fontSize: 11, color: v === 0 ? C.textDim : (v / max) > .55 ? "#3A2E08" : C.textBody }}>{v || ""}</span>
            </div>
          ))}
          <span className="shrink-0 text-right tabular-nums font-semibold" style={{ width: 34, fontSize: 12, color: i === bestDay ? gold : C.textDim }}>{totals[i]}</span>
        </div>
      ))}
      <p className="mt-2" style={{ fontSize: 11, color: C.textDim }}>
        Peak Mon 12–15. All {grand} replies shown — weekends and out-of-hours included.
      </p>
    </div>
  );
}

/** Workspace stock. Kept out of the funnel on purpose: these counts are not
 *  a superset of the leads contacted in the window, so nesting them would be
 *  wrong arithmetic. Each row states its own window. */
/** Workspace. Three parts that add up to the total, so the bar is readable
 *  and the numbers check against each other. Intake is stated separately
 *  because it is a different window and does not belong in the partition. */
function Workspace() {
  const w = D.workspace;
  const shade = [gold, `color-mix(in srgb, ${gold} 36%, transparent)`, C.border2];
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4 flex-wrap">
        <span className="font-semibold tabular-nums" style={{ fontSize: 26, letterSpacing: "-0.02em", color: C.textPrimary }}>{n(w.total)}</span>
        <span style={{ fontSize: 13, color: C.textBody }}>leads in the workspace</span>
        <div className="flex-1" />
        <span className="tabular-nums" style={{ fontSize: 11.5, color: C.textDim }}>
          {n(w.intake.n)} {w.intake.label}
        </span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: C.surface }}>
        {w.parts.map((x, i) => (
          <div key={x.label} style={{ width: `${(x.n / w.total) * 100}%`, backgroundColor: shade[i] }} />
        ))}
      </div>
      <div className="flex flex-wrap mt-3.5" style={{ gap: 30 }}>
        {w.parts.map((x, i) => (
          <div key={x.label} className="flex items-baseline gap-2">
            <span className="rounded-sm shrink-0" style={{ width: 8, height: 8, backgroundColor: shade[i] }} />
            <span className="font-semibold tabular-nums" style={{ fontSize: 15, color: C.textBody }}>{n(x.n)}</span>
            <span style={{ fontSize: 12, color: C.textMuted }}>{x.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ the tab body ══════════════════════════════════════════════════════
   The page chrome — title, tab bar, period and filter controls — lives in
   Shell.tsx now, shared with the other five tabs. This file is only the
   Overview's own content. */

export default function Overview({ label }: { label: string }) {
  return (
    <>
      {/* The flow IS the opening. It already carries contacted, replied and
          positive at full size, so a KPI row above it was the same three
          numbers twice — the duplication Fran caught on 2026-09-07. */}
      <section className="pt-7">
        <div className="flex items-baseline gap-4 flex-wrap pb-1">
          <h2 className="font-semibold tracking-tight" style={{ fontSize: 17, color: C.textPrimary }}>Where do the leads go?</h2>
          <span style={{ fontSize: 12.5, color: C.textMuted }}>in {label}</span>
          <div className="flex-1" />
          <Drill label="Campaigns" />
        </div>
        <Flow />
        {/* The list the period's numbers came out of. Directly under the
            funnel because that is the question it answers next, and quiet
            because it is stock, not performance. */}
        <div className="mt-10 pt-6" style={{ borderTop: `1px solid ${C.border}` }}>
          <Workspace />
        </div>
      </section>

      <Band question="Which channel earns a reply?" aside={<Drill label="Channels" />}>
        <Channels />
      </Band>

      <section style={{ paddingTop: 44 }}>
        <LinkedInNote />
      </section>

      <Band question="Who is performing?" aside={<Drill label="Sellers" />}>
        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 52 }}>
          <div>
            <div className="font-semibold uppercase tracking-wider mb-4" style={{ fontSize: S.label, color: C.textMuted }}>Campaigns <span className="font-normal normal-case tracking-normal" style={{ color: C.textDim }}>· sorted by {D.rankedBy.toLowerCase()}</span></div>
            <Ranked rows={D.campaigns} note={D.campaignsNote} />
          </div>
          <div className="lg:pl-10" style={{ borderLeft: `1px solid ${C.border}` }}>
            <div className="font-semibold uppercase tracking-wider mb-4" style={{ fontSize: S.label, color: C.textMuted }}>Sellers <span className="font-normal normal-case tracking-normal" style={{ color: C.textDim }}>· sorted by {D.rankedBy.toLowerCase()}</span></div>
            <Ranked rows={D.sellers} note={D.sellersNote} />
          </div>
        </div>
      </Band>

      <Band question="What else is worth knowing?">
        {/* Two rows rather than three columns: at a third of the width each
            chart was legible but cramped, and none of them was the reason
            you came to the page. Wider is easier to read; lower down keeps
            them secondary. */}
        <div className="grid grid-cols-1 lg:grid-cols-12" style={{ gap: 48 }}>
          <div className="lg:col-span-5">
            <div className="font-semibold uppercase tracking-wider mb-5" style={{ fontSize: S.label, color: C.textMuted }}>
              Reply quality <Def text="Inbound replies only. A logged call outcome is not a reply." />
            </div>
            <ReplyQuality />
          </div>
          <div className="lg:col-span-7 lg:pl-11" style={{ borderLeft: `1px solid ${C.border}` }}>
            <div className="font-semibold uppercase tracking-wider mb-5" style={{ fontSize: S.label, color: C.textMuted }}>Activity</div>
            <Trend />
          </div>
        </div>

        <div className="mt-14 pt-9" style={{ borderTop: `1px solid ${C.border}` }}>
          <div className="font-semibold uppercase tracking-wider mb-5" style={{ fontSize: S.label, color: C.textMuted }}>When they reply</div>
          <Timing />
        </div>
      </Band>
    </>
  );
}
