"use client";

// FlowCard — one card per active flow in the FlowsInFlight section.
// Header (always visible) shows name + health pill + leads count + 4
// mini stats. Click → expands inline to show the full per-flow detail
// (per-step breakdown, stuck WHY, failed + retry, last activity). No
// navigation to a separate page anymore.

import { useState } from "react";
import {
  ChevronDown, Send, MessageSquare, PauseCircle, AlertOctagon,
  Wifi, Key, FileWarning, AlertCircle, Ban, Link as LinkIcon, MailX,
  HelpCircle, Workflow, AlertTriangle, CheckCircle2, Users, Phone,
  Share2, Mail,
} from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import RetryButton from "./RetryButton";
import type { CampaignSummary } from "@/lib/reliability-summary";

const gold = "var(--brand, #c9a83a)";

function iconForReason(reason: string): React.ReactNode {
  const r = reason.toLowerCase();
  if (r.endsWith(".cooldown") || r.includes("rate limit") || r.includes("cooldown")) return <PauseCircle size={12} />;
  if (r.endsWith(".terminal") || r.includes("terminal")) return <Ban size={12} />;
  if (r.endsWith(".notaccepted") || r.includes("aceptar la conexión") || r.includes("accept the linkedin")) return <LinkIcon size={12} />;
  if (r.endsWith(".manualcall") || r.includes("llamada manual") || r.includes("manual call")) return <Phone size={12} />;
  if (r.endsWith(".noseller") || r.includes("sin seller") || r.includes("without an assigned")) return <Workflow size={12} />;
  if (r.endsWith(".cronlag") || r.includes("dispatcher")) return <Workflow size={12} />;
  if (r.includes("network") || r.includes("timeout")) return <Wifi size={12} />;
  if (r.includes("credencial") || r.includes("token")) return <Key size={12} />;
  if (r.includes("placeholder")) return <FileWarning size={12} />;
  if (r.includes("payload") || r.includes("inválido")) return <AlertCircle size={12} />;
  if (r.includes("baneada") || r.includes("deshabilitada")) return <Ban size={12} />;
  if (r.includes("linkedin")) return <LinkIcon size={12} />;
  if (r.includes("email")) return <MailX size={12} />;
  return <HelpCircle size={12} />;
}

