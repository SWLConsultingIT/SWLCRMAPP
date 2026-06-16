// Status Campaigns — invites enviados, trabados, errores con razón
// agrupada y un sample del error_details original para diagnóstico.

import { C } from "@/lib/design";
import { Send, AlertOctagon, PauseCircle, Mail, Phone, Share2, CheckCircle2, Wifi, Key, FileWarning, AlertCircle, Ban, Link as LinkIcon, MailX, HelpCircle, Workflow } from "lucide-react";
import type { TenantSummary } from "@/lib/reliability-summary";

const gold = "var(--brand, #c9a83a)";

// Map failure reason buckets to a relevant icon so operators can scan
// the list visually and tell rate-limits from credential errors at a
// glance. Anything unknown falls back to HelpCircle.
function iconForReason(reason: string): React.ReactNode {
  const r = reason.toLowerCase();
  if (r.includes("rate limit")) return <PauseCircle size={14} />;
  if (r.includes("network") || r.includes("timeout")) return <Wifi size={14} />;
  if (r.includes("credencial") || r.includes("token")) return <Key size={14} />;
  if (r.includes("placeholder")) return <FileWarning size={14} />;
  if (r.includes("payload") || r.includes("inválido")) return <AlertCircle size={14} />;
  if (r.includes("baneada") || r.includes("deshabilitada")) return <Ban size={14} />;
  if (r.includes("linkedin")) return <LinkIcon size={14} />;
  if (r.includes("email")) return <MailX size={14} />;
  if (r.includes("no encontrado")) return <Workflow size={14} />;
  return <HelpCircle size={14} />;
}

export default function StatusCampaignsSection({ summary }: { summary: TenantSummary }) {
  const { campaigns } = summary;

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 4px 12px -6px rgba(0,0,0,0.04)",
    }}>
      <header className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `color-mix(in srgb, ${C.linkedin} 14%, transparent)`, color: C.linkedin }}>
            <Send size={13} />
          </div>
          <div>
            <h2 className="text-base font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Campañas en vuelo</h2>
            <p className="text-[11px]" style={{ color: C.textMuted }}>Qué salió, qué quedó trabado y por qué fallaron las cosas que fallaron.</p>
          </div>
        </div>
      </header>

      {/* KPI tiles — top row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px" style={{ backgroundColor: C.border }}>
        <Tile icon={<Share2 size={15} />} label="Invitaciones LinkedIn" value={campaigns.invitesSent} hint={`${campaigns.invitesAccepted} aceptadas · ${campaigns.invitesPending} pendientes`} tone="neutral" />
        <Tile icon={<Mail size={15} />} label="Emails enviados" value={campaigns.emailsSent} tone="neutral" />
        <Tile icon={<Phone size={15} />} label="Llamadas" value={campaigns.callsAttempted} tone="neutral" />
        <Tile icon={<PauseCircle size={15} />} label="Trabados en cola" value={campaigns.stuckQueued} hint="queued + no avanza" tone={campaigns.stuckQueued > 10 ? "warning" : campaigns.stuckQueued > 0 ? "muted" : "neutral"} />
        <Tile icon={<AlertOctagon size={15} />} label="Errores" value={campaigns.failed} tone={campaigns.failed >= 20 ? "critical" : campaigns.failed > 0 ? "warning" : "neutral"} />
      </div>

      {/* Failure reasons — only render if there are any */}
      {campaigns.failureReasons.length > 0 ? (
        <div className="px-6 py-5 border-t" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertOctagon size={14} style={{ color: "#DC2626" }} />
            <h3 className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: "#DC2626", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              ¿Por qué fallaron?
            </h3>
            <span className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>
              · {campaigns.failureReasons.length} categoría{campaigns.failureReasons.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-2">
            {campaigns.failureReasons.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3.5 rounded-xl transition-shadow hover:shadow-sm"
                style={{
                  backgroundColor: "color-mix(in srgb, #DC2626 4%, transparent)",
                  border: "1px solid color-mix(in srgb, #DC2626 20%, transparent)",
                }}>
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
                  <div className="text-[9.5px] uppercase tracking-wider mt-0.5" style={{ color: C.textMuted }}>
                    {r.count === 1 ? "mensaje" : "mensajes"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : campaigns.stuckQueued > 0 ? (
        <div className="px-6 py-5 border-t" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2 mb-3">
            <PauseCircle size={14} style={{ color: "#D97706" }} />
            <h3 className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: "#D97706", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              ¿Dónde están los trabados?
            </h3>
            <span className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>
              · {campaigns.stuckQueued} mensajes en {campaigns.stuckBreakdown.length} categoría{campaigns.stuckBreakdown.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-2">
            {campaigns.stuckBreakdown.map((b, i) => (
              <div key={i} className="rounded-xl p-3.5"
                style={{ backgroundColor: "color-mix(in srgb, #D97706 4%, transparent)", border: "1px solid color-mix(in srgb, #D97706 22%, transparent)" }}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)", color: "#D97706" }}>
                    <PauseCircle size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold leading-tight" style={{ color: C.textPrimary }}>{b.reason}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[20px] font-bold tabular-nums leading-none"
                      style={{ color: "#D97706", fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                      {b.count}
                    </div>
                    <div className="text-[9.5px] uppercase tracking-wider mt-0.5" style={{ color: C.textMuted }}>
                      {b.count === 1 ? "mensaje" : "mensajes"}
                    </div>
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
                        <span className="font-medium truncate" style={{ color: C.textMuted }}>· {s.campaignName}</span>
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
        </div>
      ) : (
        <div className="px-6 py-5 border-t flex items-center gap-3" style={{ borderColor: C.border, background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${C.green} 4%, ${C.card}) 100%)` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)`, color: C.green }}>
            <CheckCircle2 size={15} />
          </div>
          <div>
            <p className="text-[13.5px] font-semibold" style={{ color: C.textPrimary }}>Sin errores en la ventana</p>
            <p className="text-[11.5px]" style={{ color: C.textMuted }}>Todos los envíos se procesaron normalmente.</p>
          </div>
        </div>
      )}
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
