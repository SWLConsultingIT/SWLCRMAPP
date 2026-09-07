"use client";

// ─────────────────────────────────────────────────────────────────────────
// ICPs — "which kind of company answers us, and what did we spend to find
// out?"
//
// The contact points are back and they are the second column, not a
// footnote: connection request / LinkedIn DM / email / call, each with how
// many went out and how many distinct people received them. That pair is
// the follow-up depth — 1,570 emails to 1,064 leads is a very different
// campaign from 89 emails to 89 leads, and one number alone hides it.
//
// What is still gone from the live tab: "Total touches" as a single figure
// (it added an invitation to a call), Conv% (0 in seven of eight rows, so
// sorting by it left the order to the tiebreak), and the 14-day sparkline
// inside a 30-day view.
// ─────────────────────────────────────────────────────────────────────────

import { C } from "@/lib/design";
import {
  gold, n, S, Band, Opening, Drill, Note, Eyebrow, WorthALook,
  ChannelMark, CH_COLOR, CH_LABEL,
} from "./ui";
import * as T from "./tabs-data";

const K = T.CH_KEYS;

/* ── contact points ─────────────────────────────────────────────────────
   Four cells per row, each one "sent / reached". The bar under each cell is
   that channel's share of the ICP's own volume, so the shape of the row
   says how the ICP was worked without reading a single number. */

