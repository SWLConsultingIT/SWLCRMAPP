// Flows in flight — merges what used to be StatusCampaignsSection +
// CampaignsListSection into a single section. The seller asked for one
// titled "Flows en vuelo" (i18n) that groups: top-line KPIs (invites/
// emails/calls/stuck/failed), the stuck-WHY breakdown, AND a grid of
// cards (one per flow) you click into for the per-campaign detail.

import { getT } from "@/lib/i18n-server";
import { C } from "@/lib/design";
import { Send, AlertOctagon, PauseCircle, Mail, Phone, Share2, CheckCircle2, Workflow } from "lucide-react";
import type { TenantSummary, CampaignSummary } from "@/lib/reliability-summary";
import FoldableSection from "./FoldableSection";
import FlowCard from "./FlowCard";

const gold = "var(--brand, #c9a83a)";

export default async function FlowsInFlightSection({
  summary,
  campaigns,
}: {
  summary: TenantSummary;
  campaigns: CampaignSummary[];
}) {
  const t = await getT();
  const { campaigns: campaignsStats } = summary;

  // Accent: red if many failures, amber if any issues, neutral otherwise.
  const accentColor = campaignsStats.failed >= 20
    ? "#DC2626"
    : (campaignsStats.failed > 0 || campaignsStats.stuckQueued > 10)
      ? "#D97706"
      : C.linkedin;

  const badge = (
    <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded-full"
      style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 30%, transparent)` }}>
      {t("rel.flows.cards.total", { count: campaigns.length })}
    </span>
  );

  return (
    <FoldableSection
      title={t("rel.flows.title")}
      subtitle={t("rel.flows.subtitle")}
      icon={<Send size={16} />}
      iconBg={`linear-gradient(135deg, ${C.linkedin}, color-mix(in srgb, ${C.linkedin} 72%, white))`}
      accentColor={accentColor}
      badge={badge}
      defaultOpen
    >
      {/* KPI TILES — top row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px" style={{ backgroundColor: C.border }}>
        <Tile icon={<Share2 size={15} />} label={t("rel.flows.kpi.linkedinInvites")} value={campaignsStats.invitesSent}
          hint={t("rel.flows.kpi.linkedinInvites.hint", { accepted: campaignsStats.invitesAccepted, pending: campaignsStats.invitesPending })}
          tone="neutral" />
        <Tile icon={<Mail size={15} />} label={t("rel.flows.kpi.emailsSent")} value={campaignsStats.emailsSent} tone="neutral" />
        <Tile icon={<Phone size={15} />} label={t("rel.flows.kpi.calls")} value={campaignsStats.callsAttempted} tone="neutral" />
        <Tile icon={<PauseCircle size={15} />} label={t("rel.flows.kpi.stuck")} value={campaignsStats.stuckQueued}
          hint={t("rel.flows.kpi.stuck.hint")}
          tone={campaignsStats.stuckQueued > 10 ? "warning" : campaignsStats.stuckQueued > 0 ? "muted" : "neutral"} />
        <Tile icon={<AlertOctagon size={15} />} label={t("rel.flows.kpi.errors")} value={campaignsStats.failed}
          tone={campaignsStats.failed >= 20 ? "critical" : campaignsStats.failed > 0 ? "warning" : "neutral"} />
      </div>

      {/* Global stuck-block removed per Fran 2026-06-16 — the stuck WHY
          now lives INSIDE each campaign card so you read it next to the
          flow it belongs to instead of having to mentally map a stuck
          message back to its campaign from a global list. */}
      {campaigns.length === 0 && campaignsStats.stuckQueued === 0 && campaignsStats.failed === 0 && (
        <div className="px-6 py-5 border-t flex items-center gap-3" style={{ borderColor: C.border, background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${C.green} 4%, ${C.card}) 100%)` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)`, color: C.green }}>
            <CheckCircle2 size={15} />
          </div>
          <p className="text-[13.5px] font-semibold" style={{ color: C.textPrimary }}>{t("rel.flows.stuck.empty")}</p>
        </div>
      )}

      {/* FLOW CARDS — vertical stack of individually-collapsible cards.
          Each FlowCard is a client component (toggleable inline) so the
          page doesn't grow into an endless wall when there are dozens of
          flows. Click the card header → expand to see step-by-step
          status + stuck/failed breakdowns + retry actions, all inline. */}
      <div className="border-t" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 2%, ${C.card})` }}>
        <div className="px-7 py-6 flex items-center gap-2 flex-wrap">
          <Workflow size={14} style={{ color: gold }} />
          <h3 className="text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {t("rel.flows.cards.heading")}
          </h3>
          <span className="text-[10.5px]" style={{ color: C.textMuted }}>{t("rel.flows.cards.subheading")}</span>
        </div>
        {campaigns.length === 0 ? (
          <div className="px-7 pb-7">
            <div className="rounded-xl p-7 text-center" style={{ backgroundColor: C.bg, border: `1px dashed ${C.border}` }}>
              <Workflow size={22} style={{ color: C.textMuted, margin: "0 auto 10px" }} />
              <p className="text-[12.5px]" style={{ color: C.textMuted }}>{t("rel.flows.cards.empty")}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 px-7 pb-7">
              {campaigns.slice(0, 80).map(c => (
                <FlowCard key={c.campaignId} campaign={c} />
              ))}
            </div>
            {campaigns.length > 80 && (
              <div className="px-7 py-4 text-center text-[11px] border-t" style={{ borderColor: C.border, color: C.textMuted }}>
                {t("rel.flows.cards.showingCap", { count: campaigns.length })}
              </div>
            )}
          </>
        )}
      </div>
    </FoldableSection>
  );
}

function Tile({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: number; hint?: string; tone: "neutral" | "warning" | "critical" | "muted" }) {
  const valueColor = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : C.textPrimary;
  const iconBg = tone === "critical"
    ? "color-mix(in srgb, #DC2626 10%, transparent)"
    : tone === "warning"
      ? "color-mix(in srgb, #D97706 10%, transparent)"
      : `color-mix(in srgb, ${gold} 8%, transparent)`;
  const iconFg = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : gold;
  return (
    <div className="px-6 py-5 transition-colors hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_3%,transparent)]" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: iconBg, color: iconFg }}>
          {icon}
        </div>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>{label}</span>
      </div>
      <div className="text-[28px] font-bold tabular-nums leading-none mb-1.5"
        style={{ color: valueColor, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
        {value.toLocaleString()}
      </div>
      {hint && <div className="text-[11px]" style={{ color: C.textMuted }}>{hint}</div>}
    </div>
  );
}
