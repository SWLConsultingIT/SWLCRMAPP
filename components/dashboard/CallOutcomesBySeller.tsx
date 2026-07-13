"use client";

// Call monitoring by seller (boss 2026-06-08): "quiero ver cuántas llamadas
// hizo cada seller por día y cuál fue el problema de cada una". One row per
// seller with the outcome breakdown; expand for the per-day split.
// Redesigned 2026-07-13: avatar uses brand navy+gold (was orange),
// bad timing = yellow, voicemail = violet, answer% = sky blue.

import { useState } from "react";
import { ChevronRight, PhoneCall } from "lucide-react";
import { C } from "@/lib/design";

const OUTFIT = "var(--font-outfit), system-ui, sans-serif";

type Counts = {
  made: number; answered: number; interested: number;
  badTiming: number; voicemail: number; notInterested: number; wrongNumber: number;
};
type DayCounts = Counts & { campaigns?: string[] };
type SellerCallStats = Counts & {
  sellerId: string; sellerName: string; active?: boolean; byDay: Record<string, DayCounts>;
  avgDurationSecs?: number; avgCoachScore?: number | null;
};

type ColKey =
  | keyof Counts
  | "unclassified" | "classifiedPct" | "answerPct"
  | "avgDurationSecs" | "avgCoachScore";

const unclassifiedOf = (c: Counts) =>
  Math.max(0, c.made - c.interested - c.badTiming - c.voicemail - c.notInterested - c.wrongNumber);
const classifiedPctOf = (c: Counts) =>
  c.made === 0 ? 100 : Math.round(((c.made - unclassifiedOf(c)) / c.made) * 100);
const answerPctOf = (c: Counts) =>
  c.made === 0 ? 0 : Math.round((c.answered / c.made) * 100);
const fmtDuration = (secs: number) => {
  if (secs === 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};
const valueOf = (c: Counts | SellerCallStats, key: ColKey): number => {
  if (key === "unclassified") return unclassifiedOf(c as Counts);
  if (key === "classifiedPct") return classifiedPctOf(c as Counts);
  if (key === "answerPct") return answerPctOf(c as Counts);
  if (key === "avgDurationSecs") return (c as SellerCallStats).avgDurationSecs ?? 0;
  if (key === "avgCoachScore") return (c as SellerCallStats).avgCoachScore ?? 0;
  return (c as Counts)[key as keyof Counts];
};

// Column definitions — bad timing = yellow (not orange), voicemail = violet (not sky blue).
const COLS: { key: ColKey; label: string; color: string }[] = [
  { key: "made",            label: "Total",         color: C.textPrimary },
  { key: "answerPct",       label: "Answer %",      color: "#38BDF8"     },
  { key: "interested",      label: "Interested",    color: "#22C55E"     },
  { key: "badTiming",       label: "Bad timing",    color: "#EAB308"     },
  { key: "voicemail",       label: "Voicemail",     color: "#A78BFA"     },
  { key: "notInterested",   label: "Not interested",color: "#EF4444"     },
  { key: "wrongNumber",     label: "Wrong #",       color: C.textMuted   },
  { key: "unclassified",    label: "Unclassified",  color: "#EF4444"     },
  { key: "classifiedPct",   label: "Classified %",  color: "#22C55E"     },
  { key: "avgDurationSecs", label: "Duration",      color: C.textMuted   },
  { key: "avgCoachScore",   label: "Coach",         color: "#C9A83A"     },
];

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

function DayOutcomeChips({ counts }: { counts: DayCounts }) {
  const chips = [
    { n: counts.interested,      label: "interested",     color: "#22C55E" },
    { n: counts.badTiming,       label: "bad timing",     color: "#EAB308" },
    { n: counts.voicemail,       label: "voicemail",      color: "#A78BFA" },
    { n: counts.notInterested,   label: "not interested", color: "#EF4444" },
    { n: counts.wrongNumber,     label: "wrong #",        color: "#6B7280" },
    { n: unclassifiedOf(counts), label: "unclassified",   color: "#991B1B" },
  ].filter(c => c.n > 0);
  if (chips.length === 0) return <span style={{ fontSize: 10, color: C.textDim }}>no outcomes logged</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {chips.map(chip => (
        <span key={chip.label} style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 4,
          background: `${chip.color}18`, color: chip.color,
          border: `1px solid ${chip.color}30`,
          fontFamily: OUTFIT, fontWeight: 600,
        }}>
          {chip.n} {chip.label}
        </span>
      ))}
    </div>
  );
}

