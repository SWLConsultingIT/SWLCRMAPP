// Flows in flight — merges what used to be StatusCampaignsSection +
// CampaignsListSection into a single section. The seller asked for one
// titled "Flows en vuelo" (i18n) that groups: top-line KPIs (invites/
// emails/calls/stuck/failed), the stuck-WHY breakdown, AND a grid of
// cards (one per flow) you click into for the per-campaign detail.

import Link from "next/link";
import { getT } from "@/lib/i18n-server";
import { C } from "@/lib/design";
import {
  Send, AlertOctagon, PauseCircle, Mail, Phone, Share2, CheckCircle2,
  Wifi, Key, FileWarning, AlertCircle, Ban, Link as LinkIcon, MailX,
  HelpCircle, Workflow, MessageSquare, ChevronRight, AlertTriangle,
} from "lucide-react";
import type { TenantSummary, CampaignSummary } from "@/lib/reliability-summary";

const gold = "var(--brand, #c9a83a)";

function iconForReason(reason: string): React.ReactNode {
  // Either an i18n key (stuck buckets) or a free-text label (failure
  // reasons from error_details) — match both shapes.
  const r = reason.toLowerCase();
  if (r.endsWith(".cooldown") || r.includes("rate limit") || r.includes("cooldown")) return <PauseCircle size={14} />;
  if (r.endsWith(".terminal") || r.includes("terminal")) return <Ban size={14} />;
  if (r.endsWith(".notaccepted") || r.includes("aceptar la conexión") || r.includes("accept the linkedin")) return <LinkIcon size={14} />;
  if (r.endsWith(".manualcall") || r.includes("llamada manual") || r.includes("manual call")) return <Phone size={14} />;
  if (r.endsWith(".noseller") || r.includes("sin seller") || r.includes("without an assigned")) return <Workflow size={14} />;
  if (r.endsWith(".cronlag") || r.includes("dispatcher")) return <Workflow size={14} />;
  if (r.includes("network") || r.includes("timeout")) return <Wifi size={14} />;
  if (r.includes("credencial") || r.includes("token")) return <Key size={14} />;
  if (r.includes("placeholder")) return <FileWarning size={14} />;
  if (r.includes("payload") || r.includes("inválido")) return <AlertCircle size={14} />;
  if (r.includes("baneada") || r.includes("deshabilitada")) return <Ban size={14} />;
  if (r.includes("linkedin")) return <LinkIcon size={14} />;
  if (r.includes("email")) return <MailX size={14} />;
  return <HelpCircle size={14} />;
}

