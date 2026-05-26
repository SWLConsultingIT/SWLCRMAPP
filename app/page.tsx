// Dashboard v2 — analytics-first, density-focused, drill-down enabled.
// Research-driven (Stripe/Linear/Vercel patterns, B2B sales dashboard
// frameworks): sticky filter bar, leading-vs-lagging KPI grouping, pipeline
// velocity card, funnel + heatmap + donut tight grid, trend chart, and
// performance tables with INLINE sparklines. One accent color (SWL gold) +
// neutrals + 3 semantic (red/green/blue) — Stripe-style restraint.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import {
  Users, Send, MessageSquare, ThumbsUp, Trophy, Megaphone, Target,
  TrendingUp, Sparkles, AlertTriangle, Lightbulb, ArrowRight, CheckCircle2,
  Share2, Mail, Phone, Smartphone, FileDown, Clock, ChevronsRight,
} from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import { getDashboardData } from "@/lib/dashboard-data";
import ReliabilityBanner from "@/components/ReliabilityBanner";
import PageHero from "@/components/PageHero";
import FiltersBar from "@/components/dashboard/FiltersBar";
import KpiCard from "@/components/dashboard/KpiCard";
import Funnel from "@/components/dashboard/Funnel";
import MultiLineChart from "@/components/dashboard/MultiLineChart";
import Donut from "@/components/dashboard/Donut";
import Heatmap from "@/components/dashboard/Heatmap";
import InlineSpark from "@/components/dashboard/InlineSpark";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2,        color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,          color: "#059669", label: "Email" },
  call:     { icon: Phone,         color: "#EA580C", label: "Llamadas" },
  whatsapp: { icon: Smartphone,    color: "#25D366", label: "WhatsApp" },
};

const classColors: Record<string, { label: string; color: string }> = {
  positive:       { label: "Positiva",      color: "#16A34A" },
  meeting_intent: { label: "Meeting intent",color: "#059669" },
  negative:       { label: "Negativa",      color: "#DC2626" },
  not_now:        { label: "Not now",       color: "#F59E0B" },
  unsubscribe:    { label: "Unsubscribe",   color: "#9CA3AF" },
  needs_info:     { label: "Necesita info", color: "#7C3AED" },
  question:       { label: "Pregunta",      color: "#0A66C2" },
  nurturing:      { label: "Nurturing",     color: "#6B7280" },
  spam:           { label: "Spam",          color: "#374151" },
  auto_reply:     { label: "Auto-reply",    color: "#94A3B8" },
  unclassified:   { label: "Sin clasificar",color: "#9CA3AF" },
};

function parseFilters(sp: Record<string, string | string[] | undefined>) {
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v ?? null;
  };
  const getList = (k: string) => {
    const v = get(k);
    return v ? v.split("|").filter(Boolean) : [];
  };
  return {
    from: get("from"),
    to: get("to"),
    campaignNames: getList("campaigns"),
    icpIds: getList("icps"),
    sellerIds: getList("sellers"),
  };
}