function Cell({ n, color, colKey, total, s }: {
  n: number; color: string; colKey: ColKey; total?: number; s?: SellerCallStats;
}) {
  const isPct      = colKey === "classifiedPct" || colKey === "answerPct";
  const isDuration = colKey === "avgDurationSecs";
  const isCoach    = colKey === "avgCoachScore";
  const isUncl     = colKey === "unclassified";

  const highUncl  = isUncl && total && total > 0 && n / total > 0.4;
  const lowClass  = colKey === "classifiedPct" && n < 60;
  const lowAnswer = colKey === "answerPct" && total && total > 0 && n < 30;

  if (isDuration) {
    const text = s ? fmtDuration(s.avgDurationSecs ?? 0) : fmtDuration(n);
    return (
      <td className="text-center px-2 py-2.5 tabular-nums">
        <span style={{ fontSize: 12, color: n > 0 ? C.textMuted : C.textDim, fontFamily: OUTFIT }}>{text}</span>
      </td>
    );
  }
  if (isCoach) {
    const score = s?.avgCoachScore ?? null;
    if (score == null) return <td className="text-center px-2 py-2.5"><span style={{ color: C.textDim }}>—</span></td>;
    const scoreColor = score >= 80 ? "#22C55E" : score >= 60 ? "#EAB308" : "#EF4444";
    return (
      <td className="text-center px-2 py-2.5 tabular-nums">
        <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor, fontFamily: OUTFIT }}>{score}</span>
      </td>
    );
  }

  const displayVal = isPct ? `${n}%` : String(n);
  return (
    <td className="text-center px-2 py-2.5 tabular-nums">
      {highUncl ? (
        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 4, backgroundColor: "rgba(239,68,68,0.12)", color: "#EF4444" }}>
          {displayVal} ⚠
        </span>
      ) : (lowClass || lowAnswer) ? (
        <span style={{ fontSize: 13, fontWeight: 700, color: "#EF4444", fontFamily: OUTFIT }}>{displayVal}</span>
      ) : (
        <span style={{ fontSize: 13, fontWeight: 700, color: (isPct ? n < 100 : n > 0) ? color : C.textDim, fontFamily: OUTFIT }}>{displayVal}</span>
      )}
    </td>
  );
}