function Touches({ t, reach, max }: { t: T.Touch; reach: T.Touch; max: number }) {
  return (
    <div className="flex" style={{ gap: 6 }}>
      {K.map(k => {
        const v = t[k];
        return (
          <div key={k} className="flex-1 min-w-0" title={`${CH_LABEL[k]} · ${n(v)} sent to ${n(reach[k])} leads`}>
            <div className="tabular-nums text-right truncate"
              style={{ fontSize: 12.5, fontWeight: v > 0 ? 600 : 400, color: v > 0 ? C.textPrimary : C.textDim }}>
              {v > 0 ? n(v) : "—"}
            </div>
            <div className="tabular-nums text-right truncate" style={{ fontSize: 10, color: C.textDim }}>
              {v > 0 ? `${n(reach[k])} leads` : ""}
            </div>
            <div className="mt-1 rounded-full" style={{ height: 3, backgroundColor: C.surface }}>
              {v > 0 && <div className="h-full rounded-full" style={{ width: `${Math.max((v / max) * 100, 3)}%`, backgroundColor: CH_COLOR[k] }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Rank() {
  const rows = T.icps;
  const best = Math.max(...rows.map(r => r.rate));
  const team = T.icpsTotals.rate;
  const maxTouch = Math.max(...rows.flatMap(r => K.map(k => r.touch[k])));
  const x = (v: number) => (v / best) * 100;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4 flex-wrap">
        <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textPrimary }}>{n(T.icpsTotals.contacted)}</span>
        <span style={{ fontSize: 12, color: C.textMuted }}>leads contacted across eight ICPs</span>
        <span style={{ fontSize: 12, color: C.textDim }}>·</span>
        <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textBody }}>{T.icpsTotals.replies}</span>
        <span style={{ fontSize: 12, color: C.textMuted }}>replied</span>
        <span style={{ fontSize: 12, color: C.textDim }}>·</span>
        <span className="font-semibold tabular-nums" style={{ fontSize: 12.5, color: gold }}>{team}% team</span>
      </div>

      {/* column heads — the only place this tab uses them, because four
          channel columns without labels would be a guessing game */}
      <div className="flex items-end gap-4 pb-2" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="w-[214px] shrink-0" />
        <div className="w-[300px] shrink-0 flex" style={{ gap: 6 }}>
          {K.map(k => (
            <div key={k} className="flex-1 min-w-0 flex items-center justify-end gap-1">
              <span className="rounded-sm shrink-0" style={{ width: 7, height: 7, backgroundColor: CH_COLOR[k] }} />
              <span className="font-semibold uppercase tracking-wider truncate" style={{ fontSize: 9, color: C.textMuted }}>
                {k === "li_cr" ? "Invite" : k === "li_dm" ? "DM" : k === "email" ? "Email" : "Calls"}
              </span>
            </div>
          ))}
        </div>
        <div className="flex-1" />
        <span className="w-[48px] shrink-0 text-right font-semibold uppercase tracking-wider" style={{ fontSize: 9, color: C.textMuted }}>Reply</span>
      </div>

      <div className="flex flex-col">
        {rows.map(r => (
          <div key={r.name} className="flex items-center gap-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div className="w-[214px] shrink-0 min-w-0">
              <div className="font-medium truncate" style={{ fontSize: 13, color: C.textPrimary }} title={r.name}>{r.name}</div>
              <div className="tabular-nums" style={{ fontSize: 11, color: C.textDim }}>
                {r.replies} of {n(r.contacted)} contacted
                {r.positive > 0 && <span style={{ color: C.green }}> · {r.positive} positive</span>}
              </div>
            </div>
            <div className="w-[300px] shrink-0">
              <Touches t={r.touch} reach={r.reach} max={maxTouch} />
            </div>
            <div className="flex-1 relative min-w-[50px]">
              <div className="h-2 rounded-full" style={{ backgroundColor: C.surface }}>
                <div className="h-full rounded-full" style={{ width: `${x(r.rate)}%`, backgroundColor: gold, opacity: r.rate >= team ? .95 : .4 }} />
              </div>
              <div aria-hidden className="absolute top-[-3px] bottom-[-3px]" style={{ left: `${x(team)}%`, width: 1, backgroundColor: C.textMuted, opacity: .55 }} />
            </div>
            <span className="w-[48px] shrink-0 text-right font-semibold tabular-nums"
              style={{ fontSize: 15, color: r.rate >= team ? C.textPrimary : C.textMuted }}>{r.rate}%</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-5 flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 1, height: 11, backgroundColor: C.textMuted, opacity: .55 }} />
          <span style={{ fontSize: 11, color: C.textMuted }}>team rate {T.icpsTotals.rate}%</span>
        </span>
        <span style={{ fontSize: 11, color: C.textDim }}>
          bold = contact points sent · below it, the distinct leads that received them
        </span>
      </div>
      <Note>{T.icpsNote}</Note>
      <Note>{T.icpTouchNote}</Note>
    </div>
  );
}

/* ── channel totals ─────────────────────────────────────────────────────
   The four numbers the rows above add up to, so the reader can anchor a
   row against the whole before comparing rows with each other. */

function Totals() {
  const t = T.icpsTotals.touch;
  const grand = K.reduce((a, k) => a + t[k], 0);
  return (
    <div className="flex flex-wrap" style={{ gap: 28 }}>
      {K.map(k => (
        <div key={k} className="flex items-center gap-2.5">
          <ChannelMark ch={k} size={30} />
          <div>
            <div className="font-semibold tabular-nums" style={{ fontSize: 17, color: C.textPrimary }}>{n(t[k])}</div>
            <div style={{ fontSize: 10.5, color: C.textMuted }}>
              {CH_LABEL[k]} · {Math.round((t[k] / grand) * 100)}%
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2.5 pl-6" style={{ borderLeft: `1px solid ${C.border}` }}>
        <div>
          <div className="font-semibold tabular-nums" style={{ fontSize: 17, color: gold }}>{n(grand)}</div>
          <div style={{ fontSize: 10.5, color: C.textMuted }}>contact points in total</div>
        </div>
      </div>
    </div>
  );
}

/* ── the grid ───────────────────────────────────────────────────────────── */

const MIN_BASE = 20;

function Matrix() {
  const cells = T.icps.flatMap(i => K.map(c => ({ base: i.reach[c], hit: i.replied[c] }))).filter(c => c.base >= MIN_BASE);
  const max = Math.max(...cells.map(c => (c.hit / c.base) * 100), 1);

  return (
    <div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: 720 }}>
          <div className="flex gap-2 mb-2" style={{ paddingLeft: 244 }}>
            {K.map(c => (
              <div key={c} className="flex-1 flex items-center justify-center gap-1.5">
                <span className="rounded-sm shrink-0" style={{ width: 8, height: 8, backgroundColor: CH_COLOR[c] }} />
                <span className="font-semibold uppercase tracking-wider" style={{ fontSize: 10, color: C.textMuted }}>{CH_LABEL[c]}</span>
              </div>
            ))}
          </div>
          {T.icps.map(i => (
            <div key={i.name} className="flex gap-2 mb-2 items-stretch">
              <div className="w-[236px] shrink-0 min-w-0 flex flex-col justify-center">
                <div className="truncate" style={{ fontSize: 12.5, color: C.textPrimary }} title={i.name}>{i.name}</div>
              </div>
              {K.map(c => {
                const base = i.reach[c], hit = i.replied[c];
                if (base === 0) {
                  return (
                    <div key={c} className="flex-1 rounded-lg flex items-center justify-center"
                      style={{ height: 46, border: `1px dashed ${C.border}` }}>
                      <span style={{ fontSize: 11, color: C.textDim }}>not used</span>
                    </div>
                  );
                }
                const rate = (hit / base) * 100;
                const thin = base < MIN_BASE;
                const fill = thin ? "transparent" : `color-mix(in srgb, ${gold} ${Math.round((rate / max) * 78) + 6}%, transparent)`;
                const hot = !thin && rate / max > .55;
                return (
                  <div key={c} className="flex-1 rounded-lg flex flex-col items-center justify-center"
                    title={`${i.name} · ${CH_LABEL[c]} · ${hit} of ${base} reached replied`}
                    style={{ height: 46, backgroundColor: fill, border: thin ? `1px dashed ${C.border}` : "none" }}>
                    <span className="font-semibold tabular-nums" style={{ fontSize: 14, color: thin ? C.textDim : hot ? "#3A2E08" : C.textPrimary }}>
                      {thin ? "—" : `${rate.toFixed(1)}%`}
                    </span>
                    <span className="tabular-nums" style={{ fontSize: 10.5, color: thin ? C.textDim : hot ? "#5A4A12" : C.textMuted }}>
                      {hit} of {n(base)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <Note>
        {T.icpMatrixNote} Cells reaching fewer than {MIN_BASE} leads show their counts but no rate — a rate off a handful of people is noise, and shading it would rank it.
      </Note>
    </div>
  );
}

export default function Icps({ label }: { label: string }) {
  return (
    <>
      <Opening question="Which kind of company answers us?" sub={`in ${label}`} aside={<Drill label="ICP list" />}>
        <Rank />
      </Opening>

      <Band question="What did we spend to find out?" sub="contact points across all eight ICPs">
        <Totals />
      </Band>

      <section style={{ paddingTop: 44 }}>
        <WorthALook title={T.icpWorthALook.title} facts={T.icpWorthALook.facts} />
      </section>

      <Band question="And which channel worked for whom?" aside={<Drill label="Channels" />}>
        <Matrix />
      </Band>

      <Band question="What this tab no longer shows">
        <Eyebrow>Removed</Eyebrow>
        <ul className="flex flex-col" style={{ gap: 9, maxWidth: 780 }}>
          {[
            ["Total touches as one figure", "the per-channel counts are back above, but summing them into one number adds an invitation to a call as if they cost the same."],
            ["Conv% (positive rate)", "one positive in the whole period, in one ICP — a column that is 0 in seven of eight rows sorts by its tiebreak, not by itself."],
            ["14-day sparkline", "a 14-day trend inside a 30-day view answers a window nobody selected."],
            ["Rate bars rescaled to the table leader", "0.4% and 9.5% are 24× apart and the old bars made them look adjacent."],
          ].map(([k, v]) => (
            <li key={k} className="flex items-baseline gap-2.5">
              <span className="shrink-0 rounded-full" style={{ width: 4, height: 4, backgroundColor: C.textDim, transform: "translateY(-2px)" }} />
              <span style={{ fontSize: 12.5, color: C.textBody, lineHeight: 1.55 }}>
                <strong style={{ color: C.textPrimary }}>{k}</strong> — {v}
              </span>
            </li>
          ))}
        </ul>
      </Band>
    </>
  );
}
