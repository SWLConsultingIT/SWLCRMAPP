// Drill-in for ONE campaign: ?tenant=X&campaign=Y. Same structure as
// the tenant page but scoped to a single campaign — operator gets the
// per-step breakdown + stuck reasons + failure reasons in one place.

import Link from "next/link";
import { C } from "@/lib/design";
import { ArrowLeft, CheckCircle2, AlertTriangle, AlertCircle, Send, MessageSquare, PauseCircle, AlertOctagon, Share2, Mail, Phone, FileWarning, Key, Wifi, Ban, HelpCircle, Workflow, Link as LinkIcon, MailX } from "lucide-react";
import type { CampaignDetail } from "@/lib/reliability-summary";

const gold = "var(--brand, #c9a83a)";

function iconForReason(reason: string): React.ReactNode {
  const r = reason.toLowerCase();
  if (r.includes("rate limit") || r.includes("cooldown")) return <PauseCircle size={14} />;
  if (r.includes("network") || r.includes("timeout")) return <Wifi size={14} />;
  if (r.includes("credencial") || r.includes("token")) return <Key size={14} />;
  if (r.includes("placeholder")) return <FileWarning size={14} />;
  if (r.includes("payload") || r.includes("inválido")) return <AlertCircle size={14} />;
  if (r.includes("baneada") || r.includes("deshabilitada")) return <Ban size={14} />;
  if (r.includes("aceptar") || r.includes("conexión")) return <Share2 size={14} />;
  if (r.includes("llamada")) return <Phone size={14} />;
  if (r.includes("terminal")) return <CheckCircle2 size={14} />;
  if (r.includes("sin seller")) return <Workflow size={14} />;
  if (r.includes("dispatcher")) return <Workflow size={14} />;
  if (r.includes("linkedin")) return <LinkIcon size={14} />;
  if (r.includes("email")) return <MailX size={14} />;
  return <HelpCircle size={14} />;
}

function channelIcon(channel: string): React.ReactNode {
  const c = channel.toLowerCase();
  if (c === "linkedin") return <Share2 size={13} />;
  if (c === "email") return <Mail size={13} />;
  if (c === "call") return <Phone size={13} />;
  return <Workflow size={13} />;
}

