// New Dashboard (2026-05-26). Drops the Live / Reports tab split — the page
// IS the analytics now, ordered from company-wide → channels → ICPs →
// campaigns → sellers. Every table row drills into a dedicated detail view
// (/dashboard/campaign/[name], /dashboard/icp/[id], /dashboard/seller/[id]).
// The PDF export lives in /reports as a checklist menu that respects the
// caller's tenant scope.

import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Users, Send, MessageSquare, ThumbsUp, Trophy, CheckCircle2,
  Megaphone, Target, TrendingUp, Sparkles, AlertTriangle,
  Lightbulb, ArrowRight, Share2, Mail, Phone, Smartphone,
  FileDown,
} from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getDashboardData } from "@/lib/dashboard-data";
import PageHero from "@/components/PageHero";
import ReliabilityBanner from "@/components/ReliabilityBanner";
import KpiCard from "@/components/dashboard/KpiCard";
import Funnel from "@/components/dashboard/Funnel";
import MultiLineChart from "@/components/dashboard/MultiLineChart";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2,        color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,          color: "#059669", label: "Email" },
  call:     { icon: Phone,         color: "#EA580C", label: "Llamadas" },
  whatsapp: { icon: Smartphone,    color: "#25D366", label: "WhatsApp" },
};

function parseFilters(sp: Record<string, string | string[] | undefined>) {
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v ?? null;
  };
  return {
    from: get("from"),
    to: get("to"),
    campaignNames: [] as string[],
    sellerIds: [] as string[],
    icpIds: [] as string[],
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = await getUserScope();
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) {
    redirect("/onboarding");
  }

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const data = await getDashboardData(filters);

  const { headline, deltas, trend30d } = data;

  return (
    <div className="p-4 sm:p-6 w-full space-y-6">
      <ReliabilityBanner />

      {/* ─── Hero ──────────────────────────────────────────────────────── */}
      <PageHero
        icon={TrendingUp}
        section="Sales Engine"
        title="Tu pipeline, en profundidad"
        description="De lo general a lo específico: hacé clic en cualquier ICP, campaña o seller para abrir su detalle con gráficos."
        accentColor={gold}
        status={{ label: `${data.period.days} días`, active: true }}
        action={(
          <Link
            href="/reports"
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-85"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`, color: "#04070d", boxShadow: `0 1px 6px color-mix(in srgb, ${gold} 28%, transparent)` }}
          >
            <FileDown size={13} /> Descargar reporte
          </Link>
        )}
      />

      {/* ─── 1. Hero KPIs ────────────────────────────────────────────────
          Six headline metrics that answer "how are we doing right now?". Each
          card carries the delta vs prior period + a 30d sparkline so the
          trajectory is read alongside the absolute. */}
      <section>
        <SectionHeader
          title="Resumen general"
          subtitle="Métricas principales con tendencia 30 días"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard
            label="Leads totales"
            value={headline.totalLeads.toLocaleString("es-AR")}
            icon={Users}
            accent={C.gold}
            hint={`${data.activeCampaignCount} campañas activas`}
            href="/leads"
          />
          <KpiCard
            label="Contactados"
            value={headline.contactedLeads.toLocaleString("es-AR")}
            delta={deltas.contacted}
            trend={trend30d.sent}
            icon={Send}
            accent="#0A66C2"
            hint={`${headline.acceptanceRate}% aceptaron`}
          />
          <KpiCard
            label="Respuestas"
            value={headline.repliedCount.toLocaleString("es-AR")}
            delta={deltas.replied}
            trend={trend30d.replies}
            icon={MessageSquare}
            accent="#7C3AED"
            hint={`${headline.responseRate}% tasa de respuesta`}
            href="/queue?tab=inbox"
          />
          <KpiCard
            label="Positivas"
            value={headline.positiveCount.toLocaleString("es-AR")}
            delta={deltas.positive}
            trend={trend30d.positive}
            icon={ThumbsUp}
            accent={C.green}
            hint={`${headline.positiveRate}% de los que responden`}
            href="/opportunities"
          />
          <KpiCard
            label="Reuniones"
            value={headline.meetingCount.toLocaleString("es-AR")}
            icon={Target}
            accent="#F59E0B"
            hint="Leads marcados como qualified"
            href="/opportunities"
          />
          <KpiCard
            label="Ganados"
            value={headline.wonCount.toLocaleString("es-AR")}
            icon={Trophy}
            accent="#DC2626"
            hint="Cerrados en closed_won"
          />
        </div>
      </section>

      {/* ─── 2. Insights ─────────────────────────────────────────────────
          Auto-generated short prose strings, max 4. Surfaces the biggest
          movement / outlier so the seller doesn't have to scan tables. */}
      {data.insights.length > 0 && (
        <section>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.insights.map((ins, i) => {
              const tone =
                ins.tone === "positive" ? { color: C.green, bg: `color-mix(in srgb, ${C.green} 8%, transparent)`, Icon: CheckCircle2 }
                : ins.tone === "warning" ? { color: C.red, bg: `color-mix(in srgb, ${C.red} 8%, transparent)`, Icon: AlertTriangle }
                : { color: gold, bg: `color-mix(in srgb, ${gold} 8%, transparent)`, Icon: Lightbulb };
              const Ic = tone.Icon;
              return (
                <div key={i} className="rounded-xl border p-3.5 flex items-start gap-3"
                  style={{ borderColor: C.border, backgroundColor: tone.bg }}>
                  <Ic size={16} style={{ color: tone.color }} className="shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>{ins.text}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── 3. Funnel + 30d trend (side by side on wide screens) ────── */}
      <section>
        <SectionHeader
          title="Conversión y actividad"
          subtitle="Embudo de conversión + actividad de los últimos 30 días"
        />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Embudo de conversión" subtitle="De importados a ganados">
            <Funnel stages={data.funnel} />
          </Card>
          <Card title="Actividad 30 días" subtitle="Enviados / respuestas / positivas">
            <MultiLineChart series={[
              { name: "Enviados",  color: "#0A66C2", data: trend30d.sent },
              { name: "Respuestas", color: "#7C3AED", data: trend30d.replies },
              { name: "Positivas",  color: C.green,    data: trend30d.positive },
            ]} />
          </Card>
        </div>
      </section>

      {/* ─── 4. Channel breakdown ────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Performance por canal"
          subtitle="Qué canal está moviendo la aguja"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {data.channelBreakdown.length === 0 ? (
            <EmptyHint>Sin actividad por canal todavía.</EmptyHint>
          ) : data.channelBreakdown.map(ch => {
            const meta = channelMeta[ch.channel] ?? { icon: Share2, color: C.textMuted, label: ch.channel };
            const Icon = meta.icon;
            return (
              <div key={ch.channel} className="rounded-2xl border p-4"
                style={{ borderColor: C.border, backgroundColor: C.card, borderLeft: `3px solid ${meta.color}` }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-7 h-7 rounded-md flex items-center justify-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
                    <Icon size={13} />
                  </span>
                  <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{meta.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Stat label="Enviados" value={ch.sent} />
                  <Stat label="Contactados" value={ch.contacted} />
                  <Stat label="Respondieron" value={ch.replied} />
                  <Stat label="Positivos" value={ch.positive} accent={C.green} />
                </div>
                <div className="mt-3 pt-3 border-t flex items-center justify-between text-[11px]"
                  style={{ borderColor: C.border, color: C.textMuted }}>
                  <span>
                    <span className="font-semibold" style={{ color: meta.color }}>{ch.responseRate}%</span> resp · <span className="font-semibold" style={{ color: C.green }}>{ch.conversionRate}%</span> conv
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── 5. ICP performance ──────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Performance por ICP"
          subtitle="Qué perfil ideal convierte mejor"
        />
        <Card title={null} subtitle={null}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                  <th className="text-left px-4 py-2 font-semibold">ICP</th>
                  <th className="text-right px-3 py-2 font-semibold">Leads</th>
                  <th className="text-right px-3 py-2 font-semibold">Contactados</th>
                  <th className="text-right px-3 py-2 font-semibold">Respondieron</th>
                  <th className="text-right px-3 py-2 font-semibold">Positivos</th>
                  <th className="text-right px-3 py-2 font-semibold">Tasa resp</th>
                  <th className="text-right px-3 py-2 font-semibold">Conversión</th>
                  <th className="w-8 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.icpPerformance.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>Sin ICPs aprobados todavía.</td></tr>
                ) : data.icpPerformance.map(icp => (
                  <tr key={icp.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2.5">
                      {icp.id !== "_unknown" ? (
                        <Link href={`/dashboard/icp/${icp.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>
                          {icp.name}
                        </Link>
                      ) : (
                        <span style={{ color: C.textMuted }}>{icp.name}</span>
                      )}
                    </td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{icp.leads}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{icp.contacted}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{icp.replied}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums font-semibold" style={{ color: icp.positive > 0 ? C.green : C.textMuted }}>{icp.positive}</td>
                    <td className="text-right px-3 py-2.5">
                      <RateBadge value={icp.responseRate} color="#7C3AED" />
                    </td>
                    <td className="text-right px-3 py-2.5">
                      <RateBadge value={icp.conversionRate} color={C.green} />
                    </td>
                    <td className="px-2 py-2.5" style={{ color: C.textDim }}>
                      {icp.id !== "_unknown" && <Link href={`/dashboard/icp/${icp.id}`}><ArrowRight size={12} /></Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* ─── 6. Campaign performance ─────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Performance por campaña"
          subtitle="Comparativo de secuencias activas y pasadas"
        />
        <Card title={null} subtitle={null}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                  <th className="text-left px-4 py-2 font-semibold">Campaña</th>
                  <th className="text-left px-3 py-2 font-semibold">Canales</th>
                  <th className="text-right px-3 py-2 font-semibold">Leads</th>
                  <th className="text-right px-3 py-2 font-semibold">Enviados</th>
                  <th className="text-right px-3 py-2 font-semibold">Respond.</th>
                  <th className="text-right px-3 py-2 font-semibold">Positivos</th>
                  <th className="text-right px-3 py-2 font-semibold">Conversión</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="w-8 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.campaignPerformance.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>Sin campañas en este período.</td></tr>
                ) : data.campaignPerformance.map(c => (
                  <tr key={c.name} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/campaign/${encodeURIComponent(c.name)}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {c.channels.map(ch => {
                          const m = channelMeta[ch] ?? channelMeta.email;
                          const Ic = m.icon;
                          return <Ic key={ch} size={12} style={{ color: m.color }} />;
                        })}
                      </div>
                    </td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{c.leads}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{c.sent}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{c.replied}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums font-semibold" style={{ color: c.positive > 0 ? C.green : C.textMuted }}>{c.positive}</td>
                    <td className="text-right px-3 py-2.5">
                      <RateBadge value={c.conversionRate} color={C.green} />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-2 py-2.5" style={{ color: C.textDim }}>
                      <Link href={`/dashboard/campaign/${encodeURIComponent(c.name)}`}><ArrowRight size={12} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* ─── 7. Seller leaderboard ───────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Sellers"
          subtitle="Quién está moviendo el pipeline"
        />
        <Card title={null} subtitle={null}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                  <th className="text-left px-4 py-2 font-semibold w-8">#</th>
                  <th className="text-left px-3 py-2 font-semibold">Seller</th>
                  <th className="text-right px-3 py-2 font-semibold">Activas</th>
                  <th className="text-right px-3 py-2 font-semibold">Contact.</th>
                  <th className="text-right px-3 py-2 font-semibold">Enviados</th>
                  <th className="text-right px-3 py-2 font-semibold">Respond.</th>
                  <th className="text-right px-3 py-2 font-semibold">Positivos</th>
                  <th className="text-right px-3 py-2 font-semibold">Conversión</th>
                  <th className="w-8 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.sellerPerformance.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>Sin actividad de sellers en este período.</td></tr>
                ) : data.sellerPerformance.map((s, idx) => (
                  <tr key={s.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold"
                        style={{ backgroundColor: idx === 0 ? `color-mix(in srgb, ${gold} 18%, transparent)` : C.surface, color: idx === 0 ? gold : C.textMuted }}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/dashboard/seller/${s.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{s.name}</Link>
                    </td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{s.active}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{s.contacted}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{s.sent}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{s.replied}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums font-semibold" style={{ color: s.positive > 0 ? C.green : C.textMuted }}>{s.positive}</td>
                    <td className="text-right px-3 py-2.5">
                      <RateBadge value={s.conversionRate} color={C.green} />
                    </td>
                    <td className="px-2 py-2.5" style={{ color: C.textDim }}>
                      <Link href={`/dashboard/seller/${s.id}`}><ArrowRight size={12} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}

// ─── Local presentation primitives ──────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-2 flex-wrap">
      <div>
        <h2 className="text-base font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
          {title}
        </h2>
        <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string | null; subtitle: string | null; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {(title || subtitle) && (
        <div className="px-5 py-3 border-b" style={{ borderColor: C.border }}>
          {title && <p className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{title}</p>}
          {subtitle && <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full rounded-xl border border-dashed p-6 text-center text-xs"
      style={{ borderColor: C.border, color: C.textMuted }}>{children}</div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: C.textDim }}>{label}</p>
      <p className="text-base font-bold tabular-nums mt-0.5" style={{ color: accent ?? C.textPrimary }}>{value.toLocaleString("es-AR")}</p>
    </div>
  );
}

function RateBadge({ value, color }: { value: number; color: string }) {
  const tint = value === 0 ? C.textMuted : color;
  return (
    <span className="inline-flex items-center justify-end gap-1 text-xs font-semibold tabular-nums px-2 py-0.5 rounded"
      style={{ backgroundColor: value > 0 ? `color-mix(in srgb, ${color} 12%, transparent)` : "transparent", color: tint }}>
      {value}%
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    active:    { color: C.green, label: "Activa" },
    paused:    { color: "#D97706", label: "Pausada" },
    completed: { color: "#6B7280", label: "Cerrada" },
  };
  const s = map[status] ?? { color: C.textMuted, label: status };
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `color-mix(in srgb, ${s.color} 12%, transparent)`, color: s.color }}>
      {status === "active" && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />}
      {s.label}
    </span>
  );
}