async function loadFilterOptions(bioId: string | null) {
  const svc = getSupabaseService();
  const campsQ = bioId
    ? svc.from("campaigns").select("name, leads!inner(company_bio_id)").eq("leads.company_bio_id", bioId)
    : svc.from("campaigns").select("name");
  const sellersQ = bioId
    ? svc.from("sellers").select("id, name").or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`).order("name")
    : svc.from("sellers").select("id, name").order("name");
  const icpsQ = bioId
    ? svc.from("icp_profiles").select("id, profile_name").eq("company_bio_id", bioId).eq("status", "approved").order("profile_name")
    : svc.from("icp_profiles").select("id, profile_name").eq("status", "approved").order("profile_name");
  const [{ data: camps }, { data: sellers }, { data: icps }] = await Promise.all([campsQ, sellersQ, icpsQ]);
  const uniqueNames = Array.from(new Set((camps ?? []).map((c: any) => c.name).filter(Boolean))).sort();
  return {
    campaigns: uniqueNames.map(n => ({ id: n, label: n })),
    sellers: (sellers ?? []).map((s: any) => ({ id: s.id, label: s.name })),
    icps: (icps ?? []).map((p: any) => ({ id: p.id, label: p.profile_name })),
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
  const bioId = scope.isScoped ? scope.companyBioId! : null;
  const [data, options] = await Promise.all([
    getDashboardData(filters),
    loadFilterOptions(bioId),
  ]);

  const { headline, deltas, trend30d } = data;

  // Reply classification → donut data
  const donutSlices = Object.entries(data.replyClassCounts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      label: classColors[k]?.label ?? k,
      value: v,
      color: classColors[k]?.color ?? "#9CA3AF",
    }))
    .sort((a, b) => b.value - a.value);

  // Compact period label for the hero
  const periodLabel = filters.from && filters.to
    ? `${new Date(filters.from).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} – ${new Date(filters.to).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}`
    : `Últimos ${data.period.days} días`;

  return (
    <div className="p-4 sm:p-6 w-full space-y-5">
      <ReliabilityBanner />

      <PageHero
        icon={TrendingUp}
        section="Sales Engine"
        title="Tu pipeline, en profundidad"
        description="De la empresa entera a campañas, ICPs y sellers. Hacé clic en cualquier fila para abrir el detalle con gráficos."
        accentColor={gold}
        status={{ label: periodLabel, active: true }}
        action={(
          <Link
            href="/reports"
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-85 whitespace-nowrap"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`, color: "#04070d", boxShadow: `0 1px 6px color-mix(in srgb, ${gold} 28%, transparent)` }}
          >
            <FileDown size={13} /> Descargar PDF
          </Link>
        )}
      />

      {/* ─── Sticky filters strip ───────────────────────────────────────────
          Wrapped in Suspense because FiltersBar reads useSearchParams() —
          App Router requires the boundary on any client component using
          search-params hooks. Without it the page bails to the 500. */}
      <Suspense fallback={<div className="h-10" />}>
        <FiltersBar options={options} />
      </Suspense>

      {/* ─── KPIs Leading / Lagging in one row (research: 5-9 KPIs max, leading first) ─ */}
      <section>
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0A66C2" }} />
              Leading <span style={{ color: C.textDim }}>· señales tempranas</span>
            </span>
            <span style={{ color: C.textDim }}>|</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.green }} />
              Lagging <span style={{ color: C.textDim }}>· resultado final</span>
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Contactados"
            value={headline.contactedLeads.toLocaleString("es-AR")}
            delta={deltas.contacted}
            trend={trend30d.sent}
            icon={Send}
            accent="#0A66C2"
            hint="Leading · CRs/intros enviadas"
          />
          <KpiCard
            label="Aceptaron CR"
            value={`${headline.acceptanceRate}%`}
            icon={ChevronsRight}
            accent="#0A66C2"
            hint={`Leading · ${headline.connectedLeads.toLocaleString("es-AR")} aceptaron`}
          />
          <KpiCard
            label="Respuestas"
            value={headline.repliedCount.toLocaleString("es-AR")}
            delta={deltas.replied}
            trend={trend30d.replies}
            icon={MessageSquare}
            accent="#7C3AED"
            hint={`Leading · ${headline.responseRate}% tasa`}
            href="/queue?tab=inbox"
          />
          <KpiCard
            label="Positivas"
            value={headline.positiveCount.toLocaleString("es-AR")}
            delta={deltas.positive}
            trend={trend30d.positive}
            icon={ThumbsUp}
            accent={C.green}
            hint={`Lagging · ${headline.positiveRate}% de respuestas`}
            href="/opportunities"
          />
          <KpiCard
            label="Reuniones"
            value={headline.meetingCount.toLocaleString("es-AR")}
            icon={Target}
            accent="#F59E0B"
            hint="Lagging · leads qualified"
            href="/opportunities"
          />
          <KpiCard
            label="Ganados"
            value={headline.wonCount.toLocaleString("es-AR")}
            icon={Trophy}
            accent="#DC2626"
            hint={`Lagging · ${data.velocity.winRate}% win rate`}
          />
        </div>
      </section>

      {/* ─── Velocity strip — "north star" line. Stripe/Linear-style band. ── */}
      <section>
        <div className="rounded-2xl border overflow-hidden"
          style={{ borderColor: C.border, background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 4%, ${C.card}) 100%)` }}>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: C.border, color: C.border }}>
            <VelocityStat
              icon={Sparkles}
              label="Velocity"
              value={`${data.velocity.perDay}`}
              unit="positivas/día"
              hint="A velocidad actual"
              tone="brand"
            />
            <VelocityStat
              icon={Target}
              label="Pronóstico fin de mes"
              value={`${data.velocity.forecastMonthEnd}`}
              unit="positivas extra"
              hint="Proyectado al ritmo actual"
              tone="brand"
            />
            <VelocityStat
              icon={Clock}
              label="Tiempo a 1ª respuesta"
              value={data.velocity.medianTimeToReplyMin === null ? "—" : formatMinutes(data.velocity.medianTimeToReplyMin)}
              unit="mediana"
              hint="Desde el primer mensaje"
              tone="neutral"
            />
            <VelocityStat
              icon={Trophy}
              label="Win rate"
              value={`${data.velocity.winRate}%`}
              unit="de contactados"
              hint="Ganados / contactados"
              tone="success"
            />
          </div>
        </div>
      </section>

      {/* ─── Funnel + Donut + Heatmap in a tight 3-column grid ────────────── */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Funnel — 5 cols */}
          <Panel title="Embudo de conversión" subtitle="Drop-off etapa por etapa" className="lg:col-span-5">
            <Funnel stages={data.funnel} />
          </Panel>
          {/* Donut — 3 cols */}
          <Panel title="Clasificación de respuestas" subtitle="Distribución del período" className="lg:col-span-4">
            <Donut data={donutSlices} />
          </Panel>
          {/* Insights — 4 cols */}
          <Panel title="Insights" subtitle="Movimientos detectados" className="lg:col-span-3">
            {data.insights.length === 0 ? (
              <div className="text-xs py-6 text-center" style={{ color: C.textDim }}>
                Sin movimientos llamativos en el período.
              </div>
            ) : (
              <div className="space-y-2">
                {data.insights.map((ins, i) => {
                  const tone =
                    ins.tone === "positive" ? { color: C.green, Icon: CheckCircle2 }
                    : ins.tone === "warning" ? { color: C.red, Icon: AlertTriangle }
                    : { color: gold, Icon: Lightbulb };
                  const Ic = tone.Icon;
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <Ic size={13} style={{ color: tone.color }} className="shrink-0 mt-0.5" />
                      <p className="text-[11px] leading-snug" style={{ color: C.textBody }}>{ins.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </section>

      {/* ─── Trend chart + heatmap in a 7/5 split ───────────────────────── */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Panel title="Actividad 30 días" subtitle="Enviados · respuestas · positivas" className="lg:col-span-7">
            <MultiLineChart series={[
              { name: "Enviados",   color: "#0A66C2", data: trend30d.sent },
              { name: "Respuestas", color: "#7C3AED", data: trend30d.replies },
              { name: "Positivas",  color: C.green,    data: trend30d.positive },
            ]} />
          </Panel>
          <Panel title="¿Cuándo responden los leads?" subtitle="Día × hora — mediana del período" className="lg:col-span-5">
            <Heatmap matrix={data.heatmap} />
          </Panel>
        </div>
      </section>

      {/* ─── Performance per channel — compact card row ─────────────────── */}
      <section>
        <SectionHeader icon={Send} title="Performance por canal" subtitle="Volumen y conversión por canal de outreach" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {data.channelBreakdown.length === 0 ? (
            <EmptyHint>Sin actividad por canal todavía.</EmptyHint>
          ) : data.channelBreakdown.map(ch => {
            const meta = channelMeta[ch.channel] ?? { icon: Share2, color: C.textMuted, label: ch.channel };
            const Icon = meta.icon;
            return (
              <div key={ch.channel} className="rounded-xl border p-3.5 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderColor: C.border, backgroundColor: C.card, borderLeft: `3px solid ${meta.color}` }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
                      <Icon size={13} />
                    </span>
                    <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{meta.label}</span>
                  </div>
                  <span className="text-[10px] tabular-nums font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)`, color: meta.color }}>
                    {ch.responseRate}% RESP
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <Stat label="Env." value={ch.sent} />
                  <Stat label="Cont." value={ch.contacted} />
                  <Stat label="Resp." value={ch.replied} />
                  <Stat label="Pos." value={ch.positive} accent={C.green} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Tables: ICP / Campaigns / Sellers — all with inline sparklines ── */}
      <section>
        <SectionHeader icon={Target} title="Comparativo de ICPs" subtitle="Qué perfil ideal convierte mejor · clic para detalle" />
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left">ICP</Th>
                <Th align="right">Leads</Th>
                <Th align="right">Cont.</Th>
                <Th align="right">Resp.</Th>
                <Th align="right">Pos.</Th>
                <Th align="right">Resp %</Th>
                <Th align="right">Conv %</Th>
                <Th align="left">Tendencia 14d</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody>
              {data.icpPerformance.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>Sin ICPs en el período.</td></tr>
              ) : data.icpPerformance.map(icp => (
                <tr key={icp.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                  <Td>
                    {icp.id !== "_unknown" ? (
                      <Link href={`/dashboard/icp/${icp.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{icp.name}</Link>
                    ) : (
                      <span style={{ color: C.textMuted }}>{icp.name}</span>
                    )}
                  </Td>
                  <NumCell value={icp.leads} />
                  <NumCell value={icp.contacted} />
                  <NumCell value={icp.replied} />
                  <NumCell value={icp.positive} accent={icp.positive > 0 ? C.green : undefined} bold />
                  <RateCell value={icp.responseRate} color="#7C3AED" />
                  <RateCell value={icp.conversionRate} color={C.green} />
                  <td className="px-3 py-2"><InlineSpark data={icp.spark} color="#7C3AED" /></td>
                  <td className="pr-3" style={{ color: C.textDim }}>{icp.id !== "_unknown" && <Link href={`/dashboard/icp/${icp.id}`} className="inline-flex"><ArrowRight size={12} /></Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      <section>
        <SectionHeader icon={Megaphone} title="Comparativo de campañas" subtitle="Performance por secuencia · clic para drill-down" />
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left">Campaña</Th>
                <Th align="left">Canales</Th>
                <Th align="right">Leads</Th>
                <Th align="right">Env.</Th>
                <Th align="right">Resp.</Th>
                <Th align="right">Pos.</Th>
                <Th align="right">Conv %</Th>
                <Th align="left">Estado</Th>
                <Th align="left">Tendencia 14d</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody>
              {data.campaignPerformance.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>Sin campañas en el período.</td></tr>
              ) : data.campaignPerformance.map(c => (
                <tr key={c.name} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                  <Td>
                    <Link href={`/dashboard/campaign/${encodeURIComponent(c.name)}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{c.name}</Link>
                  </Td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {c.channels.map(ch => {
                        const m = channelMeta[ch] ?? channelMeta.email;
                        const Ic = m.icon;
                        return <Ic key={ch} size={12} style={{ color: m.color }} />;
                      })}
                    </div>
                  </td>
                  <NumCell value={c.leads} />
                  <NumCell value={c.sent} />
                  <NumCell value={c.replied} />
                  <NumCell value={c.positive} accent={c.positive > 0 ? C.green : undefined} bold />
                  <RateCell value={c.conversionRate} color={C.green} />
                  <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                  <td className="px-3 py-2"><InlineSpark data={c.spark} color="#0A66C2" /></td>
                  <td className="pr-3" style={{ color: C.textDim }}><Link href={`/dashboard/campaign/${encodeURIComponent(c.name)}`} className="inline-flex"><ArrowRight size={12} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      <section>
        <SectionHeader icon={Trophy} title="Leaderboard de sellers" subtitle="Quién está moviendo el pipeline · clic para detalle" />
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left" style={{ width: 28 }}>#</Th>
                <Th align="left">Seller</Th>
                <Th align="right">Activas</Th>
                <Th align="right">Cont.</Th>
                <Th align="right">Env.</Th>
                <Th align="right">Resp.</Th>
                <Th align="right">Pos.</Th>
                <Th align="right">Conv %</Th>
                <Th align="left">Tendencia 14d</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody>
              {data.sellerPerformance.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>Sin actividad de sellers en este período.</td></tr>
              ) : data.sellerPerformance.map((s, idx) => (
                <tr key={s.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                  <Td>
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: idx === 0 ? `color-mix(in srgb, ${gold} 18%, transparent)` : C.surface, color: idx === 0 ? gold : C.textMuted }}>
                      {idx + 1}
                    </span>
                  </Td>
                  <Td><Link href={`/dashboard/seller/${s.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{s.name}</Link></Td>
                  <NumCell value={s.active} />
                  <NumCell value={s.contacted} />
                  <NumCell value={s.sent} />
                  <NumCell value={s.replied} />
                  <NumCell value={s.positive} accent={s.positive > 0 ? C.green : undefined} bold />
                  <RateCell value={s.conversionRate} color={C.green} />
                  <td className="px-3 py-2"><InlineSpark data={s.spark} color={gold} /></td>
                  <td className="pr-3" style={{ color: C.textDim }}><Link href={`/dashboard/seller/${s.id}`} className="inline-flex"><ArrowRight size={12} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>
    </div>
  );
}

// ─── Local presentation primitives ──────────────────────────────────────

function SectionHeader({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }> }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      {Icon && (
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
          <Icon size={14} />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
          {title}
        </h2>
        <p className="text-[11px]" style={{ color: C.textMuted }}>{subtitle}</p>
      </div>
      <div className="h-px flex-1 max-w-[180px]" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${gold} 25%, transparent), transparent)` }} />
    </div>
  );
}

function Panel({ title, subtitle, children, className }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${className ?? ""}`} style={{ backgroundColor: C.card, borderColor: C.border }}>
      {(title || subtitle) && (
        <div className="px-4 py-2.5 border-b" style={{ borderColor: C.border }}>
          {title && <p className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{title}</p>}
          {subtitle && <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>}
        </div>
      )}
      <div className="p-3.5">{children}</div>
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
      <p className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>{label}</p>
      <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: accent ?? C.textPrimary }}>{value.toLocaleString("es-AR")}</p>
    </div>
  );
}

function Th({ children, align, style }: { children?: React.ReactNode; align: "left" | "right"; style?: React.CSSProperties }) {
  return <th className={`px-3 py-2 font-semibold text-${align}`} style={style}>{children}</th>;
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td className="px-3 py-2" style={style}>{children}</td>;
}
function NumCell({ value, bold, accent }: { value: number; bold?: boolean; accent?: string }) {
  return <td className="px-3 py-2 text-right tabular-nums" style={{ color: accent ?? (bold ? C.textPrimary : C.textBody), fontWeight: bold ? 600 : 400 }}>{value.toLocaleString("es-AR")}</td>;
}
function RateCell({ value, color }: { value: number; color: string }) {
  return (
    <td className="px-3 py-2 text-right">
      <span className="inline-flex items-center justify-end gap-1 text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded"
        style={{ backgroundColor: value > 0 ? `color-mix(in srgb, ${color} 12%, transparent)` : "transparent", color: value > 0 ? color : C.textMuted }}>
        {value}%
      </span>
    </td>
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

function VelocityStat({
  icon: Icon, label, value, unit, hint, tone,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  value: string;
  unit: string;
  hint: string;
  tone: "brand" | "neutral" | "success";
}) {
  const accent = tone === "brand" ? gold : tone === "success" ? C.green : C.textBody;
  return (
    <div className="px-5 py-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textMuted }}>{label}</p>
        <p className="mt-0.5">
          <span className="text-2xl font-bold tabular-nums" style={{ color: accent, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>{value}</span>
          <span className="text-xs ml-1.5" style={{ color: C.textMuted }}>{unit}</span>
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{hint}</p>
      </div>
    </div>
  );
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
