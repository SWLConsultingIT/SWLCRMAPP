// Status Campaigns — invites enviados, trabados, errores con razón.
// Reemplaza el approach anterior de 6 collapsibles separados con un
// solo bloque integrado: 4 KPI tiles en la fila superior + tabla de
// errores agrupados por razón debajo.

import { C } from "@/lib/design";
import { Send, AlertOctagon, PauseCircle, Mail, Phone, Share2 } from "lucide-react";
import type { TenantSummary } from "@/lib/reliability-summary";

const gold = "var(--brand, #c9a83a)";

export default function StatusCampaignsSection({ summary }: { summary: TenantSummary }) {
  const { campaigns } = summary;

  return (
    <section className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <header className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
        <h2 className="text-base font-bold mb-0.5" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Status de campañas</h2>
        <p className="text-[12px]" style={{ color: C.textMuted }}>Qué se envió, qué quedó trabado y por qué fallaron las cosas que fallaron.</p>
      </header>

      {/* KPI tiles — top row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px" style={{ backgroundColor: C.border }}>
        <Tile icon={<Share2 size={14} />} label="Invitaciones LinkedIn" value={campaigns.invitesSent} hint={`${campaigns.invitesAccepted} aceptadas · ${campaigns.invitesPending} pendientes`} tone="neutral" />
        <Tile icon={<Mail size={14} />} label="Emails enviados" value={campaigns.emailsSent} tone="neutral" />
        <Tile icon={<Phone size={14} />} label="Llamadas" value={campaigns.callsAttempted} tone="neutral" />
        <Tile icon={<PauseCircle size={14} />} label="Trabados en cola" value={campaigns.stuckQueued} hint="queued + no avanza" tone={campaigns.stuckQueued > 10 ? "warning" : campaigns.stuckQueued > 0 ? "muted" : "neutral"} />
        <Tile icon={<AlertOctagon size={14} />} label="Errores" value={campaigns.failed} tone={campaigns.failed >= 20 ? "critical" : campaigns.failed > 0 ? "warning" : "neutral"} />
      </div>

      {/* Failure reasons — only render if there are any */}
      {campaigns.failureReasons.length > 0 ? (
        <div className="px-6 py-5 border-t" style={{ borderColor: C.border }}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "#DC2626", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            ¿Por qué fallaron?
          </h3>
          <div className="space-y-2">
            {campaigns.failureReasons.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-lg"
                style={{ backgroundColor: "color-mix(in srgb, #DC2626 4%, transparent)", border: "1px solid color-mix(in srgb, #DC2626 18%, transparent)" }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{r.reason}</p>
                  {r.sample && r.sample !== r.reason && (
                    <p className="text-[11px] truncate mt-0.5" style={{ color: C.textMuted }}>
                      Ejemplo: <span className="font-mono">{r.sample}</span>
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-bold tabular-nums" style={{ color: "#DC2626", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{r.count}</div>
                  <div className="text-[9.5px] uppercase tracking-wider" style={{ color: C.textMuted }}>mensajes</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : campaigns.stuckQueued > 0 ? (
        <div className="px-6 py-4 border-t" style={{ borderColor: C.border, backgroundColor: "color-mix(in srgb, #D97706 5%, transparent)" }}>
          <p className="text-[13px]" style={{ color: C.textBody }}>
            <strong style={{ color: "#D97706" }}>Atención:</strong> {campaigns.stuckQueued} mensajes están en cola sin avanzar. Posibles causas: lead todavía no aceptó la conexión, todos los sellers en rate-limit, o el cron del dispatcher dejó de correr.
          </p>
        </div>
      ) : (
        <div className="px-6 py-4 border-t flex items-center gap-2" style={{ borderColor: C.border }}>
          <Send size={14} style={{ color: C.green }} />
          <span className="text-[13px]" style={{ color: C.textBody }}>Sin errores en la ventana. Todos los envíos se procesaron.</span>
        </div>
      )}
    </section>
  );
}

function Tile({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: number; hint?: string; tone: "neutral" | "warning" | "critical" | "muted" }) {
  const valueColor = tone === "critical" ? "#DC2626" : tone === "warning" ? "#D97706" : C.textPrimary;
  return (
    <div className="px-5 py-3.5" style={{ backgroundColor: C.card }}>
      <div className="flex items-center gap-1.5 mb-1" style={{ color: C.textMuted }}>
        {icon}
        <span className="text-[10.5px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums" style={{ color: valueColor, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{value.toLocaleString()}</div>
      {hint && <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{hint}</div>}
    </div>
  );
}
