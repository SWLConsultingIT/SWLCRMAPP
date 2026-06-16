// Status General — para que el seller / app owner abra esta página y
// lea UN párrafo que resume todo lo que pasó en el tenant los últimos
// 7 días, sin tener que pedirle a Claude el status manualmente.
//
// Server component (no client logic — el paragraph y los KPIs vienen
// pre-calculados de lib/reliability-summary.getTenantSummary()).

import { C } from "@/lib/design";
import { CheckCircle2, AlertTriangle, AlertCircle, Users, Send, MessageSquare, Clock } from "lucide-react";
import type { TenantSummary } from "@/lib/reliability-summary";

const gold = "var(--brand, #c9a83a)";

export default function StatusGeneralSection({ summary }: { summary: TenantSummary }) {
  const { paragraph, general } = summary;

  const verdict = general.health === "critical"
    ? { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 8%, transparent)", border: "color-mix(in srgb, #DC2626 30%, transparent)", icon: AlertTriangle, label: "Crítico" }
    : general.health === "warning"
      ? { fg: "#D97706", bg: "color-mix(in srgb, #D97706 8%, transparent)", border: "color-mix(in srgb, #D97706 30%, transparent)", icon: AlertCircle, label: "Atención" }
      : { fg: C.green, bg: `color-mix(in srgb, ${C.green} 8%, transparent)`, border: `color-mix(in srgb, ${C.green} 30%, transparent)`, icon: CheckCircle2, label: "Saludable" };
  const Icon = verdict.icon;

  return (
    <section className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <header className="px-6 py-4 border-b flex items-center justify-between gap-3" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Status general</h2>
          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: C.surface, color: C.textMuted }}>
            últimos {general.windowDays} días
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ backgroundColor: verdict.bg, border: `1px solid ${verdict.border}`, color: verdict.fg }}>
          <Icon size={13} />
          <span className="text-[11px] font-bold uppercase tracking-wider">{verdict.label}</span>
        </div>
      </header>

      {/* The headline paragraph */}
      <div className="px-6 py-5 border-b" style={{ borderColor: C.border, background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 4%, ${C.card}) 100%)` }}>
        <p className="text-[15px] leading-relaxed" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
          {paragraph}
        </p>
      </div>

      {/* Supporting KPIs (small bullets under the paragraph) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ backgroundColor: C.border }}>
        <KpiCell icon={<Users size={14} />} label="Leads activos" value={general.activeLeads.toLocaleString()} hint={`${general.activeCampaigns.toLocaleString()} flows activos`} />
        <KpiCell icon={<Send size={14} />} label="Mensajes enviados" value={general.totalMessagesSent.toLocaleString()} hint={`en ${general.windowDays}d`} />
        <KpiCell icon={<MessageSquare size={14} />} label="Reply rate" value={`${general.replyRatePct}%`} hint={`${general.totalReplies} respuestas · ${general.positiveReplies} positivas`} />
        <KpiCell icon={<Clock size={14} />} label="Último envío" value={formatRelative(general.lastSendAt)} hint={general.lastSendAt ? new Date(general.lastSendAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "sin envíos"} />
      </div>
    </section>
  );
}

function KpiCell({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="px-5 py-3" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-1.5 mb-1" style={{ color: C.textMuted }}>
        {icon}
        <span className="text-[10.5px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{value}</div>
      {hint && <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{hint}</div>}
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
