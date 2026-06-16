// Silent-stall banner — surfaced ABOVE the executive summary when a
// tenant looks healthy (no failures, OK pill) but isn't actually sending
// anything despite due work. The gap the verdict pill alone misses.

import { AlertTriangle } from "lucide-react";
import { getT } from "@/lib/i18n-server";
import { C } from "@/lib/design";
import type { TenantSummary } from "@/lib/reliability-summary";

export default async function SilentStallBanner({ summary }: { summary: TenantSummary }) {
  if (!summary.silentStall.isStalled) return null;
  const t = await getT();
  const { hoursSinceLastSend, dueWork, reason } = summary.silentStall;
  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      borderColor: "color-mix(in srgb, #DC2626 32%, transparent)",
      borderLeftWidth: 4,
      borderLeftColor: "#DC2626",
      backgroundColor: "color-mix(in srgb, #DC2626 5%, transparent)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 18px -8px color-mix(in srgb, #DC2626 18%, transparent)",
    }}>
      <div className="px-7 py-5 flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg, #DC2626, color-mix(in srgb, #DC2626 70%, white))",
            color: "#fff",
            boxShadow: "0 4px 10px -3px color-mix(in srgb, #DC2626 40%, transparent)",
          }}>
          <AlertTriangle size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-[15px] font-bold leading-tight" style={{ color: "#DC2626", fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
              {t("rel.stall.title")}
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "#DC2626", color: "#fff" }}>
              ACTION REQUIRED
            </span>
          </div>
          <p className="text-[12.5px] leading-relaxed mb-1.5" style={{ color: C.textBody }}>
            {t("rel.stall.subtitle", { hours: hoursSinceLastSend ?? 0, due: dueWork })}
          </p>
          {reason && (
            <p className="text-[12px] font-semibold" style={{ color: C.textPrimary }}>
              → {t(reason)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