function SellerRow({ s }: { s: SellerCallStats }) {
  const [open, setOpen] = useState(false);
  const days     = Object.entries(s.byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const inactive = s.active === false;
  const colCount = 1 + COLS.length;
  return (
    <>
      <tr
        className="border-t transition-colors hover:bg-white/[0.02] cursor-pointer"
        style={{ borderColor: C.border, opacity: inactive ? 0.5 : 1 }}
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-2.5">
            <ChevronRight size={12} style={{
              color: C.textDim,
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform .15s",
              flexShrink: 0,
            }} />
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
              style={{
                background: inactive ? "rgba(75,85,99,0.2)"          : "rgba(201,168,58,0.12)",
                color:      inactive ? "#6B7280"                      : "#C9A83A",
                border:     inactive ? "1px solid rgba(75,85,99,0.3)" : "1px solid rgba(201,168,58,0.28)",
              }}
            >
              {(s.sellerName[0] ?? "?").toUpperCase()}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: inactive ? C.textMuted : C.textPrimary, fontFamily: OUTFIT }}>
              {s.sellerName}
            </span>
            {inactive && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: "rgba(107,114,128,0.12)", color: "#6B7280", flexShrink: 0 }}>
                left
              </span>
            )}
          </span>
        </td>
        {COLS.map(c => (
          <Cell key={c.key} n={valueOf(s, c.key)} color={c.color} colKey={c.key} total={s.made} s={s} />
        ))}
      </tr>

      {open && days.map(([day, counts]) => (
        <tr key={day} className="border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <td className="px-4 py-2 pl-14">
            <div className="flex flex-col gap-1.5">
              <span style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, fontFamily: OUTFIT }}>
                {fmtDay(day)}
              </span>
              <DayOutcomeChips counts={counts} />
              {counts.campaigns && counts.campaigns.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {counts.campaigns.map(name => (
                    <span key={name} style={{
                      fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                      background: "rgba(201,168,58,.1)", color: "#C9A83A",
                      border: "1px solid rgba(201,168,58,.2)",
                    }}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </td>
          {COLS.map(c => {
            const v = valueOf(counts as any, c.key);
            return (
              <td key={c.key} className="text-center px-2 py-2 tabular-nums">
                <span style={{ fontSize: 12, color: v > 0 ? C.textBody : C.textDim }}>{v}</span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export default function CallOutcomesBySeller({ rows, bare = false }: { rows: SellerCallStats[]; bare?: boolean }) {
  if (!rows || rows.length === 0) {
    return (
      <div className={bare ? "px-4 py-6" : "rounded-xl border px-4 py-6"} style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-start gap-3">
          <PhoneCall size={16} style={{ color: C.textMuted, marginTop: 2, flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>No calls yet</p>
            <p style={{ fontSize: 12, marginTop: 4, color: C.textMuted }}>
              Calls you dial will appear here with outcomes (interested, bad timing, wrong number, etc.)
            </p>
          </div>
        </div>
      </div>
    );
  }

  const tableEl = (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th className="text-left px-3 py-2.5" style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: OUTFIT }}>
              Seller
            </th>
            {COLS.map(c => (
              <th key={c.key} className="text-center px-2 py-2.5" style={{
                fontSize: 10, fontWeight: 700,
                color: c.color === C.textPrimary ? C.textDim : c.color,
                textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: OUTFIT, opacity: 0.8,
              }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(s => <SellerRow key={s.sellerId} s={s} />)}
        </tbody>
        {rows.length > 1 && (() => {
          const totals = rows.reduce(
            (acc, s) => {
              acc.made += s.made; acc.interested += s.interested;
              acc.badTiming += s.badTiming; acc.voicemail += s.voicemail;
              acc.notInterested += s.notInterested; acc.wrongNumber += s.wrongNumber;
              return acc;
            },
            { made: 0, answered: 0, interested: 0, badTiming: 0, voicemail: 0, notInterested: 0, wrongNumber: 0 } as Counts,
          );
          return (
            <tfoot>
              <tr style={{ borderTop: `2px solid ${C.border}`, backgroundColor: C.bg }}>
                <td className="px-3 py-2.5" style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, fontFamily: OUTFIT }}>
                  All · {rows.length} sellers
                </td>
                {COLS.map(c => {
                  if (c.key === "avgDurationSecs" || c.key === "avgCoachScore") {
                    return <td key={c.key} className="text-center px-2 py-2.5"><span style={{ color: C.textDim }}>—</span></td>;
                  }
                  const v = valueOf(totals, c.key);
                  const display = (c.key === "classifiedPct" || c.key === "answerPct") ? `${v}%` : String(v);
                  return (
                    <td key={c.key} className="text-center px-2 py-2.5 tabular-nums">
                      <span style={{ fontSize: 13, fontWeight: 700, color: v > 0 ? c.color : C.textDim, fontFamily: OUTFIT }}>
                        {display}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          );
        })()}
      </table>
    </div>
  );

  if (bare) return tableEl;
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <PhoneCall size={13} style={{ color: "#38BDF8" }} />
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: C.textBody }}>
          Call outcomes by seller
        </p>
        <span style={{ fontSize: 10, color: C.textDim }}>click a seller for the day-by-day split</span>
      </div>
      {tableEl}
    </div>
  );
}
