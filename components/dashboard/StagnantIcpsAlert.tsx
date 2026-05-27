// Stagnant ICPs alert — sits at the top of the ICPs tab when the data
// shows ICPs with ≥ minContacted contacts but 0% reply rate (or 0%
// conversion). Surfaces a problem proactively so the operator doesn't
// have to read the table top-to-bottom looking for laggards.
//
// Click → /leads filtered to that ICP so the seller lands on the people
// they should investigate.

import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type StagnantIcpRow = {
  id: string;
  name: string;
  leads: number;
  contacted: number;
  responseRate: number;
  conversionRate: number;
  /** Optional reason override (e.g. "drop vs prior period"). */
  reason?: string;
};

export default function StagnantIcpsAlert({
  items,
  title,
  emptySubtitle,
  ctaLabel = "Review",
  reasonNoReplies = "0 replies on {contacted} contacted",
  reasonNoPositives = "0 positives on {replied} replies",
}: {
  items: StagnantIcpRow[];
  title: string;
  /** Description copy below the title — supports a {n} placeholder for
   * the count of flagged ICPs. */
  emptySubtitle: string;
  ctaLabel?: string;
  reasonNoReplies?: string;
  reasonNoPositives?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div
      className="relative rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: `color-mix(in srgb, #D97706 5%, var(--c-card))`,
        borderColor: `color-mix(in srgb, #D97706 38%, var(--c-border))`,
        boxShadow: `0 1px 0 color-mix(in srgb, #D97706 16%, transparent)`,
      }}
    >
      {/* Header strip */}
      <div className="px-4 py-2.5 flex items-center gap-2.5 border-b" style={{ borderColor: `color-mix(in srgb, #D97706 22%, transparent)` }}>
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg, #D97706 0%, #F59E0B 100%)",
            color: "#fff",
            boxShadow: "0 2px 6px color-mix(in srgb, #D97706 35%, transparent)",
          }}
        >
          <AlertTriangle size={12} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.18em]" style={{ color: "#B45309" }}>
            {title}
          </p>
          <p className="text-[11.5px] mt-0.5" style={{ color: C.textBody }}>
            {emptySubtitle.replace("{n}", String(items.length))}
          </p>
        </div>
      </div>

      {/* List */}
      <ul className="divide-y" style={{ borderColor: `color-mix(in srgb, #D97706 14%, var(--c-border))` }}>
        {items.map(it => {
          const reason = it.reason
            ?? (it.responseRate === 0
              ? reasonNoReplies.replace("{contacted}", String(it.contacted))
              : reasonNoPositives.replace("{replied}", String(Math.max(1, Math.round(it.contacted * it.responseRate / 100)))));
          return (
            <li key={it.id}>
              <Link
                href={`/leads?icp=${encodeURIComponent(it.id)}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-amber-100/50 group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary }}>
                    {it.name}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: C.textMuted }}>
                    {reason}
                  </p>
                </div>
                <span
                  className="hidden sm:inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] px-2 py-1 rounded-md transition-colors"
                  style={{
                    color: "#B45309",
                    backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)",
                  }}
                >
                  {ctaLabel}
                  <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
                </span>
                <ArrowRight size={13} style={{ color: C.textDim }} className="sm:hidden shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
