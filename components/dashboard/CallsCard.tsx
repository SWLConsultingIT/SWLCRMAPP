// Calls breakdown card — replaces the generic ChannelCard for the "call"
// channel on the Channels tab. Boss-feedback 2026-05-27: calls deserve a
// dedicated 5-sub-count view (Pending · Completed · Answered · Positive
// · Negative). Pure server component — no client interactivity, no
// function props.

import Link from "next/link";
import { Phone, ArrowUpRight } from "lucide-react";
import { C, T } from "@/lib/design";

const PHONE_COLOR = "#EA580C";

export default function CallsCard({
  pending, completed, answered, positive, negative, total,
  labels,
}: {
  pending: number;
  completed: number;
  answered: number;
  positive: number;
  negative: number;
  total: number;
  labels: {
    channel: string;
    eyebrow: string;
    pending: string;
    completed: string;
    answered: string;
    positive: string;
    negative: string;
    cta: string;
    totalUnit: string;
  };
}) {
  const items = [
    { label: labels.pending,   value: pending,   accent: "#94A3B8" },
    { label: labels.completed, value: completed, accent: C.textPrimary },
    { label: labels.answered,  value: answered,  accent: "#0A66C2" },
    { label: labels.positive,  value: positive,  accent: "#10B981" },
    { label: labels.negative,  value: negative,  accent: "#DC2626" },
  ];

  return (
    <Link
      href="/queue?tab=inbox&channel=call"
      className="relative rounded-2xl border overflow-hidden p-4 sm:p-5 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md flex flex-col"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        minHeight: 168,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${PHONE_COLOR} 14%, transparent)`, color: PHONE_COLOR }}
          >
            <Phone size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className={`${T.label} truncate`} style={{ color: C.textMuted }}>{labels.eyebrow}</p>
            <p className="text-[14px] font-bold leading-none mt-0.5 truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {labels.channel}
            </p>
          </div>
        </div>
        <ArrowUpRight size={14} className="shrink-0 opacity-30 transition-opacity" style={{ color: PHONE_COLOR }} />
      </div>

      <p className="mt-3 flex items-baseline gap-1.5">
        <span
          className="text-[28px] font-bold tabular-nums leading-none tracking-[-0.02em]"
          style={{ color: PHONE_COLOR, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
        >
          {total}
        </span>
        <span className="text-[10.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: C.textDim }}>
          {labels.totalUnit}
        </span>
      </p>

      <div className="mt-3 pt-3 grid grid-cols-5 gap-2" style={{ borderTop: `1px dashed ${C.border}` }}>
        {items.map((it, i) => (
          <div key={i} className="min-w-0">
            <p className="text-[8.5px] uppercase tracking-[0.12em] font-semibold truncate" style={{ color: C.textDim }} title={it.label}>
              {it.label}
            </p>
            <p
              className="text-[15px] font-bold tabular-nums mt-0.5"
              style={{ color: it.value > 0 ? it.accent : C.textDim, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
            >
              {it.value}
            </p>
          </div>
        ))}
      </div>
    </Link>
  );
}
