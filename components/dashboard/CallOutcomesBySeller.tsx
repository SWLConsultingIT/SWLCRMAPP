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
type SellerCallStats = Counts & {
  sellerId: string; sellerName: string; byDay: Record<string, Counts>;
};

// Column definitions — label + the Counts key + accent colour.
const COLS: { key: keyof Counts; label: string; color: string }[] = [
  { key: "made",         label: "Made",           color: C.textPrimary },
  { key: "answered",     label: "Answered",       color: "#0EA5E9" },
  { key: "interested",   label: "Interested",     color: C.green },
  { key: "badTiming",    label: "Bad timing",     color: "#D97706" },
  { key: "voicemail",    label: "Voicemail",      color: "#0EA5E9" },
  { key: "notInterested",label: "Not interested", color: C.red },
  { key: "wrongNumber",  label: "Wrong #",        color: C.textMuted },
];

function fmtDay(iso: string): string {
  // iso = yyyy-mm-dd
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

function Cell({ n, color }: { n: number; color: string }) {
  return (
    <td className="text-center px-2 py-2 tabular-nums">
      <span className="text-[13px] font-bold" style={{ color: n > 0 ? color : C.textDim, fontFamily: OUTFIT }}>{n}</span>
    </td>
  );
}

function SellerRow({ s }: { s: SellerCallStats }) {
  const [open, setOpen] = useState(false);
  const days = Object.entries(s.byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1)); // most recent first
  return (
    <>
      <tr className="border-t transition-colors hover:bg-black/[0.015] cursor-pointer" style={{ borderColor: C.border }} onClick={() => setOpen(o => !o)}>
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-2">
            <ChevronRight size={13} style={{ color: C.textDim, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ background: "linear-gradient(135deg, #F97316, #FB923C)", color: "#fff" }}>
              {(s.sellerName[0] ?? "?").toUpperCase()}
            </span>
            <span className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary }}>{s.sellerName}</span>
          </span>
        </td>
        {COLS.map(c => <Cell key={c.key} n={s[c.key]} color={c.color} />)}
      </tr>
      {open && days.map(([day, counts]) => (
        <tr key={day} className="border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <td className="px-3 py-1.5 pl-12">
            <span className="text-[11px]" style={{ color: C.textMuted }}>{fmtDay(day)}</span>
          </td>
          {COLS.map(c => (
            <td key={c.key} className="text-center px-2 py-1.5 tabular-nums">
              <span className="text-[12px]" style={{ color: counts[c.key] > 0 ? C.textBody : C.textDim }}>{counts[c.key]}</span>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function CallOutcomesBySeller({ rows }: { rows: SellerCallStats[] }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-xl border px-4 py-6 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-xs" style={{ color: C.textMuted }}>No calls in this period.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <PhoneCall size={13} style={{ color: "#F97316" }} />
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.textBody }}>Call outcomes by seller</p>
        <span className="text-[10px]" style={{ color: C.textDim }}>click a seller for the day-by-day split</span>
      </div>
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
        </table>
      </div>
    </div>
  );
}
