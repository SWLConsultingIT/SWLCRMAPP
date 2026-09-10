"use client";

// ─────────────────────────────────────────────────────────────────────────
// SELLERS — the team control centre, tuned for reading speed.
//
// Same six-level architecture as the last pass. What changed is the amount
// of work the reader has to do:
//
//   · Team Health is one homogeneous row of six, with the two results
//     underneath. No KPIs floating off to the right in a different size.
//   · Three alerts, ordered by severity, the rest behind "View all".
//   · The performance table is banded into three weights — who and what
//     came back (primary) · what went out (secondary) · operations. Column
//     labels say what is being counted: "LI sent", not "LinkedIn".
//   · Positive Rate is gone. One positive in the period makes 0.1% and
//     0.0% false precision; the count is the honest figure until volume
//     supports a rate.
//   · Consistency answers its question in words — Burst-heavy / Steady /
//     Sporadic — with the numbers that produce the label beside it.
//   · Four insights, each a label and a value.
//
// The data rules are unchanged: a call outcome is never a reply, contacted
// means at least one message actually sent, and the one reply that cannot
// be attributed is reported on its own rather than spread across the rows.
// ─────────────────────────────────────────────────────────────────────────

import { Fragment, useState } from "react";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { C } from "@/lib/design";
import { gold, n, Band, Opening, Drill, Eyebrow, CH_COLOR, TONE } from "./ui";
import type * as CT from "@/lib/console-data";
import { useT } from "./ctx";

const days = (a: number[]) => a.filter(v => v > 0).length;

/** Steady, bursty or absent — derived, not asserted. */
function rhythm(sent: number[], total: number) {
  const T = useT();
  const active = days(sent);
  const peak = Math.max(...sent, 0);
  const share = total > 0 ? peak / total : 0;
  if (share >= 0.5) return { label: "Burst-heavy", tone: C.orange, peak, share };
  if (active <= T.WINDOW_DAYS / 3) return { label: "Sporadic", tone: C.orange, peak, share };
  return { label: "Steady", tone: C.textMuted, peak, share };
}

/* ═══ 1 · TEAM HEALTH ═════════════════════════════════════════════════════ */

