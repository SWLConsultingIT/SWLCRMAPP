// Status Accounts — health de las cuentas externas (sellers/Unipile +
// Instantly mailboxes) por tenant.

import { C } from "@/lib/design";
import { Users, Mail, Share2, Pause, Power } from "lucide-react";
import type { TenantSummary } from "@/lib/reliability-summary";

const gold = "var(--brand, #c9a83a)";

export default function StatusAccountsSection({ summary }: { summary: TenantSummary }) {
  const { accounts } = summary;

  return (
    <section className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <header className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
        <h2 className="text-base font-bold mb-0.5" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Cuentas conectadas</h2>
        <p className="text-[12px]" style={{ color: C.textMuted }}>Sellers (LinkedIn vía Unipile) + workspace de Instantly. Si algo está en cooldown o desconectado, se ve acá.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px" style={{ backgroundColor: C.border }}>
        {/* SELLERS / UNIPILE */}
        <div className="p-6" style={{ backgroundColor: C.card }}>
          <div className="flex items-center gap-2 mb-4">
            <Share2 size={15} style={{ color: C.linkedin }} />
            <h3 className="text-[13px] font-bold uppercase tracking-wider" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Sellers · Unipile</h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ml-auto"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>
              {accounts.sellers.length} totales
            </span>
          </div>

          {accounts.sellers.length === 0 ? (
            <p className="text-[12px]" style={{ color: C.textMuted }}>No hay sellers configurados para este tenant.</p>
          ) : (
            <div className="space-y-2">
              {accounts.sellers.map(s => {
                const onCooldown = s.onRateLimitCooldown;
                const inactive = !s.active;
                const tone = inactive ? "muted" : onCooldown ? "warning" : "healthy";
                const toneFg = tone === "muted" ? C.textMuted : tone === "warning" ? "#D97706" : C.green;
                const toneBg = tone === "muted" ? C.surface : tone === "warning" ? "color-mix(in srgb, #D97706 8%, transparent)" : `color-mix(in srgb, ${C.green} 8%, transparent)`;
                const dailyPct = s.dailyLimit ? Math.min(100, Math.round((s.dailySentLast24h / s.dailyLimit) * 100)) : null;
                return (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg"
                    style={{ backgroundColor: toneBg, border: `1px solid color-mix(in srgb, ${toneFg} 22%, transparent)` }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: C.card, border: `1.5px solid ${toneFg}`, color: toneFg }}>
                      {inactive ? <Power size={13} /> : onCooldown ? <Pause size={13} /> : <Users size={13} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary }}>{s.name}</p>
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ backgroundColor: toneBg, color: toneFg, border: `1px solid color-mix(in srgb, ${toneFg} 30%, transparent)` }}>
                          {inactive ? "inactivo" : onCooldown ? "cooldown" : "operativo"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ color: C.textMuted }}>
                        <span>{s.dailySentLast24h} enviados últ. 24h{s.dailyLimit ? ` / ${s.dailyLimit} cap` : ""}</span>
                        {!s.unipileAccountId && <span style={{ color: "#DC2626" }}>· sin unipile_account_id</span>}
                      </div>
                    </div>
                    {dailyPct !== null && (
                      <div className="w-20 shrink-0">
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: C.surface }}>
                          <div className="h-full" style={{ width: `${dailyPct}%`, background: dailyPct >= 90 ? "#DC2626" : dailyPct >= 75 ? "#D97706" : gold }} />
                        </div>
                        <div className="text-[10px] mt-0.5 text-right tabular-nums" style={{ color: C.textMuted }}>{dailyPct}%</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* INSTANTLY MAILBOXES */}
        <div className="p-6" style={{ backgroundColor: C.card }}>
          <div className="flex items-center gap-2 mb-4">
            <Mail size={15} style={{ color: C.email }} />
            <h3 className="text-[13px] font-bold uppercase tracking-wider" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Instantly · Mailboxes</h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ml-auto"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>
              {accounts.instantlyWorkspace.configured ? "configurado" : "sin configurar"}
            </span>
          </div>

          {accounts.instantlyWorkspace.configured ? (
            <div className="space-y-3">
              <div className="rounded-lg p-3" style={{ backgroundColor: `color-mix(in srgb, ${C.email} 5%, transparent)`, border: `1px solid color-mix(in srgb, ${C.email} 22%, transparent)` }}>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.email }}>Workspace</p>
                <p className="text-[12px] font-mono break-all" style={{ color: C.textBody }}>
                  {accounts.instantlyWorkspace.workspaceId ?? "—"}
                </p>
              </div>
              <div className="rounded-lg p-3" style={{ backgroundColor: `color-mix(in srgb, ${C.email} 5%, transparent)`, border: `1px solid color-mix(in srgb, ${C.email} 22%, transparent)` }}>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.email }}>Instantly campaign ID</p>
                <p className="text-[12px] font-mono break-all" style={{ color: C.textBody }}>
                  {accounts.instantlyWorkspace.campaignId ?? "—"}
                </p>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: C.textMuted }}>
                Para revisar mailboxes individuales (warmup, bounces, reputación), abrir el dashboard de Instantly directamente. La integración del CRM no expone esos datos vía API todavía.
              </p>
            </div>
          ) : (
            <div className="rounded-lg p-4 text-center" style={{ backgroundColor: "color-mix(in srgb, #D97706 5%, transparent)", border: "1px solid color-mix(in srgb, #D97706 22%, transparent)" }}>
              <p className="text-[13px] font-semibold mb-1" style={{ color: "#D97706" }}>Instantly no configurado</p>
              <p className="text-[11px]" style={{ color: C.textBody }}>
                Este tenant no tiene <code>instantly_campaign_id</code> en company_bios. Los emails que se envíen no van a salir hasta que se configure el workspace.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
