// Status Accounts — health de las cuentas externas (sellers/Unipile +
// Instantly mailboxes) por tenant.

import { C } from "@/lib/design";
import { Users, Mail, Share2, Pause, Power, Plug } from "lucide-react";
import type { TenantSummary } from "@/lib/reliability-summary";
import { getT } from "@/lib/i18n-server";

const gold = "var(--brand, #c9a83a)";

function initialsOf(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function StatusAccountsSection({ summary }: { summary: TenantSummary }) {
  const t = await getT();
  const { accounts } = summary;

  // Accent: amber if any seller is on cooldown OR Instantly missing, green otherwise.
  const anyCooldown = accounts.sellers.some(s => s.onRateLimitCooldown);
  const instantlyMissing = !accounts.instantlyWorkspace.configured;
  const accentColor = anyCooldown || instantlyMissing ? "#D97706" : C.green;

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      borderLeftWidth: 4,
      borderLeftColor: accentColor,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 18px -8px rgba(0,0,0,0.06)",
    }}>
      <header className="px-6 py-5 border-b" style={{
        borderColor: C.border,
        background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${accentColor} 3%, ${C.card}) 100%)`,
      }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
              color: "#1A1A2E",
              boxShadow: `0 3px 8px -2px color-mix(in srgb, ${gold} 30%, transparent)`,
            }}>
            <Plug size={15} />
          </div>
          <div>
            <h2 className="text-[17px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>{t("rel.accounts.title")}</h2>
            <p className="text-[11.5px] mt-0.5" style={{ color: C.textMuted }}>{t("rel.accounts.subtitle")}</p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px" style={{ backgroundColor: C.border }}>
        {/* SELLERS / UNIPILE */}
        <div className="p-6" style={{ backgroundColor: C.card }}>
          <div className="flex items-center gap-2 mb-4">
            <Share2 size={15} style={{ color: C.linkedin }} />
            <h3 className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{t("rel.accounts.sellers")}</h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ml-auto"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>
              {t("rel.accounts.sellers.total", { count: accounts.sellers.length })}
            </span>
          </div>

          {accounts.sellers.length === 0 ? (
            <div className="rounded-xl p-5 text-center" style={{ backgroundColor: C.bg, border: `1px dashed ${C.border}` }}>
              <Users size={20} style={{ color: C.textMuted, margin: "0 auto 8px" }} />
              <p className="text-[12px]" style={{ color: C.textMuted }}>{t("rel.accounts.sellers.empty")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.sellers.map(s => {
                const onCooldown = s.onRateLimitCooldown;
                const inactive = !s.active;
                const tone = inactive ? "muted" : onCooldown ? "warning" : "healthy";
                const toneFg = tone === "muted" ? C.textMuted : tone === "warning" ? "#D97706" : C.green;
                const toneBg = tone === "muted" ? C.surface : tone === "warning" ? "color-mix(in srgb, #D97706 8%, transparent)" : `color-mix(in srgb, ${C.green} 8%, transparent)`;
                const dailyPct = s.dailyLimit ? Math.min(100, Math.round((s.dailySentLast24h / s.dailyLimit) * 100)) : null;
                const StatusIcon = inactive ? Power : onCooldown ? Pause : Users;
                return (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl transition-shadow hover:shadow-sm"
                    style={{ backgroundColor: toneBg, border: `1px solid color-mix(in srgb, ${toneFg} 22%, transparent)` }}>
                    {/* Avatar with initials */}
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 relative"
                      style={{
                        background: tone === "healthy"
                          ? `linear-gradient(135deg, color-mix(in srgb, ${gold} 25%, transparent), color-mix(in srgb, ${gold} 8%, transparent))`
                          : tone === "warning"
                            ? `linear-gradient(135deg, color-mix(in srgb, #D97706 25%, transparent), color-mix(in srgb, #D97706 8%, transparent))`
                            : C.surface,
                        color: toneFg,
                        fontFamily: "var(--font-outfit), system-ui, sans-serif",
                        fontWeight: 800,
                        fontSize: 12,
                        letterSpacing: "0.04em",
                      }}>
                      {initialsOf(s.name)}
                      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: C.card, border: `1.5px solid ${toneFg}`, color: toneFg }}>
                        <StatusIcon size={9} />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary }}>{s.name}</p>
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: toneBg, color: toneFg, border: `1px solid color-mix(in srgb, ${toneFg} 30%, transparent)` }}>
                          {inactive ? t("rel.accounts.sellers.state.inactive") : onCooldown ? t("rel.accounts.sellers.state.cooldown") : t("rel.accounts.sellers.state.operational")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ color: C.textMuted }}>
                        <span>
                          <strong className="tabular-nums" style={{ color: C.textBody }}>{s.dailySentLast24h}</strong> {t("rel.accounts.sellers.sent24h")}
                          {s.dailyLimit ? ` / ${s.dailyLimit}` : ""}
                        </span>
                        {!s.unipileAccountId && <span style={{ color: "#DC2626" }}>{t("rel.accounts.sellers.noUnipile")}</span>}
                      </div>
                    </div>

                    {dailyPct !== null && (
                      <div className="w-24 shrink-0">
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: C.surface }}>
                          <div className="h-full transition-[width] duration-300" style={{
                            width: `${dailyPct}%`,
                            background: dailyPct >= 90 ? "#DC2626" : dailyPct >= 75 ? "#D97706" : gold,
                          }} />
                        </div>
                        <div className="text-[10px] mt-1 text-right tabular-nums font-semibold" style={{ color: dailyPct >= 90 ? "#DC2626" : C.textMuted }}>
                          {t("rel.accounts.sellers.capPct", { pct: dailyPct })}
                        </div>
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
            <h3 className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{t("rel.accounts.instantly")}</h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ml-auto"
              style={{
                backgroundColor: accounts.instantlyWorkspace.configured ? `color-mix(in srgb, ${C.green} 12%, transparent)` : "color-mix(in srgb, #D97706 12%, transparent)",
                color: accounts.instantlyWorkspace.configured ? C.green : "#D97706",
              }}>
              {accounts.instantlyWorkspace.configured ? t("rel.accounts.instantly.configured") : t("rel.accounts.instantly.missing")}
            </span>
          </div>

          {accounts.instantlyWorkspace.configured ? (
            <div className="space-y-2.5">
              <div className="rounded-xl p-3.5" style={{ backgroundColor: `color-mix(in srgb, ${C.email} 5%, transparent)`, border: `1px solid color-mix(in srgb, ${C.email} 22%, transparent)` }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] mb-1.5" style={{ color: C.email }}>{t("rel.accounts.instantly.workspace")}</p>
                <p className="text-[12px] font-mono break-all" style={{ color: C.textBody }}>
                  {accounts.instantlyWorkspace.workspaceId ?? "—"}
                </p>
              </div>
              <div className="rounded-xl p-3.5" style={{ backgroundColor: `color-mix(in srgb, ${C.email} 5%, transparent)`, border: `1px solid color-mix(in srgb, ${C.email} 22%, transparent)` }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] mb-1.5" style={{ color: C.email }}>{t("rel.accounts.instantly.campaignId")}</p>
                <p className="text-[12px] font-mono break-all" style={{ color: C.textBody }}>
                  {accounts.instantlyWorkspace.campaignId ?? "—"}
                </p>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: C.textMuted }}>
                {t("rel.accounts.instantly.help")}
              </p>
            </div>
          ) : (
            <div className="rounded-xl p-4" style={{ backgroundColor: "color-mix(in srgb, #D97706 5%, transparent)", border: "1px solid color-mix(in srgb, #D97706 28%, transparent)" }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)", color: "#D97706" }}>
                  <Mail size={14} />
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold mb-1" style={{ color: "#D97706" }}>{t("rel.accounts.instantly.notConfigured.title")}</p>
                  <p className="text-[11.5px] leading-relaxed" style={{ color: C.textBody }}>{t("rel.accounts.instantly.notConfigured.body")}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