function TeamHealth() {
  const T = useT();
  const h = T.teamHealth;
  const [all, setAll] = useState(false);
  const shown = all ? T.teamAlerts : T.teamAlerts.slice(0, 3);

  const MAIN = [
    { v: `${h.activeSellers}/${h.totalSellers}`, l: "Sellers active" },
    { v: n(h.contacted), l: "Leads contacted" },
    { v: n(h.sent), l: "Messages sent" },
    { v: n(h.calls), l: "Calls attempted" },
    { v: `${h.replyRate}%`, l: "Reply rate" },
    { v: h.connectRate == null ? "—" : `${h.connectRate}%`, l: "Confirmed connect rate" },
  ];

  return (
    <div>
      {/* one row, six equal cells, one size */}
      <div className="grid grid-cols-3 lg:grid-cols-6" style={{ gap: "20px 24px" }}>
        {MAIN.map(m => (
          <div key={m.l} className="min-w-0">
            <div className="font-semibold tabular-nums truncate" style={{ fontSize: 28, letterSpacing: "-0.03em", color: C.textPrimary }}>{m.v}</div>
            <div className="truncate" style={{ fontSize: 11, color: C.textMuted }}>{m.l}</div>
          </div>
        ))}
      </div>

      {/* results, one line, clearly downstream of the row above */}
      <div className="flex items-baseline flex-wrap mt-5 pt-4" style={{ gap: 30, borderTop: `1px solid ${C.border}` }}>
        <span className="font-semibold uppercase tracking-wider shrink-0" style={{ fontSize: 9.5, color: C.textMuted }}>Results</span>
        <span className="inline-flex items-baseline gap-2">
          <span className="font-semibold tabular-nums" style={{ fontSize: 22, color: gold }}>{n(h.replies)}</span>
          <span style={{ fontSize: 12, color: C.textBody }}>replies</span>
        </span>
        <span className="inline-flex items-baseline gap-2">
          <span className="font-semibold tabular-nums" style={{ fontSize: 22, color: h.positive > 0 ? C.green : C.textDim }}>{n(h.positive)}</span>
          <span style={{ fontSize: 12, color: C.textBody }}>positive</span>
        </span>
      </div>

      {/* three alerts, the rest on request */}
      <div className="flex flex-wrap items-center mt-5" style={{ gap: 8 }}>
        {shown.map(a => {
          const warn = a.level === "warn";
          return (
            <span key={a.text} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{
                fontSize: 11.5,
                color: warn ? C.orange : C.textBody,
                backgroundColor: warn ? `color-mix(in srgb, ${C.orange} 12%, transparent)` : C.surface,
                border: `1px solid ${warn ? `color-mix(in srgb, ${C.orange} 30%, transparent)` : C.border}`,
              }}>
              {warn && <AlertTriangle size={12} className="shrink-0" />} {a.text}
            </span>
          );
        })}
        {T.teamAlerts.length > 3 && (
          <button onClick={() => setAll(v => !v)} className="font-semibold" style={{ fontSize: 11.5, color: gold }}>
            {all ? "Show less" : `View all ${T.teamAlerts.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══ 2 · SELLER PERFORMANCE ══════════════════════════════════════════════
   Three bands of weight, separated by a hairline rather than a header:
     who / what came back      — primary
     what went out             — secondary
     operations                — quiet, coloured only when it matters */

const PAD = "px-2.5 py-2.5";

/** A header cell. `edge` draws the hairline that separates the three
 *  weight bands — primary / what went out / operations — so the bands read
 *  without a second header row. */
function Th({ children, hint, tone = "primary", edge }: {
  children: React.ReactNode; hint?: string; tone?: "primary" | "secondary" | "ops"; edge?: boolean;
}) {
  return (
    <th className={`${PAD} text-right font-semibold uppercase tracking-wider`}
      title={hint}
      style={{
        fontSize: 9.5,
        color: tone === "primary" ? C.textMuted : C.textDim,
        whiteSpace: "nowrap",
        cursor: hint ? "help" : undefined,
        ...(edge ? EDGE : {}),
      }}>
      {children}
    </th>
  );
}

const EDGE = { borderLeft: `1px solid var(--c-border)` } as const;

function Detail({ s }: { s: CT.Seller }) {
  const T = useT();
  const c = T.sellerCalls.find(x => x.name === s.name)!;
  const d = T.sellerDaily[s.name];
  const mix = [
    { label: "LinkedIn invite", n: s.cr, k: "li_cr" },
    { label: "LinkedIn DM", n: s.dm, k: "li_dm" },
    { label: "Email", n: s.email, k: "email" },
    { label: "Calls", n: s.calls, k: "call" },
  ];
  const mixTotal = mix.reduce((a, x) => a + x.n, 0);
  const outcomes = [
    { label: "Interested", n: c.interested, tone: "good" },
    { label: "Follow up", n: c.followUp, tone: "neutral" },
    { label: "Not interested", n: c.negative, tone: "bad" },
    { label: "Voicemail", n: c.voicemail, tone: "muted" },
    { label: "Wrong number", n: c.wrongNumber, tone: "muted" },
    { label: "No outcome", n: c.unclassified, tone: "warn" },
  ];

  return (
    <tr>
      <td colSpan={9} style={{ padding: 0 }}>
        <div className="mx-2 mb-3 rounded-xl px-6 py-5" style={{ backgroundColor: C.surface }}>
          <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: 40 }}>

            {/* A — channel mix */}
            <div>
              <Eyebrow note={`${n(mixTotal)} actions`}>Channel mix</Eyebrow>
              <div className="flex rounded-full overflow-hidden mb-3" style={{ height: 8, backgroundColor: C.card }}>
                {mix.filter(x => x.n > 0).map(x => (
                  <div key={x.k} title={`${x.label} · ${x.n}`} style={{ width: `${(x.n / mixTotal) * 100}%`, backgroundColor: CH_COLOR[x.k] }} />
                ))}
              </div>
              <div className="flex flex-col" style={{ gap: 6 }}>
                {mix.map(x => (
                  <div key={x.k} className="flex items-baseline gap-2">
                    <span className="rounded-sm shrink-0 self-center" style={{ width: 7, height: 7, backgroundColor: CH_COLOR[x.k] }} />
                    <span style={{ fontSize: 11.5, color: x.n > 0 ? C.textBody : C.textDim }}>{x.label}</span>
                    <div className="flex-1" />
                    <span className="tabular-nums font-semibold" style={{ fontSize: 12.5, color: x.n > 0 ? C.textPrimary : C.textDim }}>
                      {x.n > 0 ? n(x.n) : "—"}
                    </span>
                    <span className="tabular-nums w-[32px] text-right" style={{ fontSize: 10.5, color: C.textDim }}>
                      {x.n > 0 ? `${Math.round((x.n / mixTotal) * 100)}%` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* B — calls */}
            <div>
              <Eyebrow note={c.attempted === 0 ? "none this period" : c.connectRate == null ? "no outcome logged" : `${c.connectRate}% confirmed connect rate`}>Calls</Eyebrow>
              {c.attempted === 0 ? (
                <p style={{ fontSize: 11.5, color: C.textDim }}>No dials in the period.</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-5 mb-3">
                    <span className="inline-flex items-baseline gap-1.5">
                      <span className="tabular-nums font-semibold" style={{ fontSize: 20, color: C.textPrimary }}>{n(c.attempted)}</span>
                      <span style={{ fontSize: 11, color: C.textMuted }}>attempted</span>
                    </span>
                    <span className="inline-flex items-baseline gap-1.5">
                      <span className="tabular-nums font-semibold" style={{ fontSize: 20, color: gold }}>{n(c.connected)}</span>
                      <span style={{ fontSize: 11, color: C.textMuted }}>connected</span>
                    </span>
                  </div>
                  <div className="flex flex-col" style={{ gap: 5 }}>
                    {outcomes.map(o => (
                      <div key={o.label} className="flex items-baseline gap-2">
                        <span className="rounded-sm shrink-0 self-center" style={{ width: 7, height: 7, backgroundColor: TONE[o.tone] }} />
                        <span style={{ fontSize: 11.5, color: o.n > 0 ? C.textBody : C.textDim }}>{o.label}</span>
                        <div className="flex-1" />
                        <span className="tabular-nums font-semibold"
                          style={{ fontSize: 12.5, color: o.n === 0 ? C.textDim : o.tone === "warn" ? C.orange : C.textPrimary }}>
                          {o.n > 0 ? n(o.n) : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* C — activity and backlog */}
            <div>
              <Eyebrow>Activity and backlog</Eyebrow>
              <div className="grid grid-cols-2" style={{ gap: "14px 18px" }}>
                {[
                  { v: `${days(d.sent)} / ${T.WINDOW_DAYS}`, l: "active days" },
                  { v: days(d.calls) > 0 ? `${days(d.calls)} / ${T.WINDOW_DAYS}` : "—", l: "days calling" },
                  { v: s.lastActive, l: "last send" },
                  { v: s.queue > 0 ? n(s.queue) : "—", l: "queued now", accent: s.queue > 500 ? C.orange : undefined },
                ].map(x => (
                  <div key={x.l}>
                    <div className="tabular-nums font-semibold" style={{ fontSize: 16, color: x.accent ?? C.textPrimary }}>{x.v}</div>
                    <div style={{ fontSize: 10.5, color: C.textMuted }}>{x.l}</div>
                  </div>
                ))}
              </div>
              {c.attempted > 0 && (
                <div className="mt-4 pt-3 flex items-baseline gap-4" style={{ borderTop: `1px solid ${C.border}` }}>
                  <span className="inline-flex items-baseline gap-1.5">
                    <span className="tabular-nums font-semibold" style={{ fontSize: 13, color: C.textBody }}>{c.avgSecs}s</span>
                    <span style={{ fontSize: 10.5, color: C.textMuted }}>talk time</span>
                  </span>
                  <span className="inline-flex items-baseline gap-1.5">
                    <span className="tabular-nums font-semibold" style={{ fontSize: 13, color: C.textBody }}>{c.recorded}</span>
                    <span style={{ fontSize: 10.5, color: C.textMuted }}>recorded</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function Performance({ open, setOpen }: { open: string | null; setOpen: (v: string | null) => void }) {
  const T = useT();
  const rows = T.sellers;
  const team = T.teamHealth;
  const bestRate = Math.max(...rows.map(r => r.replyRate));

  return (
    <div>
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full" style={{ minWidth: 840, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th className={`${PAD} text-left font-semibold uppercase tracking-wider`} style={{ fontSize: 9.5, color: C.textMuted }}>Seller</th>
              <Th hint="Leads that received at least one message in the period. Counted once per lead.">Contacted</Th>
              <Th hint="Leads that wrote back. A logged call outcome is never counted as a reply.">Replies</Th>
              <Th hint="Replies ÷ leads contacted, for this seller.">Reply rate</Th>
              <Th tone="secondary" edge hint="LinkedIn actions sent: invitations plus DMs. Not unique leads.">LI sent</Th>
              <Th tone="secondary" hint="Emails sent. Not unique leads.">Email sent</Th>
              <Th tone="secondary" hint="Real dials. Click-to-dial markers are excluded.">Calls</Th>
              <Th tone="ops" edge hint="Replies classified positive or meeting-intent.">Positive</Th>
              <Th tone="ops" hint="Messages waiting inside a flow that is still active. Current stock, not period activity.">Queue</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const on = open === r.name;
              const above = r.replyRate >= team.replyRate;
              return (
                <Fragment key={r.name}>
                  <tr onClick={() => setOpen(on ? null : r.name)}
                    style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer", backgroundColor: on ? C.surface : "transparent" }}>
                    <td className={PAD}>
                      <div className="flex items-center gap-2">
                        <ChevronRight size={13} className="shrink-0"
                          style={{ color: C.textDim, transform: on ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                        <span className="font-medium" style={{ fontSize: 13.5, color: C.textPrimary }}>{r.name}</span>
                      </div>
                    </td>

                    {/* primary */}
                    <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{n(r.contacted)}</td>
                    <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{r.replies}</td>
                    <td className={PAD} style={{ minWidth: 130 }}>
                      <div className="flex items-center gap-2.5 justify-end">
                        <div className="relative flex-1" style={{ maxWidth: 66 }}>
                          <div className="h-2 rounded-full" style={{ backgroundColor: C.surface }}>
                            <div className="h-full rounded-full" style={{ width: `${(r.replyRate / bestRate) * 100}%`, backgroundColor: gold, opacity: above ? .95 : .38 }} />
                          </div>
                          <div aria-hidden className="absolute top-[-3px] bottom-[-3px]"
                            style={{ left: `${(team.replyRate / bestRate) * 100}%`, width: 1, backgroundColor: C.textMuted, opacity: .6 }} />
                        </div>
                        <span className="tabular-nums font-semibold w-[42px] text-right"
                          style={{ fontSize: 14, color: above ? C.textPrimary : C.textMuted }}>{r.replyRate}%</span>
                      </div>
                    </td>

                    {/* secondary — what went out */}
                    <td className={`${PAD} text-right tabular-nums`} style={{ ...EDGE, fontSize: 12, color: C.textMuted }}>{n(r.li)}</td>
                    <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 12, color: C.textMuted }}>{n(r.email)}</td>
                    <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 12, color: r.calls === 0 ? C.textDim : C.textMuted }}>
                      {r.calls > 0 ? n(r.calls) : "—"}
                    </td>

                    {/* operational */}
                    <td className={`${PAD} text-right tabular-nums`}
                      style={{ ...EDGE, fontSize: 12.5, fontWeight: r.positive > 0 ? 600 : 400, color: r.positive > 0 ? C.green : C.textDim }}>
                      {r.positive > 0 ? r.positive : "—"}
                    </td>
                    <td className={`${PAD} text-right tabular-nums`}
                      style={{ fontSize: 12, color: r.queue === 0 ? C.textDim : r.queue > 500 ? C.orange : C.textMuted, fontWeight: r.queue > 500 ? 600 : 400 }}>
                      {r.queue > 0 ? n(r.queue) : "—"}
                    </td>
                  </tr>
                  {on && <Detail s={r} />}
                </Fragment>
              );
            })}

            <tr style={{ borderTop: `2px solid ${C.border}` }}>
              <td className={PAD}><span className="font-semibold" style={{ fontSize: 13, color: gold }}>Team</span></td>
              <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{n(team.contacted)}</td>
              <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{team.replies}</td>
              <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{team.replyRate}%</td>
              <td className={`${PAD} text-right tabular-nums`} style={{ ...EDGE, fontSize: 12, color: C.textMuted }}>{n(rows.reduce((a, s) => a + s.li, 0))}</td>
              <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 12, color: C.textMuted }}>{n(rows.reduce((a, s) => a + s.email, 0))}</td>
              <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 12, color: C.textMuted }}>{n(team.calls)}</td>
              <td className={`${PAD} text-right tabular-nums`} style={{ ...EDGE, fontSize: 12.5, fontWeight: 600, color: C.green }}>{team.positive}</td>
              <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 12, color: C.textMuted }}>{n(team.queue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-5 mt-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 1, height: 10, backgroundColor: C.textMuted, opacity: .6 }} />
          <span style={{ fontSize: 10.5, color: C.textMuted }}>team {team.replyRate}%</span>
        </span>
        <span style={{ fontSize: 10.5, color: C.textDim }}>click a row for the detail</span>
        <div className="flex-1" />
        <span style={{ fontSize: 10.5, color: C.textDim }}>
          {team.unattributedReplies} reply has no seller — not redistributed
        </span>
      </div>
    </div>
  );
}

/* ═══ 3 · COMPARE ═════════════════════════════════════════════════════════ */

const METRICS = [
  { key: "replyRate", label: "Reply rate", unit: "%", team: null },
  { key: "replies", label: "Replies", unit: "", team: null },
  { key: "contacted", label: "Contacted", unit: "", team: null },
  { key: "sent", label: "Messages sent", unit: "", team: null },
  { key: "calls", label: "Calls", unit: "", team: null },
] as const;

function Compare() {
  const T = useT();
  const [m, setM] = useState<(typeof METRICS)[number]["key"]>("replyRate");
  const meta = METRICS.find(x => x.key === m)!;
  const rows = [...T.sellers].sort((a, b) => (b[m] as number) - (a[m] as number));
  const max = Math.max(...rows.map(r => r[m] as number), 1);

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-6">
        {METRICS.map(x => (
          <button key={x.key} onClick={() => setM(x.key)} className="rounded-full px-3 py-1 font-medium"
            style={{
              fontSize: 12.5,
              backgroundColor: m === x.key ? gold : "transparent",
              color: m === x.key ? "#1A1405" : C.textBody,
              border: `1px solid ${m === x.key ? gold : C.border}`,
            }}>
            {x.label}
          </button>
        ))}
        <div className="flex-1" />
        <span style={{ fontSize: 11.5, color: C.textMuted }}>Sorted by {meta.label}</span>
      </div>

      <div className="flex flex-col" style={{ gap: 12 }}>
        {rows.map(r => {
          const v = r[m] as number;
          const above = meta.team !== null && v >= meta.team;
          return (
            <div key={r.name} className="flex items-center gap-3">
              <span className="w-[150px] shrink-0 truncate" style={{ fontSize: 12.5, color: C.textPrimary }}>{r.name}</span>
              <div className="flex-1 relative min-w-[60px]">
                <div className="h-3.5 rounded-full" style={{ backgroundColor: C.surface }}>
                  {v > 0 && (
                    <div className="h-full rounded-full"
                      style={{ width: `${Math.max((v / max) * 100, 1)}%`, backgroundColor: gold, opacity: meta.team === null ? .9 : above ? .95 : .38 }} />
                  )}
                </div>
                {meta.team !== null && (
                  <div aria-hidden className="absolute top-[-3px] bottom-[-3px]"
                    style={{ left: `${max > 0 ? (meta.team / max) * 100 : 0}%`, width: 1, backgroundColor: C.textMuted, opacity: .6 }} />
                )}
              </div>
              <span className="w-[64px] shrink-0 text-right tabular-nums font-semibold"
                style={{ fontSize: 13.5, color: v > 0 ? C.textPrimary : C.textDim }}>
                {v > 0 ? `${meta.unit ? v : n(v)}${meta.unit}` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {meta.team !== null && (
        <div className="inline-flex items-center gap-1.5 mt-4">
          <span style={{ width: 1, height: 10, backgroundColor: C.textMuted, opacity: .6 }} />
          <span style={{ fontSize: 10.5, color: C.textMuted }}>team average {meta.team}{meta.unit}</span>
        </div>
      )}
    </div>
  );
}

/* ═══ 4 · CALLS ═══════════════════════════════════════════════════════════
   Eight columns. Not interested, voicemail, wrong number, talk time and
   recordings live in the seller drill-down. Unclassified is the only
   coloured column, because it is the only operational problem here. */

function Calls() {
  const T = useT();
  const rows = [...T.sellerCalls].sort((a, b) => b.attempted - a.attempted);
  const t = T.sellerCallsTotal;
  const num = (v: number, tone?: string, bold?: boolean) => (
    <td className={`${PAD} text-right tabular-nums`}
      style={{ fontSize: 12.5, fontWeight: bold ? 600 : 400, color: v === 0 ? C.textDim : tone ?? C.textBody }}>
      {v === 0 ? "—" : n(v)}
    </td>
  );
  const unc = (v: number, att: number) => (
    <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 12.5 }}>
      {v === 0 ? <span style={{ color: C.textDim }}>—</span> : (
        <span className="inline-flex items-baseline gap-1.5 rounded-full px-2 py-0.5"
          style={{ fontWeight: 600, color: C.orange, backgroundColor: `color-mix(in srgb, ${C.orange} 13%, transparent)` }}>
          {n(v)}<span style={{ fontSize: 10 }}>{Math.round((v / att) * 100)}%</span>
        </span>
      )}
    </td>
  );
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full" style={{ minWidth: 780, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th className={`${PAD} text-left font-semibold uppercase tracking-wider`} style={{ fontSize: 9.5, color: C.textMuted }}>Seller</th>
            <Th hint="Real dials. Click-to-dial markers are excluded.">Attempted</Th>
            <Th hint="A human conversation happened. Voicemail and wrong number do not count.">Connected</Th>
            <Th hint="Connected ÷ attempted.">Connect rate</Th>
            <Th tone="secondary">Interested</Th>
            <Th tone="secondary" hint="Callback or needs info.">Follow up</Th>
            <Th tone="secondary" hint="Voicemail or wrong number. The split is in the seller detail.">No answer</Th>
            <Th hint="A real dial nobody classified. Still counted in the denominator.">Unclassified</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td className={PAD}>
                <span className="font-medium" style={{ fontSize: 13, color: r.attempted === 0 ? C.textMuted : C.textPrimary }}>{r.name}</span>
                {r.attempted === 0 && <span className="ml-2" style={{ fontSize: 10.5, color: C.textDim }}>no dials</span>}
              </td>
              {num(r.attempted, C.textPrimary, true)}
              {num(r.connected)}
              <td className={`${PAD} text-right tabular-nums font-semibold`}
                style={{ fontSize: 13.5, color: r.attempted === 0 ? C.textDim : C.textPrimary }}>
                {r.attempted === 0 || r.connectRate == null ? "—" : `${r.connectRate}%`}
              </td>
              {num(r.interested, TONE.good, r.interested > 0)}
              {num(r.followUp, TONE.neutral)}
              {num(r.noAnswer, C.textMuted)}
              {unc(r.unclassified, r.attempted)}
            </tr>
          ))}
          <tr style={{ borderTop: `2px solid ${C.border}` }}>
            <td className={PAD}><span className="font-semibold" style={{ fontSize: 13, color: gold }}>Team</span></td>
            {num(t.attempted, C.textPrimary, true)}
            {num(t.connected, C.textBody, true)}
            <td className={`${PAD} text-right tabular-nums font-semibold`} style={{ fontSize: 13.5, color: C.textPrimary }}>{t.connectRate == null ? "—" : `${t.connectRate}%`}</td>
            {num(t.interested, TONE.good, true)}
            {num(t.followUp, TONE.neutral, true)}
            {num(t.noAnswer, C.textMuted, true)}
            {unc(t.unclassified, t.attempted)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ═══ 5 · CONSISTENCY ═════════════════════════════════════════════════════
   The question answered in words, with the two numbers that produce the
   answer beside it. The sparkline is there to confirm the label, not to be
   decoded. */

function Spark({ sent, calls }: { sent: number[]; calls: number[] }) {
  const maxS = Math.max(...sent, 1), maxC = Math.max(...calls, 1);
  return (
    <div className="flex items-stretch w-full" style={{ gap: 1.5, height: 26 }}>
      {sent.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col justify-center" title={`day ${i + 1} · ${v} sent · ${calls[i]} calls`}>
          <div className="flex items-end" style={{ height: 13 }}>
            {v > 0 && <div className="w-full rounded-t-[1.5px]" style={{ height: Math.max((v / maxS) * 12, 1.5), backgroundColor: C.blue, opacity: .85 }} />}
          </div>
          <div className="flex items-start" style={{ height: 13 }}>
            {calls[i] > 0 && <div className="w-full rounded-b-[1.5px]" style={{ height: Math.max((calls[i] / maxC) * 12, 1.5), backgroundColor: gold }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function Consistency() {
  const T = useT();
  const rows = T.sellers.map(s => {
    const d = T.sellerDaily[s.name];
    return { s, d, ds: days(d.sent), dc: days(d.calls), r: rhythm(d.sent, s.sent) };
  }).sort((a, b) => b.ds - a.ds);

  return (
    <div>
      <table className="w-full" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th className={`${PAD} text-left font-semibold uppercase tracking-wider`} style={{ fontSize: 9.5, color: C.textMuted }}>Seller</th>
            <Th hint="Days in the window on which this person sent at least one message.">Active days</Th>
            <Th hint="Days on which this person dialled at all.">Days calling</Th>
            <Th hint="Share of this person's messages that went out on their single busiest day.">Biggest day</Th>
            <th className={`${PAD} text-left font-semibold uppercase tracking-wider`} style={{ fontSize: 9.5, color: C.textMuted, width: 250 }}>Pattern</th>
            <th className={`${PAD} text-right font-semibold uppercase tracking-wider`} style={{ fontSize: 9.5, color: C.textMuted }}>Consistency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, d, ds, dc, r }) => (
            <tr key={s.name} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td className={PAD}><span className="font-medium" style={{ fontSize: 13, color: C.textPrimary }}>{s.name}</span></td>
              <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                {ds} <span style={{ fontSize: 11, fontWeight: 400, color: C.textDim }}>/ {T.WINDOW_DAYS}</span>
              </td>
              <td className={`${PAD} text-right tabular-nums`} style={{ fontSize: 13, color: dc === 0 ? C.textDim : C.textBody }}>
                {dc > 0 ? dc : "—"}
              </td>
              <td className={`${PAD} text-right tabular-nums`}
                style={{ fontSize: 13, color: r.share >= .5 ? C.orange : C.textBody, fontWeight: r.share >= .5 ? 600 : 400 }}>
                {Math.round(r.share * 100)}%
              </td>
              <td className={PAD}><Spark sent={d.sent} calls={d.calls} /></td>
              <td className={`${PAD} text-right`}>
                <span className="font-semibold" style={{ fontSize: 12, color: r.tone }}>{r.label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-5 mt-3 flex-wrap">
        <span style={{ fontSize: 10.5, color: C.textDim }}>{T.WINDOW_START} → {T.WINDOW_END}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-sm" style={{ width: 8, height: 8, backgroundColor: C.blue }} />
          <span style={{ fontSize: 10.5, color: C.textMuted }}>messages</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-sm" style={{ width: 8, height: 8, backgroundColor: gold }} />
          <span style={{ fontSize: 10.5, color: C.textMuted }}>calls</span>
        </span>
        <span style={{ fontSize: 10.5, color: C.textDim }}>
          Burst-heavy = half the sends on one day · Sporadic = active on a third of the window or less
        </span>
      </div>
    </div>
  );
}

/* ═══ 6 · INSIGHTS ════════════════════════════════════════════════════════ */

function Insights() {
  const T = useT();
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 28 }}>
      {T.sellerInsights.map(i => (
        <div key={i.label}>
          <div className="font-semibold uppercase tracking-wider mb-1.5" style={{ fontSize: 9.5, color: i.tone === "warn" ? C.orange : C.textMuted }}>
            {i.label}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-semibold tabular-nums" style={{ fontSize: 24, letterSpacing: "-0.02em", color: i.tone === "warn" ? C.orange : C.textPrimary }}>
              {i.value}
            </span>
            <span className="font-medium truncate" style={{ fontSize: 13, color: C.textBody }}>{i.who}</span>
          </div>
          <div style={{ fontSize: 10.5, color: C.textDim }}>{i.note}</div>
        </div>
      ))}
    </div>
  );
}

/* ═══ page ════════════════════════════════════════════════════════════════ */

export default function Sellers({ label }: { label: string }) {
  const T = useT();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Opening question="How is the team doing?" sub={`in ${label}`} aside={<Drill label="Team" />}>
        <TeamHealth />
      </Opening>

      <Band question="Who is producing what?" sub="click a row for the detail" aside={<Drill label="Call queue" />}>
        <Performance open={open} setOpen={setOpen} />
      </Band>

      <Band question="Compare them">
        <Compare />
      </Band>

      <Band question="Who is on the phone?" sub={`${T.sellerCallsTotal.attempted} real dials`}>
        <Calls />
      </Band>

      <Band question="Steady, or in bursts?">
        <Consistency />
      </Band>

      <Band question="Key insights">
        <Insights />
      </Band>
    </>
  );
}