function channelIcon(c: string): React.ReactNode {
  switch (c) {
    case "linkedin": return <Share2 size={11} />;
    case "email":    return <Mail size={11} />;
    case "call":     return <Phone size={11} />;
    default:         return <Workflow size={11} />;
  }
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

export default function FlowCard({ campaign }: { campaign: CampaignSummary }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  // Defensive: tolerate older cached payloads where these optional fields
  // weren't yet populated by the server (caused a runtime crash when the
  // page rendered with stale RSC data on first deploy).
  const stuckBuckets = campaign.stuckBuckets ?? [];
  const failureBuckets = campaign.failureBuckets ?? [];
  const stepBreakdown = campaign.stepBreakdown ?? [];
  const channels = campaign.channels ?? [];

  const tone = campaign.health === "critical"
    ? { fg: "#DC2626", bgSoft: "color-mix(in srgb, #DC2626 6%, transparent)", border: "color-mix(in srgb, #DC2626 35%, transparent)", icon: AlertTriangle, label: t("rel.flows.cards.health.critical") }
    : campaign.health === "warning"
      ? { fg: "#D97706", bgSoft: "color-mix(in srgb, #D97706 6%, transparent)", border: "color-mix(in srgb, #D97706 35%, transparent)", icon: AlertCircle, label: t("rel.flows.cards.health.warning") }
      : { fg: C.green, bgSoft: `color-mix(in srgb, ${C.green} 5%, transparent)`, border: `color-mix(in srgb, ${C.green} 30%, transparent)`, icon: CheckCircle2, label: t("rel.flows.cards.health.ok") };
  const Icon = tone.icon;

  function renderReason(reason: string) {
    return reason.startsWith("rel.stuck.reason.") ? t(reason) : reason;
  }

  return (
    <div className="rounded-xl border overflow-hidden transition-shadow hover:shadow-sm"
      style={{
        backgroundColor: tone.bgSoft,
        borderColor: tone.border,
        borderLeftWidth: 4,
        borderLeftColor: tone.fg,
      }}>
      {/* HEADER — clickable to toggle */}
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full text-left transition-colors hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_3%,transparent)]"
        style={{ backgroundColor: C.card }}>
        <div className="px-4 pt-3.5 pb-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <ChevronDown size={14} className="transition-transform shrink-0"
              style={{ color: C.textMuted, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} />
            <h3 className="text-[13.5px] font-bold leading-tight flex-1 min-w-0 truncate"
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
          <div className="flex items-center gap-1.5 text-[10.5px] flex-wrap pl-6" style={{ color: C.textMuted }}>
            <span className="font-bold uppercase tracking-wider" style={{ color: campaign.status === "active" ? C.green : C.textMuted }}>
              {campaign.status}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Users size={9} /> {campaign.totalLeads.toLocaleString()} {t("rel.flows.cards.leads")}</span>
            {campaign.lastActivityAt && <><span>·</span><span>{formatRelative(campaign.lastActivityAt)}</span></>}
            {channels.length > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  {channels.map(c => <span key={c} className="inline-flex items-center gap-0.5">{channelIcon(c)}</span>)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-px" style={{ backgroundColor: tone.border }}>
          <CardStat icon={<Send size={11} />} label={t("rel.flows.cards.stat.sent")} value={campaign.messagesSent} tone="neutral" />
          <CardStat icon={<MessageSquare size={11} />} label={t("rel.flows.cards.stat.replies")} value={campaign.replies} tone={campaign.replies > 0 ? "good" : "neutral"} />
          <CardStat icon={<PauseCircle size={11} />} label={t("rel.flows.cards.stat.stuck")} value={campaign.messagesStuck} tone={campaign.messagesStuck > 0 ? "warning" : "muted"} />
          <CardStat icon={<AlertOctagon size={11} />} label={t("rel.flows.cards.stat.failed")} value={campaign.messagesFailed} tone={campaign.messagesFailed > 0 ? "critical" : "muted"} />
        </div>
      </button>

      {/* EXPANDED BODY — inline detail. */}
      {open && (
        <div className="border-t" style={{ borderColor: tone.border, backgroundColor: C.card }}>
          {/* Step-by-step status */}
          {stepBreakdown.length > 0 && (
            <div className="px-4 py-3 border-b" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Workflow size={11} style={{ color: gold }} />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.08em]" style={{ color: gold }}>Per step</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10.5px]">
                  <thead>
                    <tr style={{ color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
                      <th className="text-left py-1.5 font-semibold uppercase tracking-wider">Step</th>
                      <th className="text-left font-semibold uppercase tracking-wider">Channel</th>
                      <th className="text-right font-semibold uppercase tracking-wider">Sent</th>
                      <th className="text-right font-semibold uppercase tracking-wider">Queued</th>
                      <th className="text-right font-semibold uppercase tracking-wider">Stuck</th>
                      <th className="text-right font-semibold uppercase tracking-wider">Failed</th>
                      <th className="text-right font-semibold uppercase tracking-wider">Draft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stepBreakdown.map(s => (
                      <tr key={s.stepNumber} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td className="py-1.5 font-bold tabular-nums" style={{ color: C.textPrimary }}>{s.stepNumber === 0 ? "CR" : s.stepNumber}</td>
                        <td>
                          <span className="inline-flex items-center gap-1" style={{ color: C.textMuted }}>
                            {s.channels.map(c => <span key={c} className="inline-flex items-center gap-0.5">{channelIcon(c)} {c}</span>)}
                          </span>
                        </td>
                        <td className="text-right tabular-nums" style={{ color: C.textBody }}>{s.sent}</td>
                        <td className="text-right tabular-nums" style={{ color: s.queued > 0 ? C.textBody : C.textMuted }}>{s.queued}</td>
                        <td className="text-right tabular-nums font-semibold" style={{ color: s.stuck > 0 ? "#D97706" : C.textMuted }}>{s.stuck}</td>
                        <td className="text-right tabular-nums font-semibold" style={{ color: s.failed > 0 ? "#DC2626" : C.textMuted }}>{s.failed}</td>
                        <td className="text-right tabular-nums" style={{ color: C.textMuted }}>{s.draft}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Stuck breakdown */}
          {stuckBuckets.length > 0 && (
            <div className="px-4 py-3 border-b" style={{ borderColor: C.border, backgroundColor: "color-mix(in srgb, #D97706 3%, transparent)" }}>
              <div className="flex items-center gap-1.5 mb-2">
                <PauseCircle size={11} style={{ color: "#D97706" }} />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.08em]" style={{ color: "#D97706" }}>
                  {t("rel.flows.stuck.title")}
                </span>
              </div>
              <div className="space-y-1.5">
                {stuckBuckets.map((b, i) => (
                  <div key={i} className="rounded-lg p-2.5"
                    style={{ backgroundColor: C.card, border: "1px solid color-mix(in srgb, #D97706 18%, transparent)" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                        style={{ backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)", color: "#D97706" }}>
                        {iconForReason(b.reason)}
                      </div>
                      <p className="text-[11px] font-semibold flex-1 min-w-0" style={{ color: C.textPrimary }}>
                        {renderReason(b.reason)}
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
            </div>
          )}

          {/* Failed breakdown + retry */}
          {failureBuckets.length > 0 && (
            <div className="px-4 py-3" style={{ backgroundColor: "color-mix(in srgb, #DC2626 3%, transparent)" }}>
              <div className="flex items-center gap-1.5 mb-2">
                <AlertOctagon size={11} style={{ color: "#DC2626" }} />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.08em]" style={{ color: "#DC2626" }}>
                  {t("rel.flows.cards.failedTitle")}
                </span>
              </div>
              <div className="space-y-1.5">
                {failureBuckets.map((b, i) => (
                  <div key={i} className="rounded-lg p-2.5"
                    style={{ backgroundColor: C.card, border: "1px solid color-mix(in srgb, #DC2626 18%, transparent)" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                        style={{ backgroundColor: "color-mix(in srgb, #DC2626 12%, transparent)", color: "#DC2626" }}>
                        {iconForReason(b.reason)}
                      </div>
                      <p className="text-[11px] font-semibold flex-1 min-w-0" style={{ color: C.textPrimary }}>{b.reason}</p>
                      <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: "#DC2626" }}>{b.count}</span>
                    </div>
                    {b.samples.length > 0 && (
                      <div className="pl-7 space-y-1.5">
                        {b.samples.map((s, j) => (
                          <div key={j} className="text-[10px] flex items-center gap-1.5 flex-wrap" style={{ color: C.textMuted }}>
                            <span className="font-medium" style={{ color: C.textBody }}>{s.leadName}</span>
                            <span>· {s.channel}</span>
                            <span>· step {s.stepNumber}</span>
                            <span>· {s.ageDays}d</span>
                            <RetryButton messageId={s.messageId} />
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
            </div>
          )}

          {/* All-clear footer if nothing's wrong */}
          {stuckBuckets.length === 0 && failureBuckets.length === 0 && (
            <div className="px-4 py-3 flex items-center gap-2 text-[11.5px]" style={{ color: C.green }}>
              <CheckCircle2 size={13} />
              <span>{t("rel.flows.stuck.empty")}</span>
            </div>
          )}
        </div>
      )}
    </div>
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
