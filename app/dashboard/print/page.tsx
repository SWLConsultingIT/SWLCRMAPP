import { getDashboardData } from "@/lib/dashboard-data";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import PrintTrigger from "@/app/reports/print/PrintTrigger";

// ─── Brand helpers ────────────────────────────────────────────────────────────

async function getBranding() {
  const scope = await getUserScope();
  const fallback = { companyName: "SWL Consulting", logoUrl: null as string | null, accent: "#C9A83A" };
  if (!scope.companyBioId) return fallback;
  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("company_name, logo_url, primary_color, use_brand_colors")
    .eq("id", scope.companyBioId)
    .maybeSingle();
  if (!bio) return fallback;
  return {
    companyName: bio.company_name ?? fallback.companyName,
    logoUrl:     bio.logo_url    ?? null,
    accent:      bio.use_brand_colors && bio.primary_color ? bio.primary_color : fallback.accent,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number) { return `${n}%`; }
function fmt(n: number)  { return n.toLocaleString("es-AR"); }
function rate(n: number, d: number) { return d > 0 ? Math.round((n / d) * 100) : 0; }

function periodLabel(from: string | null, to: string | null): string {
  if (!from && !to) return "Todos los tiempos";
  const f = from ? new Date(from).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "inicio";
  const t = to   ? new Date(to).toLocaleDateString("es-AR",   { day: "numeric", month: "short", year: "numeric" }) : "hoy";
  return `${f} — ${t}`;
}

// ─── Inline styles ────────────────────────────────────────────────────────────

type Palette = Record<string, string>;

const S: Palette = {
  bg:      "#0C0E1B",
  card:    "#111728",
  cardAlt: "#0E1323",
  gold:    "#C9A83A",
  border:  "rgba(201,168,58,0.14)",
  w:       "#FFFFFF",
  body:    "#BBBDD0",
  muted:   "#6A6A8A",
  red:     "#EF4444",
  green:   "#22C55E",
  blue:    "#3B82F6",
};

// ─── Print page ───────────────────────────────────────────────────────────────

export default async function DashboardPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp       = await searchParams;
  const sections = new Set((sp.sections ?? "").split(",").filter(Boolean));
  const has      = (k: string) => sections.has(k);

  // Parse filters from URL
  const filters = {
    from:          sp.from  ?? null,
    to:            sp.to    ?? null,
    campaignNames: sp.campaign ? [sp.campaign] : undefined,
    sellerIds:     sp.seller   ? [sp.seller]   : undefined,
    icpIds:        sp.icp      ? [sp.icp]       : undefined,
  };

  const [data, brand] = await Promise.all([
    getDashboardData(filters),
    getBranding(),
  ]);

  const { headline, channelBreakdown, icpPerformance, sellerPerformance, callOutcomesBySeller, campaignPerformance, callsBreakdown } = data;
  const period = periodLabel(filters.from, filters.to);
  const today  = new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

  const channelMap: Record<string, (typeof channelBreakdown)[0]> = {};
  for (const c of channelBreakdown) channelMap[c.channel] = c;

  return (
    <>
      {/* Override global print CSS so dark bg renders correctly */}
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        html, body { background: ${S.bg} !important; margin: 0; padding: 0; font-family: -apple-system, 'Inter', sans-serif; }
        .print-page { width: 210mm; min-height: 297mm; padding: 12mm 14mm 10mm; background: ${S.bg}; page-break-after: always; overflow: hidden; }
        .print-page:last-child { page-break-after: auto; }
        @media print {
          body { background: ${S.bg} !important; }
          .no-print { display: none !important; }
        }
      `}} />

      {/* ── Cover page ──────────────────────────────────────────────────── */}
      <div className="print-page" style={{ display: "flex", flexDirection: "column" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10mm", paddingBottom: "4mm", borderBottom: `1px solid ${S.border}` }}>
          {brand.logoUrl
            ? <img src={brand.logoUrl} alt="Logo" style={{ height: "7mm", objectFit: "contain" }} />
            : <span style={{ fontSize: "5.5mm", fontWeight: 800, color: S.gold, letterSpacing: "0.06em" }}>SWL</span>
          }
          <span style={{ fontSize: "2.4mm", color: S.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Growth AI Engine</span>
        </div>

        {/* Big headline */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <p style={{ fontSize: "2.4mm", color: S.gold, textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: "3mm" }}>
            Sales Report
          </p>
          <h1 style={{ fontSize: "9mm", fontWeight: 800, color: S.w, lineHeight: 1.1, margin: 0, marginBottom: "4mm" }}>
            {brand.companyName}
          </h1>
          <p style={{ fontSize: "4mm", color: S.body, margin: 0, lineHeight: 1.5 }}>
            {period}
          </p>
        </div>

        {/* KPI snapshot on cover */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "3mm", marginBottom: "10mm" }}>
          {[
            { label: "Importados",  val: headline.totalLeads },
            { label: "Contactados", val: headline.contactedLeads },
            { label: "Respondieron",val: headline.repliedCount },
            { label: "Positivos",   val: headline.positiveCount },
          ].map(({ label, val }) => (
            <div key={label} style={{ background: S.card, borderRadius: "2mm", padding: "4mm", borderLeft: `1.5mm solid ${S.gold}` }}>
              <p style={{ fontSize: "2mm", color: S.muted, textTransform: "uppercase", letterSpacing: "0.1em", margin: 0, marginBottom: "1.5mm" }}>{label}</p>
              <p style={{ fontSize: "6.5mm", fontWeight: 800, color: S.gold, margin: 0, lineHeight: 1 }}>{fmt(val)}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "3mm", borderTop: `1px solid ${S.border}` }}>
          <span style={{ fontSize: "1.9mm", color: S.muted }}>Generado el {today}</span>
          <span style={{ fontSize: "1.9mm", color: S.muted }}>Growth AI Engine — SWL Consulting</span>
        </div>
      </div>

      {/* ── Overview: KPIs + funnel ─────────────────────────────────────── */}
      {(has("overview.kpis") || has("overview.icps")) && (
        <div className="print-page">
          <SectionHeader title="Overview" subtitle="Pipeline y performance por ICP" gold={S.gold} border={S.border} />

          {has("overview.kpis") && (
            <>
              <SubHeader label="Pipeline KPIs" gold={S.gold} muted={S.muted} />
              {/* Stat grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "3mm", marginBottom: "5mm" }}>
                {[
                  { label: "Importados",   val: headline.totalLeads,      sub: "Total en pipeline" },
                  { label: "Contactados",  val: headline.contactedLeads,   sub: `${rate(headline.contactedLeads, headline.totalLeads)}% del total` },
                  { label: "Respondieron", val: headline.repliedCount,     sub: `${headline.responseRate}% reply rate` },
                  { label: "Positivos",    val: headline.positiveCount,    sub: `${rate(headline.positiveCount, headline.contactedLeads)}% positive rate` },
                  { label: "Ganados",      val: headline.wonCount,         sub: `${headline.conversionRate}% conv. rate` },
                  { label: "Campañas",     val: data.activeCampaignCount,  sub: "activas ahora" },
                ].map(({ label, val, sub }) => (
                  <StatBox key={label} label={label} value={fmt(val)} sub={sub} S={S} />
                ))}
              </div>
            </>
          )}

          {has("overview.icps") && icpPerformance.length > 0 && (
            <>
              <SubHeader label="Performance por ICP" gold={S.gold} muted={S.muted} />
              <DataTable
                headers={["ICP", "Leads", "Contactados", "Respondieron", "Reply %", "Positivos", "Flujos"]}
                rows={icpPerformance.slice(0, 12).map(p => [
                  p.name,
                  fmt(p.leads ?? 0),
                  fmt(p.contacted ?? 0),
                  fmt(p.replied ?? 0),
                  pct(p.replyRate ?? 0),
                  fmt(p.positive ?? 0),
                  fmt(p.flows ?? 0),
                ])}
                S={S}
              />
            </>
          )}
        </div>
      )}

      {/* ── Outreach ────────────────────────────────────────────────────── */}
      {(has("outreach.campaigns") || has("outreach.channels")) && (
        <div className="print-page">
          <SectionHeader title="Outreach" subtitle="Campañas y actividad por canal" gold={S.gold} border={S.border} />

          {has("outreach.channels") && channelBreakdown.length > 0 && (
            <>
              <SubHeader label="Desglose por canal" gold={S.gold} muted={S.muted} />
              <DataTable
                headers={["Canal", "Mensajes enviados", "Contactados", "Respondieron", "Reply %", "Positivos", "Conv %"]}
                rows={channelBreakdown.map(c => [
                  c.channel.toUpperCase(),
                  fmt(c.sent),
                  fmt(c.contacted),
                  fmt(c.replied),
                  pct(c.responseRate),
                  fmt(c.positive),
                  pct(c.conversionRate),
                ])}
                S={S}
              />
            </>
          )}

          {has("outreach.campaigns") && campaignPerformance.length > 0 && (
            <>
              <SubHeader label="Performance por campaña (top 12)" gold={S.gold} muted={S.muted} />
              <DataTable
                headers={["Campaña", "ICP", "Canal", "Leads", "Enviados", "Resp.", "Reply %", "Positivos"]}
                rows={campaignPerformance.slice(0, 12).map((c: Record<string, unknown>) => [
                  String(c.name ?? "").slice(0, 28),
                  String(c.icpName ?? c.icp_name ?? "—").slice(0, 16),
                  String(c.channel ?? "—").toUpperCase(),
                  fmt(Number(c.leads ?? 0)),
                  fmt(Number(c.sent ?? 0)),
                  fmt(Number(c.replied ?? 0)),
                  pct(Number(c.replyRate ?? c.reply_rate ?? 0)),
                  fmt(Number(c.positive ?? 0)),
                ])}
                S={S}
              />
            </>
          )}
        </div>
      )}

      {/* ── Channels detail ─────────────────────────────────────────────── */}
      {(has("channels.email") || has("channels.linkedin") || has("channels.calls")) && (
        <div className="print-page">
          <SectionHeader title="Channels" subtitle="Estadísticas detalladas por canal" gold={S.gold} border={S.border} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "4mm" }}>
            {has("channels.linkedin") && (() => {
              const li = channelMap["linkedin"];
              return (
                <ChannelCard
                  name="LinkedIn"
                  color="#0A66C2"
                  stats={[
                    { label: "Mensajes enviados", val: fmt(li?.sent ?? 0) },
                    { label: "Contactados",        val: fmt(li?.contacted ?? 0) },
                    { label: "Conexiones",         val: fmt(data.linkedinConnections.sent) },
                    { label: "Aceptados",          val: fmt(data.linkedinConnections.accepted) },
                    { label: "Respondieron",       val: fmt(li?.replied ?? 0) },
                    { label: "Reply rate",         val: pct(li?.responseRate ?? 0) },
                  ]}
                  S={S}
                />
              );
            })()}

            {has("channels.email") && (() => {
              const em = channelMap["email"];
              return (
                <ChannelCard
                  name="Email"
                  color="#059669"
                  stats={[
                    { label: "Enviados",     val: fmt(em?.sent ?? 0) },
                    { label: "Contactados",  val: fmt(em?.contacted ?? 0) },
                    { label: "Respondieron", val: fmt(em?.replied ?? 0) },
                    { label: "Reply rate",   val: pct(em?.responseRate ?? 0) },
                    { label: "Positivos",    val: fmt(em?.positive ?? 0) },
                    { label: "Conv. rate",   val: pct(em?.conversionRate ?? 0) },
                  ]}
                  S={S}
                />
              );
            })()}

            {has("channels.calls") && (() => {
              const calls = callsBreakdown as Record<string, number> | null;
              return (
                <ChannelCard
                  name="Calls"
                  color="#EA580C"
                  stats={[
                    { label: "Realizadas",   val: fmt(calls?.made ?? 0) },
                    { label: "Contestadas",  val: fmt(calls?.answered ?? 0) },
                    { label: "Positivas",    val: fmt(calls?.positive ?? 0) },
                    { label: "Negativas",    val: fmt(calls?.negative ?? 0) },
                    { label: "Answer rate",  val: pct(calls?.made ? rate(calls.answered ?? 0, calls.made) : 0) },
                    { label: "Pendientes",   val: fmt(calls?.pending ?? 0) },
                  ]}
                  S={S}
                />
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Sellers ─────────────────────────────────────────────────────── */}
      {(has("sellers.table") || has("sellers.calls")) && (
        <div className="print-page">
          <SectionHeader title="Sellers" subtitle="Leaderboard y outcomes de llamadas" gold={S.gold} border={S.border} />

          {has("sellers.table") && sellerPerformance.length > 0 && (
            <>
              <SubHeader label="Seller leaderboard" gold={S.gold} muted={S.muted} />
              <DataTable
                headers={["Seller", "Contactados", "Enviados", "Respondieron", "Reply %", "Positivos", "Conv %", "Campañas act."]}
                rows={sellerPerformance.map((s: Record<string, unknown>) => [
                  String(s.name ?? "—"),
                  fmt(Number(s.contacted ?? 0)),
                  fmt(Number(s.sent ?? 0)),
                  fmt(Number(s.replied ?? 0)),
                  pct(Number(s.replyRateLinkedin ?? s.replyRate ?? 0)),
                  fmt(Number(s.positive ?? 0)),
                  pct(rate(Number(s.positive ?? 0), Number(s.contacted ?? 0))),
                  fmt(Number(s.active ?? 0)),
                ])}
                S={S}
              />
            </>
          )}

          {has("sellers.calls") && callOutcomesBySeller.length > 0 && (
            <>
              <SubHeader label="Call outcomes por seller" gold={S.gold} muted={S.muted} />
              <DataTable
                headers={["Seller", "Llamadas realizadas", "Positivas", "Negativas", "Sin respuesta", "Positiv %"]}
                rows={(callOutcomesBySeller as Array<Record<string, unknown>>).map(s => {
                  const made = Number(s.made ?? 0);
                  const pos  = Number(s.positive ?? 0);
                  return [
                    String(s.sellerName ?? s.name ?? "—"),
                    fmt(made),
                    fmt(pos),
                    fmt(Number(s.negative ?? 0)),
                    fmt(Number(s.noAnswer ?? s.no_answer ?? 0)),
                    pct(rate(pos, made)),
                  ];
                })}
                S={S}
              />
            </>
          )}
        </div>
      )}

      {/* Auto-print when opened in the hidden iframe */}
      <PrintTrigger />
    </>
  );
}

// ─── Presentational primitives ────────────────────────────────────────────────

function SectionHeader({ title, subtitle, gold, border }: { title: string; subtitle: string; gold: string; border: string }) {
  return (
    <div style={{ marginBottom: "5mm", paddingBottom: "3mm", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "baseline", gap: "3mm" }}>
      <h2 style={{ fontSize: "5.5mm", fontWeight: 800, color: gold, margin: 0 }}>{title}</h2>
      <span style={{ fontSize: "2.6mm", color: "#6A6A8A" }}>{subtitle}</span>
    </div>
  );
}

function SubHeader({ label, gold, muted }: { label: string; gold: string; muted: string }) {
  return (
    <p style={{ fontSize: "2.2mm", color: muted, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, margin: "0 0 2mm 0", paddingLeft: "1.5mm", borderLeft: `1mm solid ${gold}` }}>
      {label}
    </p>
  );
}

function StatBox({ label, value, sub, S }: { label: string; value: string; sub: string; S: Palette }) {
  return (
    <div style={{ background: S.card, borderRadius: "2mm", padding: "4mm", borderLeft: `1.5mm solid ${S.gold}` }}>
      <p style={{ fontSize: "1.9mm", color: S.muted, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 1.5mm 0" }}>{label}</p>
      <p style={{ fontSize: "7mm",   fontWeight: 800, color: S.gold, margin: "0 0 1mm 0", lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: "1.9mm", color: S.muted, margin: 0 }}>{sub}</p>
    </div>
  );
}

function DataTable({ headers, rows, S }: { headers: string[]; rows: string[][]; S: Palette }) {
  const colW = `${100 / headers.length}%`;
  return (
    <div style={{ width: "100%", overflowX: "auto", marginBottom: "5mm" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "2.2mm", tableLayout: "fixed" }}>
        <thead>
          <tr style={{ background: S.cardAlt }}>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: "2mm 2.5mm",
                textAlign: i === 0 ? "left" : "right",
                color: S.gold,
                fontWeight: 700,
                fontSize: "1.9mm",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                borderBottom: `1px solid ${S.border}`,
                width: colW,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? S.card : S.cardAlt }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: "2mm 2.5mm",
                  color: ci === 0 ? S.body : S.w,
                  textAlign: ci === 0 ? "left" : "right",
                  fontWeight: ci === 0 ? 500 : 600,
                  borderBottom: `1px solid rgba(201,168,58,0.06)`,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} style={{ padding: "4mm", textAlign: "center", color: S.muted, fontSize: "2.2mm" }}>
                Sin datos para el período seleccionado
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ChannelCard({ name, color, stats, S }: {
  name: string;
  color: string;
  stats: { label: string; val: string }[];
  S: Palette;
}) {
  return (
    <div style={{ background: S.card, borderRadius: "2mm", padding: "4mm", borderTop: `2mm solid ${color}` }}>
      <p style={{ fontSize: "3.2mm", fontWeight: 700, color: S.w, margin: "0 0 3mm 0" }}>{name}</p>
      {stats.map(({ label, val }) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.5mm" }}>
          <span style={{ fontSize: "2mm", color: S.muted }}>{label}</span>
          <span style={{ fontSize: "2.6mm", fontWeight: 700, color: S.w }}>{val}</span>
        </div>
      ))}
    </div>
  );
}

