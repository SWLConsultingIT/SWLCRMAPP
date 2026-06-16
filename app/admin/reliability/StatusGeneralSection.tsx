// Status General — para que el seller / app owner abra esta página y
// lea UN párrafo que resume todo lo que pasó en el tenant los últimos
// 7 días, sin tener que pedirle a Claude el status manualmente.

import { C } from "@/lib/design";
import { CheckCircle2, AlertTriangle, AlertCircle, Users, Send, MessageSquare, Clock, Sparkles } from "lucide-react";
import type { TenantSummary } from "@/lib/reliability-summary";
import { getT } from "@/lib/i18n-server";

const gold = "var(--brand, #c9a83a)";

export default async function StatusGeneralSection({ summary }: { summary: TenantSummary }) {
  const t = await getT();
  const { paragraph, general } = summary;

  const verdict = general.health === "critical"
    ? { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 8%, transparent)", border: "color-mix(in srgb, #DC2626 32%, transparent)", icon: AlertTriangle, label: t("rel.general.verdict.critical") }
    : general.health === "warning"
      ? { fg: "#D97706", bg: "color-mix(in srgb, #D97706 8%, transparent)", border: "color-mix(in srgb, #D97706 32%, transparent)", icon: AlertCircle, label: t("rel.general.verdict.warning") }
      : { fg: C.green, bg: `color-mix(in srgb, ${C.green} 8%, transparent)`, border: `color-mix(in srgb, ${C.green} 32%, transparent)`, icon: CheckCircle2, label: t("rel.general.verdict.healthy") };
  const Icon = verdict.icon;

  // Map verdict to a left-edge accent color so the section reads as
  // green/amber/red without the operator having to look at the pill.
  const accentColor = verdict.fg;

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      borderLeftWidth: 4,
      borderLeftColor: accentColor,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 18px -8px rgba(0,0,0,0.06)",
    }}>
      <header className="px-7 py-6 border-b flex items-center justify-between gap-3 flex-wrap" style={{
        borderColor: C.border,
        background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 3%, ${C.card}) 100%)`,
      }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
              color: "#1A1A2E",
              boxShadow: `0 3px 8px -2px color-mix(in srgb, ${gold} 30%, transparent)`,
            }}>
            <Sparkles size={15} />
          </div>
          <div>
            <h2 className="text-[17px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>{t("rel.general.title")}</h2>
            <p className="text-[11.5px] mt-0.5" style={{ color: C.textMuted }}>{t("rel.general.windowDays", { days: general.windowDays })}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full"
          style={{
            backgroundColor: verdict.bg,
            border: `1.5px solid ${verdict.border}`,
            color: verdict.fg,
            boxShadow: `0 2px 8px -2px ${verdict.border}`,
          }}>
          <Icon size={13} />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em]">{verdict.label}</span>
        </div>
      </header>

      {/* The headline paragraph. Inner gold rail was removed 2026-06-16
          — it visually collided with the section's left-edge verdict
          accent (red/amber/green) at the seam. Soft gold-tinted backdrop
          alone is enough to signal "this is the summary card". */}
      <div className="px-8 py-7 border-b" style={{
        borderColor: C.border,
        background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 5%, ${C.card}) 100%)`,
      }}>
        <p className="text-[16px] leading-[1.7] tracking-[-0.01em]"
          style={{
            color: C.textPrimary,
            fontFamily: "var(--font-outfit), system-ui, sans-serif",
            fontWeight: 450,
          }}>
          {paragraph}
        </p>
      </div>

      {/* Supporting KPIs (small bullets under the paragraph) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ backgroundColor: C.border }}>
        <KpiCell icon={<Users size={15} />} label={t("rel.general.kpi.activeLeads")} value={general.activeLeads.toLocaleString()} hint={t("rel.general.kpi.activeLeads.hint", { count: general.activeCampaigns.toLocaleString() })} />
        <KpiCell icon={<Send size={15} />} label={t("rel.general.kpi.messagesSent")} value={general.totalMessagesSent.toLocaleString()} hint={t("rel.general.kpi.messagesSent.hint", { days: general.windowDays })} />
        <KpiCell icon={<MessageSquare size={15} />} label={t("rel.general.kpi.replyRate")} value={`${general.replyRatePct}%`} hint={t("rel.general.kpi.replyRate.hint", { total: general.totalReplies, positive: general.positiveReplies })} accent={general.replyRatePct >= 5} />
        <KpiCell icon={<Clock size={15} />} label={t("rel.general.kpi.lastSend")} value={formatRelative(general.lastSendAt)} hint={general.lastSendAt ? new Date(general.lastSendAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : t("rel.general.kpi.lastSend.empty")} />
      </div>
    </section>
  );
}

function KpiCell({ icon, label, value, hint, accent = false }: { icon: React.ReactNode; label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="px-7 py-5 transition-colors hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_3%,transparent)]" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-1.5 mb-2.5" style={{ color: C.textMuted }}>
        {icon}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">{label}</span>
      </div>
      <div className="text-[28px] font-bold tabular-nums leading-none mb-1.5"
        style={{
          color: accent ? gold : C.textPrimary,
          fontFamily: "var(--font-outfit), system-ui, sans-serif",
          letterSpacing: "-0.02em",
        }}>
        {value}
      </div>
      {hint && <div className="text-[11px]" style={{ color: C.textMuted }}>{hint}</div>}
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "hace segundos";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}
