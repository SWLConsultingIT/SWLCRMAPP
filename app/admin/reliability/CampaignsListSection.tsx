// CampaignsListSection — lista clickeable de campañas del tenant, con
// mini-stats por fila (sent / replies / stuck / failed) + health pill.
// Click → drill-in (?campaign=<id>).

import Link from "next/link";
import { C } from "@/lib/design";
import { Workflow, CheckCircle2, AlertTriangle, AlertCircle, ChevronRight, Send, MessageSquare, PauseCircle, AlertOctagon } from "lucide-react";
import type { CampaignSummary } from "@/lib/reliability-summary";

const gold = "var(--brand, #c9a83a)";

export default function CampaignsListSection({
  campaigns,
  bioId,
}: {
  campaigns: CampaignSummary[];
  bioId: string;
}) {
  if (campaigns.length === 0) {
    return (
      <section className="rounded-2xl border overflow-hidden p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-[13px]" style={{ color: C.textMuted }}>No hay campañas en este tenant todavía.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 4px 12px -6px rgba(0,0,0,0.04)",
    }}>
      <header className="px-6 py-4 border-b flex items-center gap-2.5" style={{ borderColor: C.border }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
          <Workflow size={13} />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Campañas</h2>
          <p className="text-[11px]" style={{ color: C.textMuted }}>Click en una campaña para abrir el detalle: dónde están los stuck, qué pasó por step, qué errores.</p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ backgroundColor: C.surface, color: C.textMuted }}>
          {campaigns.length} totales
        </span>
      </header>

      <div className="divide-y" style={{ borderColor: C.border }}>
        {campaigns.slice(0, 100).map(c => (
          <CampaignRow key={c.campaignId} campaign={c} bioId={bioId} />
        ))}
      </div>

      {campaigns.length > 100 && (
        <div className="px-6 py-3 text-center text-[11px] border-t" style={{ borderColor: C.border, color: C.textMuted }}>
          Mostrando 100 de {campaigns.length} campañas. Filtros próximamente.
        </div>
      )}
    </section>
  );
}

function CampaignRow({ campaign, bioId }: { campaign: CampaignSummary; bioId: string }) {
  const tone = campaign.health === "critical"
    ? { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 8%, transparent)", border: "color-mix(in srgb, #DC2626 30%, transparent)", icon: AlertTriangle, label: "crítico" }
    : campaign.health === "warning"
      ? { fg: "#D97706", bg: "color-mix(in srgb, #D97706 8%, transparent)", border: "color-mix(in srgb, #D97706 30%, transparent)", icon: AlertCircle, label: "atención" }
      : { fg: C.green, bg: `color-mix(in srgb, ${C.green} 8%, transparent)`, border: `color-mix(in srgb, ${C.green} 30%, transparent)`, icon: CheckCircle2, label: "ok" };
  const Icon = tone.icon;

  return (
    <Link
      href={`/admin/reliability?tenant=${bioId}&campaign=${campaign.campaignId}`}
      className="block px-6 py-3.5 transition-colors hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_3%,transparent)]"
    >
      <div className="flex items-center gap-3 flex-wrap">
        {/* Health pill */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full shrink-0"
          style={{ backgroundColor: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}>
          <Icon size={11} />
          <span className="text-[9.5px] font-bold uppercase tracking-wider">{tone.label}</span>
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {campaign.campaignName}
          </p>
          <p className="text-[10.5px] mt-0.5" style={{ color: C.textMuted }}>
            <span className="uppercase tracking-wider font-semibold">{campaign.status}</span>
            {campaign.lastActivityAt && (
              <> · último evento {formatRelative(campaign.lastActivityAt)}</>
            )}
          </p>
        </div>

        {/* Mini stats */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Stat icon={<Send size={11} />} value={campaign.messagesSent} tone="neutral" />
          <Stat icon={<MessageSquare size={11} />} value={campaign.replies} tone={campaign.replies > 0 ? "good" : "neutral"} />
          <Stat icon={<PauseCircle size={11} />} value={campaign.messagesStuck} tone={campaign.messagesStuck > 0 ? "warning" : "muted"} />
          <Stat icon={<AlertOctagon size={11} />} value={campaign.messagesFailed} tone={campaign.messagesFailed > 0 ? "critical" : "muted"} />
        </div>

        <ChevronRight size={14} style={{ color: C.textMuted }} className="shrink-0" />
      </div>
    </Link>
  );
}

function Stat({ icon, value, tone }: { icon: React.ReactNode; value: number; tone: "neutral" | "good" | "warning" | "critical" | "muted" }) {
  const fg = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : tone === "good" ? C.green : tone === "muted" ? C.textMuted : C.textBody;
  const bg = tone === "muted" ? "transparent" : tone === "critical"
    ? "color-mix(in srgb, #DC2626 8%, transparent)"
    : tone === "warning"
      ? "color-mix(in srgb, #D97706 8%, transparent)"
      : tone === "good"
        ? `color-mix(in srgb, ${C.green} 8%, transparent)`
        : "color-mix(in srgb, var(--brand, #c9a83a) 6%, transparent)";
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-md" style={{ backgroundColor: bg, color: fg }}>
      {icon}
      <span className="text-[11.5px] font-bold tabular-nums">{value}</span>
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
