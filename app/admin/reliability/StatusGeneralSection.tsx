// Status General — para que el seller / app owner abra esta página y
// lea UN párrafo que resume todo lo que pasó en el tenant los últimos
// 7 días, sin tener que pedirle a Claude el status manualmente.

import { C } from "@/lib/design";
import { CheckCircle2, AlertTriangle, AlertCircle, Users, Send, MessageSquare, Clock, Sparkles } from "lucide-react";
import type { TenantSummary } from "@/lib/reliability-summary";

const gold = "var(--brand, #c9a83a)";

export default function StatusGeneralSection({ summary }: { summary: TenantSummary }) {
  const { paragraph, general } = summary;

  const verdict = general.health === "critical"
    ? { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 8%, transparent)", border: "color-mix(in srgb, #DC2626 32%, transparent)", icon: AlertTriangle, label: "Crítico" }
    : general.health === "warning"
      ? { fg: "#D97706", bg: "color-mix(in srgb, #D97706 8%, transparent)", border: "color-mix(in srgb, #D97706 32%, transparent)", icon: AlertCircle, label: "Atención" }
      : { fg: C.green, bg: `color-mix(in srgb, ${C.green} 8%, transparent)`, border: `color-mix(in srgb, ${C.green} 32%, transparent)`, icon: CheckCircle2, label: "Saludable" };
  const Icon = verdict.icon;

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 4px 12px -6px rgba(0,0,0,0.04)",
    }}>
      <header className="px-6 py-4 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
            <Sparkles size={13} />
          </div>
          <div>
            <h2 className="text-base font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Resumen ejecutivo</h2>
            <p className="text-[11px]" style={{ color: C.textMuted }}>Últimos {general.windowDays} días</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
          style={{ backgroundColor: verdict.bg, border: `1px solid ${verdict.border}`, color: verdict.fg }}>
          <Icon size={13} />
          <span className="text-[11px] font-bold uppercase tracking-wider">{verdict.label}</span>
        </div>
      </header>

      {/* The headline paragraph */}
      <div className="px-7 py-6 border-b relative overflow-hidden" style={{
        borderColor: C.border,
        background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 5%, ${C.card}) 100%)`,
      }}>
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{
          background: `linear-gradient(180deg, ${gold}, color-mix(in srgb, ${gold} 50%, transparent))`,
        }} />
        <p className="text-[16px] leading-[1.7] tracking-[-0.01em] pl-4"
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
        <KpiCell icon={<Users size={15} />} label="Leads activos" value={general.activeLeads.toLocaleString()} hint={`${general.activeCampaigns.toLocaleString()} flows activos`} />
        <KpiCell icon={<Send size={15} />} label="Mensajes enviados" value={general.totalMessagesSent.toLocaleString()} hint={`en ${general.windowDays}d`} />
        <KpiCell icon={<MessageSquare size={15} />} label="Reply rate" value={`${general.replyRatePct}%`} hint={`${general.totalReplies} respuestas · ${general.positiveReplies} positivas`} accent={general.replyRatePct >= 5} />
        <KpiCell icon={<Clock size={15} />} label="Último envío" value={formatRelative(general.lastSendAt)} hint={general.lastSendAt ? new Date(general.lastSendAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "sin envíos"} />
      </div>
    </section>
  );
}

function KpiCell({ icon, label, value, hint, accent = false }: { icon: React.ReactNode; label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="px-6 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_3%,transparent)]" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: C.textMuted }}>
        {icon}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">{label}</span>
      </div>
      <div className="text-[26px] font-bold tabular-nums leading-none mb-1"
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
