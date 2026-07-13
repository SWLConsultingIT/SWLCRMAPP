"use client";

// Call monitoring by seller (boss 2026-06-08): "quiero ver cuántas llamadas
// hizo cada seller por día y cuál fue el problema de cada una". One row per
// seller with the outcome breakdown (made / answered / interested / bad timing
// / not interested / wrong number); expand a row for the per-day split. Honors
// the dashboard's global period + seller filters (the data is pre-aggregated
// server-side in lib/dashboard-data.ts).

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
};

// Column key = a Counts field OR the derived "unclassified" (made minus the
// five logged outcomes), so Total calls always reconciles with the columns.
type ColKey = keyof Counts | "unclassified" | "classifiedPct";

// Unclassified = calls made but with no outcome logged yet. Clamped at 0 in
// case of any data skew. This is what makes the row add up: Total calls =
// Interested + Bad timing + Voicemail + Not interested + Wrong # + Sin clasificar.
const unclassifiedOf = (c: Counts) =>
  Math.max(0, c.made - c.interested - c.badTiming - c.voicemail - c.notInterested - c.wrongNumber);
const classifiedPctOf = (c: Counts) =>
  c.made === 0 ? 100 : Math.round(((c.made - unclassifiedOf(c)) / c.made) * 100);
const valueOf = (c: Counts, key: ColKey): number =>
  key === "unclassified" ? unclassifiedOf(c) : key === "classifiedPct" ? classifiedPctOf(c) : c[key];

// Column definitions — label + key + accent colour. "Answered" dropped
// 2026-06-11 (Fran, unreliable). "Sin clasificar" added so the math closes.
const COLS: { key: ColKey; label: string; color: string }[] = [
  { key: "made",          label: "Total calls",   color: C.textPrimary },
  { key: "interested",    label: "Interested",    color: C.green },
  { key: "badTiming",     label: "Bad timing",    color: "#D97706" },
  { key: "voicemail",     label: "Voicemail",     color: "#0EA5E9" },
  { key: "notInterested", label: "Not interested",color: C.red },
  { key: "wrongNumber",   label: "Wrong #",       color: C.textMuted },
  { key: "unclassified",  label: "Unclassified",  color: C.red },
  { key: "classifiedPct", label: "Classified %",  color: C.green },
];

