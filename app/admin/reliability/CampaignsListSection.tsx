// CampaignsListSection — GRID DE CARDS (no filas). Cada card es una
// campaña con nombre prominente + health pill + 4 mini stats. Click
// → drill-in (?campaign=<id>).

import Link from "next/link";
import { C } from "@/lib/design";
import { Workflow, CheckCircle2, AlertTriangle, AlertCircle, Send, MessageSquare, PauseCircle, AlertOctagon, ChevronRight } from "lucide-react";
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
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 18px -8px rgba(0,0,0,0.06)",
    }}>
      <header className="px-6 py-5 border-b flex items-center gap-3" style={{ borderColor: C.border, background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 3%, ${C.card}) 100%)` }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E", boxShadow: `0 3px 8px -2px color-mix(in srgb, ${gold} 30%, transparent)` }}>
          <Workflow size={15} />
        </div>
        <div className="flex-1">
          <h2 className="text-[17px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>Campañas</h2>
          <p className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>Tocá una para entrar al detalle: dónde están los stuck, qué pasó por step, qué errores.</p>
        </div>
        <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 30%, transparent)` }}>
          {campaigns.length} totales
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-6">
        {campaigns.slice(0, 60).map(c => (
          <CampaignCard key={c.campaignId} campaign={c} bioId={bioId} />
        ))}
      </div>

      {campaigns.length > 60 && (
        <div className="px-6 py-3 text-center text-[11px] border-t" style={{ borderColor: C.border, color: C.textMuted }}>
          Mostrando 60 de {campaigns.length} campañas. Filtros próximamente.
        </div>
      )}
    </section>
  );
}

function CampaignCard({ campaign, bioId }: { campaign: CampaignSummary; bioId: string }) {
  const tone = campaign.health === "critical"
    ? { fg: "#DC2626", bgSoft: "color-mix(in srgb, #DC2626 6%, transparent)", border: "color-mix(in srgb, #DC2626 35%, transparent)", borderHover: "color-mix(in srgb, #DC2626 55%, transparent)", icon: AlertTriangle, label: "crítico" }
    : campaign.health === "warning"
      ? { fg: "#D97706", bgSoft: "color-mix(in srgb, #D97706 6%, transparent)", border: "color-mix(in srgb, #D97706 35%, transparent)", borderHover: "color-mix(in srgb, #D97706 55%, transparent)", icon: AlertCircle, label: "atención" }
      : { fg: C.green, bgSoft: `color-mix(in srgb, ${C.green} 5%, transparent)`, border: `color-mix(in srgb, ${C.green} 30%, transparent)`, borderHover: `color-mix(in srgb, ${C.green} 50%, transparent)`, icon: CheckCircle2, label: "ok" };
  const Icon = tone.icon;

  return (
    <Link
      href={`/admin/reliability?tenant=${bioId}&campaign=${campaign.campaignId}`}
      className="group block rounded-xl border overflow-hidden transition-all hover:-translate-y-0.5"
      style={{
        backgroundColor: tone.bgSoft,
        borderColor: tone.border,
        borderLeftWidth: 4,
        borderLeftColor: tone.fg,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      {/* Header — name + health pill */}
      <div className="px-4 pt-3.5 pb-2.5 border-b" style={{ borderColor: tone.border, backgroundColor: C.card }}>
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h3 className="text-[13.5px] font-bold leading-tight flex-1 min-w-0 line-clamp-2"
            style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}
            title={campaign.campaignName}>
            {campaign.campaignName}
          </h3>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full shrink-0"
            style={{ backgroundColor: tone.bgSoft, border: `1px solid ${tone.border}`, color: tone.fg }}>
            <Icon size={10} />
            <span className="text-[9px] font-bold uppercase tracking-[0.08em]">{tone.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: C.textMuted }}>
          <span className="font-bold uppercase tracking-wider" style={{ color: campaign.status === "active" ? C.green : C.textMuted }}>
            {campaign.status}
          </span>
          {campaign.lastActivityAt && (
            <>
              <span>·</span>
              <span>{formatRelative(campaign.lastActivityAt)}</span>
            </>
          )}
        </div>
      </div>

      {/* Stats — 4 columns */}
      <div className="grid grid-cols-4 gap-px" style={{ backgroundColor: tone.border }}>
        <CardStat icon={<Send size={11} />} label="Sent" value={campaign.messagesSent} tone="neutral" />
        <CardStat icon={<MessageSquare size={11} />} label="Replies" value={campaign.replies} tone={campaign.replies > 0 ? "good" : "neutral"} />
        <CardStat icon={<PauseCircle size={11} />} label="Stuck" value={campaign.messagesStuck} tone={campaign.messagesStuck > 0 ? "warning" : "muted"} />
        <CardStat icon={<AlertOctagon size={11} />} label="Failed" value={campaign.messagesFailed} tone={campaign.messagesFailed > 0 ? "critical" : "muted"} />
      </div>

      {/* CTA strip */}
      <div className="px-4 py-2 flex items-center justify-end gap-1 transition-colors group-hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_8%,transparent)]" style={{ backgroundColor: C.card, borderTop: `1px solid ${tone.border}` }}>
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: gold }}>Ver detalle</span>
        <ChevronRight size={12} style={{ color: gold }} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function CardStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "neutral" | "good" | "warning" | "critical" | "muted" }) {
  const fg = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : tone === "good" ? C.green : tone === "muted" ? C.textMuted : C.textPrimary;
  return (
    <div className="px-2 py-2 flex flex-col items-center text-center" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-1 mb-0.5" style={{ color: C.textMuted }}>
        {icon}
      </div>
      <div className="text-[16px] font-bold tabular-nums leading-none mb-0.5"
        style={{ color: fg, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
        {value.toLocaleString()}
      </div>
      <div className="text-[9px] uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</div>
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "hace seg";
  if (minutes < 60) return `hace ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}
