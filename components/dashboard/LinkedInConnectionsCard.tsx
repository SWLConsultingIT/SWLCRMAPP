// LinkedIn Connections card — boss-feedback 2026-05-27. Separates the
// invite leg (Sent → Accepted → Accept rate) from the existing LinkedIn
// ChannelCard that tracks post-acceptance messaging. Server component.

import Link from "next/link";
import { UserPlus, ArrowUpRight } from "lucide-react";
import { C, T } from "@/lib/design";

const LI_COLOR = "#0A66C2";

export default function LinkedInConnectionsCard({
  sent, accepted,
  labels,
}: {
  sent: number;
  accepted: number;
  labels: {
    channel: string;
    eyebrow: string;
    sent: string;
    accepted: string;
    acceptRate: string;
    cta: string;
  };
}) {
  const rate = sent > 0 ? Math.round((accepted / sent) * 100) : 0;

  return (
    <Link
      href="/queue?tab=inbox&channel=linkedin"
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
            style={{ backgroundColor: `color-mix(in srgb, ${LI_COLOR} 14%, transparent)`, color: LI_COLOR }}
          >
            <UserPlus size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className={`${T.label} truncate`} style={{ color: C.textMuted }}>{labels.eyebrow}</p>
            <p className="text-[14px] font-bold leading-none mt-0.5 truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {labels.channel}
            </p>
          </div>
        </div>
        <ArrowUpRight size={14} className="shrink-0 opacity-30 group-hover:opacity-60 transition-opacity" style={{ color: LI_COLOR }} />
      </div>

      <div className="mt-3 flex items-baseline gap-2 flex-1">
        <span
          className="text-[36px] font-bold tabular-nums leading-none tracking-[-0.02em]"
          style={{ color: LI_COLOR, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
        >
          {rate}
          <span className="text-[18px] ml-0.5" style={{ color: C.textMuted }}>%</span>
        </span>
        <span className="text-[10.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: C.textDim }}>
          {labels.acceptRate}
        </span>
      </div>

      <div className="mt-3 pt-3 grid grid-cols-2 gap-2" style={{ borderTop: `1px dashed ${C.border}` }}>
        <div>
          <p className="text-[9px] uppercase tracking-[0.14em] font-semibold" style={{ color: C.textDim }}>{labels.sent}</p>
          <p className="text-[14px] font-bold tabular-nums mt-0.5" style={{ color: C.textPrimary }}>{sent.toLocaleString("en-US")}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-[0.14em] font-semibold" style={{ color: C.textDim }}>{labels.accepted}</p>
          <p className="text-[14px] font-bold tabular-nums mt-0.5" style={{ color: accepted > 0 ? "#10B981" : C.textDim }}>
            {accepted.toLocaleString("en-US")}
          </p>
        </div>
      </div>
    </Link>
  );
}