function fmtDay(iso: string): string {
  // iso = yyyy-mm-dd
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

function Cell({ n, color, colKey, total }: { n: number; color: string; colKey: ColKey; total?: number }) {
  const isPct = colKey === "classifiedPct";
  const isUnclassified = colKey === "unclassified";
  const highUnclassified = isUnclassified && total && total > 0 && n / total > 0.4;
  const lowClassified = isPct && n < 60;
  const displayVal = isPct ? `${n}%` : String(n);
  return (
    <td className="text-center px-2 py-2 tabular-nums">
      {highUnclassified ? (
        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#EF4444" }}>
          {displayVal} ⚠
        </span>
      ) : lowClassified ? (
        <span className="text-[13px] font-bold" style={{ color: "#EF4444", fontFamily: OUTFIT }}>{displayVal}</span>
      ) : (
        <span className="text-[13px] font-bold" style={{ color: (isPct ? n < 100 : n > 0) ? color : C.textDim, fontFamily: OUTFIT }}>{displayVal}</span>
      )}
    </td>
  );
}

function SellerRow({ s }: { s: SellerCallStats }) {
  const [open, setOpen] = useState(false);
  const days = Object.entries(s.byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1)); // most recent first
  const inactive = s.active === false;
  return (
    <>
      <tr className="border-t transition-colors hover:bg-black/[0.015] cursor-pointer" style={{ borderColor: C.border, opacity: inactive ? 0.55 : 1 }} onClick={() => setOpen(o => !o)}>
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-2">
            <ChevronRight size={13} style={{ color: C.textDim, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ background: inactive ? "#374151" : "linear-gradient(135deg, #F97316, #FB923C)", color: "#fff" }}>
              {(s.sellerName[0] ?? "?").toUpperCase()}
            </span>
            <span className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary }}>{s.sellerName}</span>
            {inactive && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "rgba(107,114,128,0.15)", color: "#6B7280" }}>left</span>
            )}
          </span>
        </td>
        {COLS.map(c => <Cell key={c.key} n={valueOf(s, c.key)} color={c.color} colKey={c.key} total={s.made} />)}
      </tr>
      {open && days.map(([day, counts]) => (
        <tr key={day} className="border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <td className="px-3 py-1.5 pl-12">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px]" style={{ color: C.textMuted }}>{fmtDay(day)}</span>
              {counts.campaigns && counts.campaigns.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {counts.campaigns.map(name => (
                    <span key={name} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full truncate max-w-[160px]"
                      style={{ background: "rgba(201,168,58,.12)", color: "#C9A83A", border: "1px solid rgba(201,168,58,.25)" }}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </td>
          {COLS.map(c => {
            const v = valueOf(counts, c.key);
            return (
              <td key={c.key} className="text-center px-2 py-1.5 tabular-nums">
                <span className="text-[12px]" style={{ color: v > 0 ? C.textBody : C.textDim }}>{v}</span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

// `bare` = render just the table (no card chrome / header), for when the
// caller wraps it in a <Panel> — so it matches the other dashboard tables
// (dark Panel header + flush table) instead of a card-in-a-card.
export default function CallOutcomesBySeller({ rows, bare = false }: { rows: SellerCallStats[]; bare?: boolean }) {
  if (!rows || rows.length === 0) {
    return (
      <div className={bare ? "px-4 py-6" : "rounded-xl border px-4 py-6"} style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-start gap-3">
          <PhoneCall size={16} style={{ color: C.textMuted, marginTop: "2px", flexShrink: 0 }} />
          <div>
            <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>No calls yet</p>
            <p className="text-xs mt-1" style={{ color: C.textMuted }}>Calls you dial will appear here with outcomes (interested, bad timing, wrong number, etc.)</p>
          </div>
        </div>
      </div>
    );
  }
  const tableEl = (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>Seller</th>
              {COLS.map(c => (
                <th key={c.key} className="text-center px-2 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(s => <SellerRow key={s.sellerId} s={s} />)}
          </tbody>
          {rows.length > 1 && (() => {
            // Column totals across every seller — so the panel reconciles at a
            // glance (Total calls = sum of the outcome columns, all sellers).
            const totals = rows.reduce((acc, s) => {
              acc.made += s.made; acc.interested += s.interested; acc.badTiming += s.badTiming;
              acc.voicemail += s.voicemail; acc.notInterested += s.notInterested; acc.wrongNumber += s.wrongNumber;
              return acc;
            }, { made: 0, answered: 0, interested: 0, badTiming: 0, voicemail: 0, notInterested: 0, wrongNumber: 0 } as Counts);
            return (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.border}`, backgroundColor: C.bg }}>
                  <td className="px-3 py-2.5 text-[12px] font-bold" style={{ color: C.textPrimary, fontFamily: OUTFIT }}>Total · {rows.length} sellers</td>
                  {COLS.map(c => {
                    const v = valueOf(totals, c.key);
                    const display = c.key === "classifiedPct" ? `${v}%` : String(v);
                    return (
                      <td key={c.key} className="text-center px-2 py-2.5 tabular-nums">
                        <span className="text-[13px] font-bold" style={{ color: v > 0 ? c.color : C.textDim, fontFamily: OUTFIT }}>{display}</span>
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
  // Bare = flush table for a <Panel> wrapper (matches the other tables).
  if (bare) return tableEl;
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <PhoneCall size={13} style={{ color: "#F97316" }} />
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.textBody }}>Call outcomes by seller</p>
        <span className="text-[10px]" style={{ color: C.textDim }}>click a seller for the day-by-day split</span>
      </div>
      {tableEl}
    </div>
  );
}
