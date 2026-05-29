// Tenant health grid for the Status tab.
//
// Replaces the old chip strip ("q5 · f0 · s0") with a card per tenant
// carrying a 0-100 healthscore, color-coded border, and the four most
// telling numbers (sent today / queue / failed+stuck / cooldown). Click
// the card to drill into that tenant — same `?tenant=` param as before.
//
// Healthscore calc:
//   100 baseline. −30 per ghost, −15 per failed, −10 per stuck,
//   −5 per cooldown. Clamped to [0, 100]. Severity colors:
//     ≥85 green · 60-84 amber · <60 red.

import Link from "next/link";
import { C } from "@/lib/design";
import { CheckCircle2, AlertTriangle, Snowflake, Building2 } from "lucide-react";

export type TenantHealth = {
  bioId: string;
  name: string;
  sent24h: number;
  queued: number;
  failed: number;
  stuck: number;
  cooldown: number;
  ghost: number;
  health: number;
};

export function computeTenantHealth(input: {
  bioId: string;
  name: string;
  sent24h: number;
  queued: number;
  failed: number;
  stuck: number;
  cooldown: number;
  ghost: number;
}): TenantHealth {
  const raw = 100
    - input.ghost * 30
    - input.failed * 15
    - input.stuck * 10
    - input.cooldown * 5;
  const health = Math.max(0, Math.min(100, raw));
  return { ...input, health };
}

function severity(health: number): { color: string; label: string } {
  if (health >= 85) return { color: C.green, label: "OK" };
  if (health >= 60) return { color: "#D97706", label: "Atención" };
  return { color: C.red, label: "Crítico" };
}

export default function TenantHealthGrid({
  tenants,
  activeTenantId,
}: {
  tenants: TenantHealth[];
  activeTenantId: string | null;
}) {
  if (tenants.length === 0) {
    return (
      <div className="rounded-xl border p-5 text-sm text-center" style={{ borderColor: C.border, backgroundColor: C.card, color: C.textMuted }}>
        Sin actividad reciente en ningún tenant.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {/* "All tenants" reset card always first */}
      <Link
        href="/admin/reliability"
        prefetch={false}
        className="rounded-xl border px-4 py-3.5 transition-colors hover:bg-black/[0.02]"
        style={{
          borderColor: !activeTenantId ? C.linkedin : C.border,
          backgroundColor: !activeTenantId ? `color-mix(in srgb, ${C.linkedin} 6%, ${C.card})` : C.card,
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Building2 size={13} style={{ color: !activeTenantId ? C.linkedin : C.textMuted }} />
          <span className="text-[12px] font-bold" style={{ color: !activeTenantId ? C.linkedin : C.textPrimary }}>
            All tenants
          </span>
        </div>
        <p className="text-[10.5px]" style={{ color: C.textMuted }}>
          {tenants.length} con actividad · click cualquier card para filtrar
        </p>
      </Link>

      {tenants.map(t => {
        const sev = severity(t.health);
        const isActive = activeTenantId === t.bioId;
        return (
          <Link
            key={t.bioId}
            href={`/admin/reliability?tenant=${encodeURIComponent(t.bioId)}`}
            prefetch={false}
            className="rounded-xl border px-4 py-3.5 transition-shadow hover:shadow-md group"
            style={{
              borderColor: isActive ? sev.color : `color-mix(in srgb, ${sev.color} 22%, ${C.border})`,
              borderLeftWidth: 4,
              borderLeftColor: sev.color,
              backgroundColor: isActive ? `color-mix(in srgb, ${sev.color} 6%, ${C.card})` : C.card,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            {/* Header: tenant name + score */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-[13px] font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                {t.name}
              </p>
              <div className="shrink-0 text-right">
                <p className="text-[18px] font-bold tabular-nums leading-none" style={{ color: sev.color, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                  {t.health}
                </p>
                <p className="text-[8.5px] font-bold uppercase tracking-wider mt-0.5" style={{ color: sev.color }}>
                  {sev.label}
                </p>
              </div>
            </div>

            {/* Health bar */}
            <div className="h-1.5 rounded-full mb-2.5 overflow-hidden" style={{ backgroundColor: C.border }}>
              <div className="h-1.5 rounded-full" style={{ width: `${t.health}%`, backgroundColor: sev.color }} />
            </div>

            {/* 4 mini-KPIs */}
            <div className="grid grid-cols-4 gap-1.5 text-[10.5px]">
              <Mini label="Sent 24h" value={t.sent24h} color={C.textBody} />
              <Mini label="Queue" value={t.queued} color={t.queued > 0 ? C.linkedin : C.textDim} />
              <Mini label="Fail+Stuck" value={t.failed + t.stuck} color={t.failed + t.stuck > 0 ? C.red : C.textDim}
                icon={t.failed + t.stuck > 0 ? AlertTriangle : undefined} />
              <Mini label="Cooldown" value={t.cooldown} color={t.cooldown > 0 ? "#D97706" : C.textDim}
                icon={t.cooldown > 0 ? Snowflake : undefined} />
            </div>

            {t.health === 100 && (
              <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: C.green }}>
                <CheckCircle2 size={10} /> Limpio
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function Mini({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color: string;
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[8.5px] font-bold uppercase tracking-wider truncate" style={{ color: C.textDim }}>{label}</span>
      <span className="flex items-center gap-1 text-[13px] font-bold tabular-nums leading-tight" style={{ color }}>
        {Icon && <Icon size={9} style={{ color }} />}
        {value}
      </span>
    </div>
  );
}
