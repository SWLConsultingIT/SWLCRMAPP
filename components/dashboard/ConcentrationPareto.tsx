// Concentration analysis — for each dimension (ICPs, sellers, campaigns),
// what's the minimum number of entities that account for ≥80% of all
// positives? Surfaces mono-segment risk: if 80% of positives come from
// 1 ICP, losing that ICP cripples the pipeline.
//
// Visual: three rows, each with a horizontal stacked bar showing the top-N
// share in gold (filled) and the long-tail share in muted gray. Number
// labels on the right (e.g. "2 of 5 ICPs · 82%").

import Link from "next/link";
import { Target, Trophy, Megaphone, AlertTriangle } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type Item = { id: string; name: string; positives: number };

export default function ConcentrationPareto({
  rows,
  riskLabel = "High concentration risk",
  healthyLabel = "Healthy spread",
  pctLabel = "{pct}% of positives from top {n} of {total}",
  emptyLabel = "Not enough positives yet to assess concentration.",
}: {
  rows: { kind: "icp" | "seller" | "campaign"; titleKey: string; items: Item[]; hrefBase?: string }[];
  riskLabel?: string;
  healthyLabel?: string;
  pctLabel?: string;          // "{pct}% from top {n} of {total}"
  emptyLabel?: string;
}) {
  // Compute concentration per row.
  const rowsComputed = rows.map(r => {
    const sorted = [...r.items].sort((a, b) => b.positives - a.positives);
    const total = sorted.reduce((s, x) => s + x.positives, 0);
    if (total === 0) return { ...r, total: 0, topN: 0, topShare: 0, topItems: sorted.slice(0, 0), risk: false };

    // Find min N such that cumulative >= 80% of total.
    let cum = 0; let topN = 0;
    for (let i = 0; i < sorted.length; i++) {
      cum += sorted[i].positives;
      topN = i + 1;
      if (cum >= total * 0.8) break;
    }
    const topShare = sorted.length > 0 ? topN / sorted.length : 0;
    // Risk: 80% of positives from 1 entity, OR top-N is <20% of the population
    // and the population is ≥5 (otherwise concentration is trivial).
    const risk = (topN === 1 && sorted.length >= 3) || (topShare <= 0.2 && sorted.length >= 5);
    return { ...r, total, topN, topShare, topItems: sorted.slice(0, topN), risk };
  });

  const anyData = rowsComputed.some(r => r.total > 0);
  if (!anyData) {
    return (
      <div className="py-8 text-center text-[12px]" style={{ color: C.textMuted }}>{emptyLabel}</div>
    );
  }

  const iconFor = (kind: "icp" | "seller" | "campaign") => {
    if (kind === "icp") return Target;
    if (kind === "seller") return Trophy;
    return Megaphone;
  };

  return (
    <div className="space-y-3">
      {rowsComputed.map(r => {
        if (r.total === 0) return null;
        const Icon = iconFor(r.kind);
        const pct = Math.round((r.topItems.reduce((s, x) => s + x.positives, 0) / r.total) * 100);
        const total = r.items.length;
        const label = pctLabel
          .replace("{pct}", String(pct))
          .replace("{n}", String(r.topN))
          .replace("{total}", String(total));

        return (
          <div key={r.kind} className="rounded-lg border p-3" style={{ borderColor: C.border, background: C.card }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-md flex items-center justify-center"
                  style={{ background: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
                  <Icon size={12} />
                </span>
                <span className="text-[12.5px] font-semibold" style={{ color: C.textPrimary }}>{r.titleKey}</span>
                {r.risk && (
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ background: `color-mix(in srgb, ${C.red} 12%, transparent)`, color: C.red }}>
                    <AlertTriangle size={9} /> {riskLabel}
                  </span>
                )}
                {!r.risk && r.total >= 5 && (
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ background: `color-mix(in srgb, ${C.green} 10%, transparent)`, color: C.green }}>
                    {healthyLabel}
                  </span>
                )}
              </div>
              <span className="text-[11px] tabular-nums" style={{ color: C.textMuted }}>{label}</span>
            </div>

            {/* Stacked bar: top-N gold, rest muted */}
            <div className="relative h-2 rounded-full overflow-hidden" style={{ background: C.surface }}>
              <div className="absolute inset-y-0 left-0"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
                }}
              />
            </div>

            {/* Top contributors list */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {r.topItems.slice(0, 5).map(it => {
                const itemPct = Math.round((it.positives / r.total) * 100);
                const inner = (
                  <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full border tabular-nums"
                    style={{ borderColor: C.border, color: C.textBody, background: `color-mix(in srgb, ${gold} 6%, transparent)` }}>
                    <span className="truncate max-w-[160px]" title={it.name}>{it.name}</span>
                    <span style={{ color: C.textDim }}>{itemPct}%</span>
                  </span>
                );
                if (r.hrefBase) return <Link key={it.id} href={`${r.hrefBase}${it.id}`}>{inner}</Link>;
                return <span key={it.id}>{inner}</span>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