export default function CampaignDetailSection({ detail }: { detail: CampaignDetail }) {
  const tone = detail.health === "critical"
    ? { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 8%, transparent)", border: "color-mix(in srgb, #DC2626 32%, transparent)", icon: AlertTriangle, label: "Crítico" }
    : detail.health === "warning"
      ? { fg: "#D97706", bg: "color-mix(in srgb, #D97706 8%, transparent)", border: "color-mix(in srgb, #D97706 32%, transparent)", icon: AlertCircle, label: "Atención" }
      : { fg: C.green, bg: `color-mix(in srgb, ${C.green} 8%, transparent)`, border: `color-mix(in srgb, ${C.green} 32%, transparent)`, icon: CheckCircle2, label: "Saludable" };
  const VerdictIcon = tone.icon;

  return (
    <div className="space-y-5">
      {/* Back link + header */}
      <div>
        <Link
          href={`/admin/reliability?tenant=${detail.bioId}`}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold mb-3 hover:opacity-70 transition-opacity"
          style={{ color: C.textMuted }}
        >
          <ArrowLeft size={12} />
          Volver a {detail.bioName}
        </Link>

        <section className="rounded-2xl border overflow-hidden" style={{
          backgroundColor: C.card,
          borderColor: C.border,
          boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 4px 12px -6px rgba(0,0,0,0.04)",
        }}>
          <header className="px-6 py-4 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
                <Workflow size={13} />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold leading-tight truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                  {detail.campaignName}
                </h2>
                <p className="text-[11px]" style={{ color: C.textMuted }}>
                  <span className="uppercase tracking-wider font-semibold">{detail.status}</span>
                  {detail.channels.length > 0 && <> · {detail.channels.join(" + ")}</>}
                  {detail.totalSteps > 0 && <> · {detail.totalSteps} steps</>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full shrink-0"
              style={{ backgroundColor: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}>
              <VerdictIcon size={13} />
              <span className="text-[11px] font-bold uppercase tracking-wider">{tone.label}</span>
            </div>
          </header>

          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-px" style={{ backgroundColor: C.border }}>
            <KpiTile icon={<Send size={14} />} label="Enviados" value={detail.messagesSent} tone="neutral" />
            <KpiTile icon={<MessageSquare size={14} />} label="Respuestas" value={detail.replies} hint={`${detail.positiveReplies} positivas`} tone={detail.replies > 0 ? "good" : "neutral"} />
            <KpiTile icon={<PauseCircle size={14} />} label="Trabados" value={detail.messagesStuck} tone={detail.messagesStuck > 10 ? "warning" : detail.messagesStuck > 0 ? "muted" : "neutral"} />
            <KpiTile icon={<AlertOctagon size={14} />} label="Errores" value={detail.messagesFailed} tone={detail.messagesFailed >= 10 ? "critical" : detail.messagesFailed > 0 ? "warning" : "neutral"} />
            <KpiTile icon={<Workflow size={14} />} label="En cola" value={detail.messagesQueued} tone="neutral" />
          </div>
        </section>
      </div>

      {/* Per-step breakdown */}
      {detail.steps.length > 0 && (
        <section className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
          <header className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
            <h3 className="text-base font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Status por step</h3>
            <p className="text-[11px]" style={{ color: C.textMuted }}>Cuántos mensajes hay en cada estado en cada paso de la secuencia.</p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ backgroundColor: C.bg }}>
                  <th className="text-left px-6 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: C.textMuted }}>Step</th>
                  <th className="text-left px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: C.textMuted }}>Canal</th>
                  <th className="text-right px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: C.textMuted }}>Sent</th>
                  <th className="text-right px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: C.textMuted }}>Queued</th>
                  <th className="text-right px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: C.textMuted }}>Stuck</th>
                  <th className="text-right px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: C.textMuted }}>Failed</th>
                  <th className="text-right px-6 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: C.textMuted }}>Draft</th>
                </tr>
              </thead>
              <tbody>
                {detail.steps.map(s => (
                  <tr key={s.stepNumber} className="border-t" style={{ borderColor: C.border }}>
                    <td className="px-6 py-2.5 font-semibold tabular-nums" style={{ color: C.textPrimary }}>{s.stepNumber === 0 ? "CR" : s.stepNumber}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider"
                        style={{ backgroundColor: `color-mix(in srgb, ${C.linkedin} 8%, transparent)`, color: C.textBody }}>
                        {channelIcon(s.channel)}
                        {s.channel}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: C.textPrimary }}>{s.sent}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: s.queued > 0 ? C.textPrimary : C.textMuted }}>{s.queued}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: s.stuck > 0 ? "#D97706" : C.textMuted }}>{s.stuck}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: s.failed > 0 ? "#DC2626" : C.textMuted }}>{s.failed}</td>
                    <td className="px-6 py-2.5 text-right tabular-nums" style={{ color: C.textMuted }}>{s.draft}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Stuck breakdown */}
      {detail.stuckBreakdown.length > 0 && (
        <section className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
          <header className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
            <h3 className="text-base font-bold leading-tight" style={{ color: "#D97706", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>¿Dónde están los trabados?</h3>
            <p className="text-[11px]" style={{ color: C.textMuted }}>Cada categoría con sample de leads afectados — todos pertenecen a esta campaña.</p>
          </header>
          <div className="p-6 space-y-2">
            {detail.stuckBreakdown.map((b, i) => (
              <div key={i} className="rounded-xl p-3.5"
                style={{ backgroundColor: "color-mix(in srgb, #D97706 4%, transparent)", border: "1px solid color-mix(in srgb, #D97706 22%, transparent)" }}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)", color: "#D97706" }}>
                    {iconForReason(b.reason)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold leading-tight" style={{ color: C.textPrimary }}>{b.reason}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[20px] font-bold tabular-nums leading-none"
                      style={{ color: "#D97706", fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                      {b.count}
                    </div>
                    <div className="text-[9.5px] uppercase tracking-wider mt-0.5" style={{ color: C.textMuted }}>{b.count === 1 ? "mensaje" : "mensajes"}</div>
                  </div>
                </div>
                {b.samples.length > 0 && (
                  <div className="ml-12 space-y-1 pt-1 border-t" style={{ borderColor: "color-mix(in srgb, #D97706 12%, transparent)" }}>
                    {b.samples.map((s, j) => (
                      <div key={j} className="text-[11px] flex items-center gap-2 pt-1.5" style={{ color: C.textBody }}>
                        <span className="font-medium">{s.leadName}</span>
                        <span style={{ color: C.textMuted }}>· {s.channel}</span>
                        <span style={{ color: C.textMuted }}>· step {s.stepNumber}</span>
                        <span style={{ color: C.textMuted }}>· hace {s.ageDays}d</span>
                      </div>
                    ))}
                    {b.count > b.samples.length && (
                      <p className="text-[10.5px] pt-1.5 italic" style={{ color: C.textMuted }}>+ {b.count - b.samples.length} más con el mismo problema</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Failure reasons */}
      {detail.failureReasons.length > 0 && (
        <section className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
          <header className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
            <h3 className="text-base font-bold leading-tight" style={{ color: "#DC2626", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>¿Por qué fallaron?</h3>
          </header>
          <div className="p-6 space-y-2">
            {detail.failureReasons.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3.5 rounded-xl"
                style={{ backgroundColor: "color-mix(in srgb, #DC2626 4%, transparent)", border: "1px solid color-mix(in srgb, #DC2626 20%, transparent)" }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "color-mix(in srgb, #DC2626 12%, transparent)", color: "#DC2626" }}>
                  {iconForReason(r.reason)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold leading-tight" style={{ color: C.textPrimary }}>{r.reason}</p>
                  {r.sample && r.sample !== r.reason && (
                    <p className="text-[11px] truncate mt-1" style={{ color: C.textMuted }}>
                      <span className="font-medium">Ejemplo:</span> <span className="font-mono text-[10.5px]">{r.sample}</span>
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[20px] font-bold tabular-nums leading-none"
                    style={{ color: "#DC2626", fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                    {r.count}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function KpiTile({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: number; hint?: string; tone: "neutral" | "good" | "warning" | "critical" | "muted" }) {
  const valueColor = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : tone === "good" ? gold : tone === "muted" ? C.textMuted : C.textPrimary;
  const iconBg = tone === "critical" ? "color-mix(in srgb, #DC2626 10%, transparent)"
    : tone === "warning" ? "color-mix(in srgb, #D97706 10%, transparent)"
    : tone === "good" ? `color-mix(in srgb, ${gold} 10%, transparent)`
    : `color-mix(in srgb, ${gold} 8%, transparent)`;
  const iconFg = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : gold;
  return (
    <div className="px-5 py-4" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: iconBg, color: iconFg }}>
          {icon}
        </div>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>{label}</span>
      </div>
      <div className="text-[24px] font-bold tabular-nums leading-none mb-1"
        style={{ color: valueColor, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
        {value.toLocaleString()}
      </div>
      {hint && <div className="text-[11px]" style={{ color: C.textMuted }}>{hint}</div>}
    </div>
  );
}
