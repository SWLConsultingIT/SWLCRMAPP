// GeneralOverview — what the "General" tab shows. Four foldable
// sections: cross-tenant summary KPIs, tenant health grid, n8n
// workflows (moved out of per-tenant), and every active seller across
// every tenant. The per-tenant tabs still own their own deep detail.

import Link from "next/link";
import {
  Globe, Users, Send, MessageSquare, PauseCircle, AlertOctagon, Clock,
  Workflow, CheckCircle2, AlertTriangle, AlertCircle, ChevronRight, Share2,
} from "lucide-react";
import { getT } from "@/lib/i18n-server";
import { C } from "@/lib/design";
import type { GlobalSummary } from "@/lib/reliability-summary";
import FoldableSection from "./FoldableSection";
import WorkflowsSection from "./WorkflowsSection";

const gold = "var(--brand, #c9a83a)";

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "seg";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function initialsOf(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function GeneralOverview({ global }: { global: GlobalSummary }) {
  const t = await getT();

  // ── 1. Global summary KPIs ──────────────────────────────────────────
  const summary = (
    <FoldableSection
      title={t("rel.global.summary.title")}
      subtitle={t("rel.global.summary.subtitle", { count: global.tenantCount, days: global.windowDays })}
      icon={<Globe size={16} />}
      defaultOpen
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ backgroundColor: C.border }}>
        <Kpi icon={<Users size={15} />} label={t("rel.global.kpi.activeLeads")} value={global.totalActiveLeads.toLocaleString()} hint={`${global.totalActiveFlows.toLocaleString()} ${t("rel.global.kpi.activeFlows").toLowerCase()}`} />
        <Kpi icon={<Send size={15} />} label={t("rel.global.kpi.messagesSent")} value={global.totalMessagesSent.toLocaleString()} hint={`${global.windowDays}d`} />
        <Kpi icon={<MessageSquare size={15} />} label={t("rel.global.kpi.replyRate")} value={`${global.replyRatePct}%`} hint={`${global.totalReplies} · ${global.positiveReplies} positive`} accent={global.replyRatePct >= 5} />
        <Kpi icon={<Clock size={15} />} label={t("rel.global.kpi.lastSend")} value={formatRelative(global.lastSendAt)} hint={global.lastSendAt ? new Date(global.lastSendAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—"} />
        <Kpi icon={<PauseCircle size={15} />} label={t("rel.global.kpi.stuck")} value={global.totalStuck.toLocaleString()} tone={global.totalStuck > 10 ? "warning" : "neutral"} />
        <Kpi icon={<AlertOctagon size={15} />} label={t("rel.global.kpi.failed")} value={global.totalFailed.toLocaleString()} tone={global.totalFailed > 0 ? "critical" : "neutral"} />
        <Kpi icon={<CheckCircle2 size={15} />} label="Healthy tenants" value={`${global.healthyCount}/${global.tenantCount}`} tone={global.healthyCount === global.tenantCount ? "good" : "neutral"} />
        <Kpi icon={<AlertTriangle size={15} />} label="Tenants needing attention" value={`${global.warningCount + global.criticalCount}`} tone={global.criticalCount > 0 ? "critical" : global.warningCount > 0 ? "warning" : "good"} />
      </div>
    </FoldableSection>
  );

  // ── 2. Tenant health grid ───────────────────────────────────────────
  const healthBadge = (
    <div className="flex items-center gap-1.5">
      {global.criticalCount > 0 && (
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "color-mix(in srgb, #DC2626 10%, transparent)", color: "#DC2626", border: "1px solid color-mix(in srgb, #DC2626 30%, transparent)" }}>
          {t("rel.global.health.critical", { n: global.criticalCount })}
        </span>
      )}
      {global.warningCount > 0 && (
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "color-mix(in srgb, #D97706 10%, transparent)", color: "#D97706", border: "1px solid color-mix(in srgb, #D97706 30%, transparent)" }}>
          {t("rel.global.health.warning", { n: global.warningCount })}
        </span>
      )}
      {global.healthyCount > 0 && (
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${C.green} 10%, transparent)`, color: C.green, border: `1px solid color-mix(in srgb, ${C.green} 30%, transparent)` }}>
          {t("rel.global.health.healthy", { n: global.healthyCount })}
        </span>
      )}
    </div>
  );
  const overallAccent = global.criticalCount > 0 ? "#DC2626" : global.warningCount > 0 ? "#D97706" : C.green;
  const healthGrid = (
    <FoldableSection
      title={t("rel.global.health.title")}
      subtitle={t("rel.global.health.subtitle")}
      icon={<CheckCircle2 size={16} />}
      accentColor={overallAccent}
      badge={healthBadge}
      defaultOpen
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-6">
        {global.tenants.map(tn => {
          const tone = tn.health === "critical"
            ? { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 6%, transparent)", border: "color-mix(in srgb, #DC2626 32%, transparent)", icon: AlertTriangle, label: "crítico" }
            : tn.health === "warning"
              ? { fg: "#D97706", bg: "color-mix(in srgb, #D97706 6%, transparent)", border: "color-mix(in srgb, #D97706 32%, transparent)", icon: AlertCircle, label: "atención" }
              : { fg: C.green, bg: `color-mix(in srgb, ${C.green} 6%, transparent)`, border: `color-mix(in srgb, ${C.green} 30%, transparent)`, icon: CheckCircle2, label: "ok" };
          const Icon = tone.icon;
          return (
            <Link key={tn.bioId} href={`/admin/reliability?tenant=${tn.bioId}`}
              className="group rounded-xl border overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{
                backgroundColor: tone.bg,
                borderColor: tone.border,
                borderLeftWidth: 4,
                borderLeftColor: tone.fg,
              }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: tone.border, backgroundColor: C.card }}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13.5px] font-bold leading-tight truncate"
                    style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
                    title={tn.bioName}>
                    {tn.bioName}
                  </h3>
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}>
                    <Icon size={10} />
                    <span className="text-[9px] font-bold uppercase tracking-[0.08em]">{tone.label}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-px" style={{ backgroundColor: tone.border }}>
                <MiniStat label="Leads" value={tn.activeLeads} tone="neutral" />
                <MiniStat label="Flows" value={tn.activeFlows} tone="neutral" />
                <MiniStat label="Stuck" value={tn.stuckQueued} tone={tn.stuckQueued > 0 ? "warning" : "muted"} />
                <MiniStat label="Failed" value={tn.failed} tone={tn.failed > 0 ? "critical" : "muted"} />
              </div>
              <div className="px-4 py-2 flex items-center justify-between text-[10.5px] gap-2"
                style={{ backgroundColor: C.card, borderTop: `1px solid ${tone.border}`, color: C.textMuted }}>
                <span>{tn.lastSendAt ? `last send ${formatRelative(tn.lastSendAt)}` : "sin envíos"}</span>
                <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider transition-transform group-hover:translate-x-0.5" style={{ color: gold }}>
                  abrir <ChevronRight size={11} />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </FoldableSection>
  );

  // ── 4. All sellers ───────────────────────────────────────────────────
  const sellersList = (
    <FoldableSection
      title={t("rel.global.sellers.title")}
      subtitle={t("rel.global.sellers.subtitle")}
      icon={<Share2 size={16} />}
      iconBg={`linear-gradient(135deg, ${C.linkedin}, color-mix(in srgb, ${C.linkedin} 72%, white))`}
      badge={(
        <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 30%, transparent)` }}>
          {global.sellers.length} total
        </span>
      )}
    >
      {global.sellers.length === 0 ? (
        <div className="px-7 py-6 text-[12.5px]" style={{ color: C.textMuted }}>
          {t("rel.global.sellers.empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px p-px" style={{ backgroundColor: C.border }}>
          {global.sellers.map(s => {
            const onCooldown = s.onRateLimitCooldown;
            const missingUnipile = !s.unipileAccountId;
            const pct = s.dailyLimit ? Math.min(100, Math.round((s.dailySentLast24h / s.dailyLimit) * 100)) : null;
            const barColor = pct !== null && pct >= 90 ? "#DC2626" : pct !== null && pct >= 75 ? "#D97706" : gold;
            const stateLabel = missingUnipile ? "sin unipile" : onCooldown ? "cooldown" : "operativo";
            const stateColor = missingUnipile ? "#DC2626" : onCooldown ? "#D97706" : C.green;
            const stateBg = `color-mix(in srgb, ${stateColor} 10%, transparent)`;
            return (
              <div key={s.id} className="px-6 py-5" style={{ backgroundColor: C.card }}>
                {/* Header row: avatar + name + state pill */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-bold text-[13px]"
                    style={{
                      background: `linear-gradient(135deg, color-mix(in srgb, ${stateColor} 25%, transparent), color-mix(in srgb, ${stateColor} 8%, transparent))`,
                      color: stateColor,
                      border: `1px solid color-mix(in srgb, ${stateColor} 22%, transparent)`,
                    }}>
                    {initialsOf(s.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold leading-tight truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }} title={s.name}>
                      {s.name}
                    </p>
                    <p className="text-[10.5px] mt-0.5 truncate" style={{ color: C.textMuted }} title={s.tenantNames.join(" · ")}>
                      {s.tenantNames.join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.08em] px-2 py-1 rounded-full"
                    style={{ backgroundColor: stateBg, color: stateColor, border: `1px solid color-mix(in srgb, ${stateColor} 28%, transparent)` }}>
                    {stateLabel}
                  </span>
                </div>

                {/* Daily-cap progress bar — full width, large number on the left */}
                {pct !== null ? (
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[20px] font-bold tabular-nums leading-none"
                          style={{ color: pct >= 90 ? "#DC2626" : pct >= 75 ? "#D97706" : C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                          {s.dailySentLast24h}
                        </span>
                        <span className="text-[11px] tabular-nums" style={{ color: C.textMuted }}>
                          / {s.dailyLimit} sent 24h
                        </span>
                      </div>
                      <span className="text-[11px] font-bold tabular-nums"
                        style={{ color: pct >= 90 ? "#DC2626" : pct >= 75 ? "#D97706" : C.textMuted }}>
                        {pct}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: C.surface }}>
                      <div className="h-full transition-[width] duration-300 rounded-full"
                        style={{ width: `${Math.max(2, pct)}%`, background: `linear-gradient(90deg, ${barColor}, color-mix(in srgb, ${barColor} 75%, white))` }} />
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px]" style={{ color: C.textMuted }}>Sin límite diario configurado.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </FoldableSection>
  );

  return (
    <>
      {summary}
      {healthGrid}
      <WorkflowsSection />
      {sellersList}
    </>
  );
}

function Kpi({ icon, label, value, hint, tone = "neutral", accent = false }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: "neutral" | "warning" | "critical" | "good"; accent?: boolean }) {
  const valueColor = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : tone === "good" ? C.green : accent ? gold : C.textPrimary;
  return (
    <div className="px-6 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_3%,transparent)]" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-1.5 mb-2" style={{ color: C.textMuted }}>
        {icon}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">{label}</span>
      </div>
      <div className="text-[24px] font-bold tabular-nums leading-none mb-1"
        style={{ color: valueColor, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {hint && <div className="text-[11px]" style={{ color: C.textMuted }}>{hint}</div>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "neutral" | "warning" | "critical" | "muted" }) {
  const fg = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : tone === "muted" ? C.textMuted : C.textPrimary;
  return (
    <div className="px-2 py-2 flex flex-col items-center text-center" style={{ backgroundColor: C.card }}>
      <div className="text-[16px] font-bold tabular-nums leading-none mb-0.5"
        style={{ color: fg, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
        {value.toLocaleString()}
      </div>
      <div className="text-[9px] uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</div>
    </div>
  );
}
