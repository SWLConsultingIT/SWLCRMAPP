"use client";

// Per-seller comparison vs prior period — for the Sellers tab.
// Shows current-period call volume, answer %, and interested count alongside
// a delta chip (▲/▼ + %) vs the immediately preceding window of equal length.

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { C } from "@/lib/design";

const OUTFIT = "var(--font-outfit), system-ui, sans-serif";

type SellerCurrent = {
  sellerId: string;
  sellerName: string;
  active?: boolean;
  made: number;
  answered: number;
  interested: number;
};

type PriorStats = { made: number; answered: number; interested: number };

function pctDelta(curr: number, prior: number): number | null {
  if (prior === 0 && curr === 0) return null;
  if (prior === 0) return null;
  return Math.round(((curr - prior) / prior) * 100);
}

function DeltaChip({ curr, prior, fmt }: {
  curr: number;
  prior: number;
  fmt?: (n: number) => string;
}) {
  const delta = pctDelta(curr, prior);
  const fmtN = fmt ?? ((n: number) => String(n));
  const color  = delta == null || delta === 0 ? C.textMuted : delta > 0 ? "#22C55E" : "#EF4444";
  const Icon   = delta == null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const label  = delta == null ? "—" : delta === 0 ? "=" : `${delta > 0 ? "+" : ""}${delta}%`;

  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, fontFamily: OUTFIT, lineHeight: 1.1 }}>
        {fmtN(curr)}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 9, fontWeight: 700, color, fontFamily: OUTFIT }}>
        <Icon size={8} />
        {label}
        {prior > 0 && (
          <span style={{ color: C.textDim, fontWeight: 400, marginLeft: 2 }}>
            was {fmtN(prior)}
          </span>
        )}
      </span>
    </span>
  );
}

export default function SellerTrendTable({
  rows,
  prior,
  periodLabel,
}: {
  rows: SellerCurrent[];
  prior: Record<string, PriorStats>;
  periodLabel: string;
}) {
  if (!rows || rows.length === 0) return null;

  const answerPct = (made: number, answered: number) =>
    made === 0 ? 0 : Math.round((answered / made) * 100);

  const cols = [
    { label: "Calls",       key: "made" as const },
    { label: "Answer %",    key: "answerPct" as const },
    { label: "Interested",  key: "interested" as const },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th className="text-left px-3 py-2.5" style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: OUTFIT }}>
              Seller
            </th>
            {cols.map(c => (
              <th key={c.key} className="text-center px-3 py-2.5" style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: OUTFIT }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(s => {
            const p = prior[s.sellerId] ?? { made: 0, answered: 0, interested: 0 };
            const currAnswerPct  = answerPct(s.made, s.answered);
            const priorAnswerPct = answerPct(p.made, p.answered);
            const inactive = s.active === false;
            return (
              <tr key={s.sellerId} className="border-t" style={{ borderColor: C.border, opacity: inactive ? 0.5 : 1 }}>
                <td className="px-3 py-3">
                  <span className="flex items-center gap-2.5">
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
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: "rgba(107,114,128,0.12)", color: "#6B7280" }}>
                        left
                      </span>
                    )}
                  </span>
                </td>
                <td className="text-center px-3 py-3">
                  <DeltaChip curr={s.made} prior={p.made} />
                </td>
                <td className="text-center px-3 py-3">
                  <DeltaChip curr={currAnswerPct} prior={priorAnswerPct} fmt={n => `${n}%`} />
                </td>
                <td className="text-center px-3 py-3">
                  <DeltaChip curr={s.interested} prior={p.interested} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 10, color: C.textDim, padding: "6px 12px 10px", textAlign: "right" }}>
        vs the prior equal-length period ({periodLabel})
      </p>
    </div>
  );
}
