// Calls breakdown card — replaces the generic ChannelCard for the "call"
// channel on the Channels tab. Boss-feedback 2026-05-27: calls deserve a
// dedicated 5-sub-count view (Pending · Completed · Answered · Positive
// · Negative). Pure server component — no client interactivity, no
// function props.

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { Phone, ArrowUpRight } from "lucide-react";
import { C, T } from "@/lib/design";

const PHONE_COLOR = "#EA580C";

export default function CallsCard({
  pending, positive, negative, total,
  attempted, confirmedConnected, confirmedNotConnected, unknown, confirmedConnectRate,
  labels,
}: {
  pending: number;
  positive: number;
  negative: number;
  total: number;
  /** Distinct physical calls in the window. */
  attempted: number;
  confirmedConnected: number;
  confirmedNotConnected: number;
  /** Nobody logged an outcome. Shown ALWAYS, never folded into the rate. */
  unknown: number;
  /** connected / (connected + not connected). null when nothing is classified. */
  confirmedConnectRate: number | null;
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
  // The closed definitions, all five visible. Unknown sits beside the rate
  // instead of inside it: a percentage computed over 7 classified calls out
  // of 22 attempts means something different from one computed over 22, and
  // hiding that is how a dashboard lies without a single wrong number.
  const { t } = useLocale();
  const rate = confirmedConnectRate == null ? "—" : `${confirmedConnectRate.toFixed(1)}%`;
  const items = [
    { label: t("cc.attempted"), value: attempted, accent: C.textPrimary, hint: t("cc.attemptedHint") },
    { label: t("cc.confirmedConn"), value: confirmedConnected, accent: "#10B981", hint: t("cc.confirmedHint") },
    { label: t("cc.notConnected"), value: confirmedNotConnected, accent: "#DC2626", hint: t("cc.notConnHint") },
    { label: t("cc.unknown"), value: unknown, accent: "#94A3B8", hint: t("cc.unknownHint") },
    { label: t("cc.pending"), value: pending, accent: "#94A3B8", hint: t("cc.pendingHint") },
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

      <p className="mt-3 flex items-baseline gap-1.5 flex-wrap">
        <span
          className="text-[28px] font-bold tabular-nums leading-none tracking-[-0.02em]"
          style={{ color: PHONE_COLOR, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
        >
          {total}
        </span>
        <span className="text-[10.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: C.textDim }}>
          {labels.totalUnit}
        </span>
        <span
          className="ml-auto text-[11px] font-semibold tabular-nums"
          style={{ color: C.textMuted }}
          title={`Confirmed connect rate = confirmed connected / (confirmed connected + confirmed not connected). Unknown (${unknown}) is excluded from the denominator.`}
        >
          {rate} confirmed connect rate
        </span>
      </p>

      <div className="mt-3 pt-3 grid grid-cols-5 gap-2" style={{ borderTop: `1px dashed ${C.border}` }}>
        {items.map((it, i) => (
          <div key={i} className="min-w-0">
            <p className="text-[8.5px] uppercase tracking-[0.12em] font-semibold truncate" style={{ color: C.textDim }} title={it.hint}>
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