// Stuck reasons come back as i18n keys (e.g. "rel.stuck.reason.cooldown")
// — translate them when rendering. Failure reasons are free text from
// error_details, so they pass through unchanged.
function renderReason(reason: string, t: (k: string, vars?: Record<string, string | number>) => string): string {
  if (reason.startsWith("rel.stuck.reason.")) return t(reason);
  return reason;
}

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

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      borderLeftWidth: 4,
      borderLeftColor: accentColor,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 18px -8px rgba(0,0,0,0.06)",
    }}>
      <header className="px-7 py-6 border-b flex items-center gap-3 flex-wrap" style={{
        borderColor: C.border,
        background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${accentColor} 3%, ${C.card}) 100%)`,
      }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${C.linkedin}, color-mix(in srgb, ${C.linkedin} 72%, white))`,
            color: "#fff",
            boxShadow: `0 3px 8px -2px color-mix(in srgb, ${C.linkedin} 30%, transparent)`,
          }}>
          <Send size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
            {t("rel.flows.title")}
          </h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: C.textMuted }}>{t("rel.flows.subtitle")}</p>
        </div>
        <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded-full shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 30%, transparent)` }}>
          {t("rel.flows.cards.total", { count: campaigns.length })}
        </span>
      </header>

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

      {/* CARDS GRID — one per flow, click → drill in */}
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 px-7 pb-7">
              {campaigns.slice(0, 60).map(c => (
                <CampaignCard key={c.campaignId} campaign={c} bioId={summary.bioId} t={t} />
              ))}
            </div>
            {campaigns.length > 60 && (
              <div className="px-7 py-4 text-center text-[11px] border-t" style={{ borderColor: C.border, color: C.textMuted }}>
                {t("rel.flows.cards.showingCap", { count: campaigns.length })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
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

function CampaignCard({ campaign, bioId, t }: { campaign: CampaignSummary; bioId: string; t: (k: string, vars?: Record<string, string | number>) => string }) {
  const tone = campaign.health === "critical"
    ? { fg: "#DC2626", bgSoft: "color-mix(in srgb, #DC2626 6%, transparent)", border: "color-mix(in srgb, #DC2626 35%, transparent)", icon: AlertTriangle, label: t("rel.flows.cards.health.critical") }
    : campaign.health === "warning"
      ? { fg: "#D97706", bgSoft: "color-mix(in srgb, #D97706 6%, transparent)", border: "color-mix(in srgb, #D97706 35%, transparent)", icon: AlertCircle, label: t("rel.flows.cards.health.warning") }
      : { fg: C.green, bgSoft: `color-mix(in srgb, ${C.green} 5%, transparent)`, border: `color-mix(in srgb, ${C.green} 30%, transparent)`, icon: CheckCircle2, label: t("rel.flows.cards.health.ok") };
  const Icon = tone.icon;

  return (
    <Link
      href={`/admin/reliability?tenant=${bioId}&campaign=${campaign.campaignId}`}
      className="group block rounded-xl border overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={{
        backgroundColor: tone.bgSoft,
        borderColor: tone.border,
        borderLeftWidth: 4,
        borderLeftColor: tone.fg,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
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
          {campaign.lastActivityAt && <><span>·</span><span>{formatRelative(campaign.lastActivityAt)}</span></>}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px" style={{ backgroundColor: tone.border }}>
        <CardStat icon={<Send size={11} />} label={t("rel.flows.cards.stat.sent")} value={campaign.messagesSent} tone="neutral" />
        <CardStat icon={<MessageSquare size={11} />} label={t("rel.flows.cards.stat.replies")} value={campaign.replies} tone={campaign.replies > 0 ? "good" : "neutral"} />
        <CardStat icon={<PauseCircle size={11} />} label={t("rel.flows.cards.stat.stuck")} value={campaign.messagesStuck} tone={campaign.messagesStuck > 0 ? "warning" : "muted"} />
        <CardStat icon={<AlertOctagon size={11} />} label={t("rel.flows.cards.stat.failed")} value={campaign.messagesFailed} tone={campaign.messagesFailed > 0 ? "critical" : "muted"} />
      </div>

      {/* Per-card stuck breakdown — moved here from the global block.
          Always visible when there ARE stuck rows so you read WHY this
          specific flow isn't advancing without leaving the card. */}
      {campaign.stuckBuckets.length > 0 && (
        <div className="px-3 py-2.5 border-t space-y-1.5" style={{ borderColor: tone.border, backgroundColor: "color-mix(in srgb, #D97706 3%, transparent)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <PauseCircle size={11} style={{ color: "#D97706" }} />
            <span className="text-[9.5px] font-bold uppercase tracking-[0.08em]" style={{ color: "#D97706" }}>
              {t("rel.flows.stuck.title")}
            </span>
          </div>
          {campaign.stuckBuckets.map((b, i) => (
            <div key={i} className="rounded-lg p-2"
              style={{ backgroundColor: C.card, border: "1px solid color-mix(in srgb, #D97706 18%, transparent)" }}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)", color: "#D97706" }}>
                  {iconForReason(b.reason)}
                </div>
                <p className="text-[11px] font-semibold leading-tight flex-1 min-w-0" style={{ color: C.textPrimary }}>
                  {renderReason(b.reason, t)}
                </p>
                <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: "#D97706" }}>{b.count}</span>
              </div>
              {b.samples.length > 0 && (
                <div className="pl-7 space-y-0.5">
                  {b.samples.map((s, j) => (
                    <div key={j} className="text-[10px] flex items-center gap-1.5 flex-wrap" style={{ color: C.textMuted }}>
                      <span className="font-medium" style={{ color: C.textBody }}>{s.leadName}</span>
                      <span>· {s.channel}</span>
                      <span>· step {s.stepNumber}</span>
                      <span>· {s.ageDays}d</span>
                    </div>
                  ))}
                  {b.count > b.samples.length && (
                    <p className="text-[9.5px] italic" style={{ color: C.textMuted }}>
                      {t("rel.flows.stuck.more", { count: b.count - b.samples.length })}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-2 flex items-center justify-end gap-1 transition-colors group-hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_8%,transparent)]" style={{ backgroundColor: C.card, borderTop: `1px solid ${tone.border}` }}>
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: gold }}>{t("rel.flows.cards.viewDetail")}</span>
        <ChevronRight size={12} style={{ color: gold }} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function CardStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "neutral" | "good" | "warning" | "critical" | "muted" }) {
  const fg = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : tone === "good" ? C.green : tone === "muted" ? C.textMuted : C.textPrimary;
  return (
    <div className="px-2 py-2 flex flex-col items-center text-center" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-1 mb-0.5" style={{ color: C.textMuted }}>{icon}</div>
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
  if (minutes < 1) return "seg";
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
