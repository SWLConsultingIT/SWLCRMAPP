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
      <header className="px-6 py-5 border-b flex items-center gap-3 flex-wrap" style={{
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

      {/* STUCK / FAILURE BREAKDOWN */}
      {campaignsStats.failureReasons.length > 0 ? (
        <div className="px-6 py-5 border-t" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertOctagon size={14} style={{ color: "#DC2626" }} />
            <h3 className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: "#DC2626", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {t("rel.flows.stuck.title")}
            </h3>
            <span className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>
              · {t("rel.flows.stuck.subtitle", { count: campaignsStats.failed, buckets: campaignsStats.failureReasons.length })}
            </span>
          </div>
          <div className="space-y-2">
            {campaignsStats.failureReasons.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3.5 rounded-xl transition-shadow hover:shadow-sm"
                style={{ backgroundColor: "color-mix(in srgb, #DC2626 4%, transparent)", border: "1px solid color-mix(in srgb, #DC2626 20%, transparent)" }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "color-mix(in srgb, #DC2626 12%, transparent)", color: "#DC2626" }}>
                  {iconForReason(r.reason)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold leading-tight" style={{ color: C.textPrimary }}>{renderReason(r.reason, t)}</p>
                  {r.sample && r.sample !== r.reason && (
                    <p className="text-[11px] truncate mt-1" style={{ color: C.textMuted }}>
                      <span className="font-mono text-[10.5px]">{r.sample}</span>
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[20px] font-bold tabular-nums leading-none"
                    style={{ color: "#DC2626", fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                    {r.count}
                  </div>
                  <div className="text-[9.5px] uppercase tracking-wider mt-0.5" style={{ color: C.textMuted }}>
                    {r.count === 1 ? t("rel.flows.stuck.messagesOne") : t("rel.flows.stuck.messagesMany")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : campaignsStats.stuckQueued > 0 ? (
        <div className="px-6 py-5 border-t" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2 mb-3">
            <PauseCircle size={14} style={{ color: "#D97706" }} />
            <h3 className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: "#D97706", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {t("rel.flows.stuck.title")}
            </h3>
            <span className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>
              · {t("rel.flows.stuck.subtitle", { count: campaignsStats.stuckQueued, buckets: campaignsStats.stuckBreakdown.length })}
            </span>
          </div>
          <div className="space-y-2">
            {campaignsStats.stuckBreakdown.map((b, i) => (
              <div key={i} className="rounded-xl p-3.5"
                style={{ backgroundColor: "color-mix(in srgb, #D97706 4%, transparent)", border: "1px solid color-mix(in srgb, #D97706 22%, transparent)" }}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)", color: "#D97706" }}>
                    {iconForReason(b.reason)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold leading-tight" style={{ color: C.textPrimary }}>{renderReason(b.reason, t)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[20px] font-bold tabular-nums leading-none"
                      style={{ color: "#D97706", fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                      {b.count}
                    </div>
                    <div className="text-[9.5px] uppercase tracking-wider mt-0.5" style={{ color: C.textMuted }}>
                      {b.count === 1 ? t("rel.flows.stuck.messagesOne") : t("rel.flows.stuck.messagesMany")}
                    </div>
                  </div>
                </div>
                {b.samples.length > 0 && (
                  <div className="ml-12 space-y-1 pt-1 border-t" style={{ borderColor: "color-mix(in srgb, #D97706 12%, transparent)" }}>
                    {b.samples.map((s, j) => (
                      <div key={j} className="text-[11px] flex items-center gap-2 pt-1.5 flex-wrap" style={{ color: C.textBody }}>
                        <span className="font-medium">{s.leadName}</span>
                        <span style={{ color: C.textMuted }}>· {s.channel}</span>
                        <span style={{ color: C.textMuted }}>· step {s.stepNumber}</span>
                        <span style={{ color: C.textMuted }}>· {s.ageDays}d</span>
                        <span className="font-medium truncate" style={{ color: C.textMuted }}>· {s.campaignName}</span>
                      </div>
                    ))}
                    {b.count > b.samples.length && (
                      <p className="text-[10.5px] pt-1.5 italic" style={{ color: C.textMuted }}>
                        {t("rel.flows.stuck.more", { count: b.count - b.samples.length })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
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
        <div className="px-6 py-5 flex items-center gap-2 flex-wrap">
          <Workflow size={14} style={{ color: gold }} />
          <h3 className="text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {t("rel.flows.cards.heading")}
          </h3>
          <span className="text-[10.5px]" style={{ color: C.textMuted }}>{t("rel.flows.cards.subheading")}</span>
        </div>
        {campaigns.length === 0 ? (
          <div className="px-6 pb-6">
            <div className="rounded-xl p-5 text-center" style={{ backgroundColor: C.bg, border: `1px dashed ${C.border}` }}>
              <Workflow size={20} style={{ color: C.textMuted, margin: "0 auto 8px" }} />
              <p className="text-[12.5px]" style={{ color: C.textMuted }}>{t("rel.flows.cards.empty")}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 px-6 pb-6">
              {campaigns.slice(0, 60).map(c => (
                <CampaignCard key={c.campaignId} campaign={c} bioId={summary.bioId} t={t} />
              ))}
            </div>
            {campaigns.length > 60 && (
              <div className="px-6 py-3 text-center text-[11px] border-t" style={{ borderColor: C.border, color: C.textMuted }}>
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
    <div className="px-5 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_3%,transparent)]" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: iconBg, color: iconFg }}>
          {icon}
        </div>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>{label}</span>
      </div>
      <div className="text-[26px] font-bold tabular-nums leading-none mb-1"
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
