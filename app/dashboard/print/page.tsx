import { getDashboardData, getSellerActivity } from "@/lib/dashboard-data";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import PrintTrigger from "@/app/reports/print/PrintTrigger";

// ─── Branding ─────────────────────────────────────────────────────────────────

async function getBranding() {
  const scope   = await getUserScope();
  const fallback = { companyName: "SWL Consulting", logoUrl: null as string | null, accent: "#C9A83A", bioId: scope.companyBioId ?? null };
  if (!scope.companyBioId) return fallback;
  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("company_name, logo_url, primary_color, use_brand_colors")
    .eq("id", scope.companyBioId)
    .maybeSingle();
  return {
    companyName: bio?.company_name ?? fallback.companyName,
    logoUrl:     bio?.logo_url    ?? null,
    accent:      bio?.use_brand_colors && bio?.primary_color ? bio.primary_color : fallback.accent,
    bioId:       scope.companyBioId,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Palette = Record<string, string>;

const S: Palette = {
  bg:      "#0C0E1B",
  card:    "#111728",
  cardAlt: "#0E1323",
  gold:    "#C9A83A",
  border:  "rgba(201,168,58,0.16)",
  w:       "#FFFFFF",
  body:    "#BBBDD0",
  muted:   "#6A6A8A",
};

function fmt(n: number)  { return n.toLocaleString("es-AR"); }
function pct(n: number, d: number) { return d > 0 ? `${Math.round((n / d) * 100)}%` : "0%"; }

function periodLabel(from: string | null, to: string | null): string {
  if (!from && !to) return "Todos los tiempos";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const f = from ? new Date(from).toLocaleDateString("es-AR", opts) : "inicio";
  const t = to   ? new Date(to).toLocaleDateString("es-AR", { ...opts, year: "numeric" }) : "hoy";
  return `${f} — ${t}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Nunca";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "Hace un momento";
  if (m < 60) return `Hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h}h`;
  return `Hace ${Math.floor(h / 24)}d`;
}

// ─── Page component ───────────────────────────────────────────────────────────

export default async function DashboardPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp       = await searchParams;
  const sections = new Set((sp.sections ?? "").split(",").filter(Boolean));
  const has      = (k: string) => sections.has(k);

  const filters = {
    from:          sp.from  ?? null,
    to:            sp.to    ?? null,
    campaignNames: sp.campaign ? [sp.campaign] : undefined,
    sellerIds:     sp.seller   ? [sp.seller]   : undefined,
    icpIds:        sp.icp      ? [sp.icp]       : undefined,
  };

  const brand = await getBranding();

  const [data, activityMap] = await Promise.all([
    getDashboardData(filters),
    getSellerActivity(brand.bioId),
  ]);

  const { headline, channelBreakdown, icpPerformance, sellerPerformance, callOutcomesBySeller, campaignPerformance, callsBreakdown } = data;
  const period = periodLabel(filters.from, filters.to);
  const today  = new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

  const todayStr = new Date().toISOString().slice(0, 10);
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i); return d.toISOString().slice(0, 10);
  });

  // Build calls maps keyed by sellerName
  const callsTodayMap = new Map<string, number>();
  const callsWeekMap  = new Map<string, number>();
  for (const row of callOutcomesBySeller) {
    callsTodayMap.set(row.sellerName, row.byDay?.[todayStr]?.made ?? 0);
    callsWeekMap.set(row.sellerName, last7Days.reduce((s, d) => s + (row.byDay?.[d]?.made ?? 0), 0));
  }

  const channelMap: Record<string, (typeof channelBreakdown)[0]> = {};
  for (const c of channelBreakdown) channelMap[c.channel] = c;

  const calls = callsBreakdown as Record<string, number> | null;

  // Seller rows with activity enrichment
  const sellerRows = (sellerPerformance as Array<Record<string, unknown>>).map(s => {
    const act = activityMap.get(String(s.id ?? ""));
    return {
      name:        act?.displayName || String(s.name ?? "—"),
      lastSeenAt:  act?.lastSeenAt ?? null,
      callsToday:  callsTodayMap.get(String(s.name ?? "")) ?? 0,
      callsWeek:   callsWeekMap.get(String(s.name ?? ""))  ?? 0,
      contacted:   Number(s.contacted ?? 0),
      sent:        Number(s.sent ?? 0),
      replied:     Number(s.replied ?? 0),
      positive:    Number(s.positive ?? 0),
      active:      Number(s.active ?? 0),
    };
  });

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        html, body { background: ${S.bg} !important; margin: 0; padding: 0;
          font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
        .pg { width: 210mm; min-height: 297mm; padding: 14mm 16mm 12mm;
          background: ${S.bg}; page-break-after: always; overflow: hidden; }
        .pg:last-of-type { page-break-after: auto; }
        @media print { body { background: ${S.bg} !important; } .no-print { display:none!important; } }
      `}} />

      {/* ══ COVER ══════════════════════════════════════════════════════ */}
      <div className="pg" style={{ display: "flex", flexDirection: "column" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: "14mm", paddingBottom: "5mm", borderBottom: `1px solid ${S.border}` }}>
          {brand.logoUrl
            ? <img src={brand.logoUrl} alt="Logo" style={{ height: "9mm", objectFit: "contain" }} />
            : <span style={{ fontSize: "7mm", fontWeight: 800, color: S.gold, letterSpacing: "0.06em" }}>SWL</span>
          }
          <span style={{ fontSize: "3.5mm", color: S.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Growth AI Engine
          </span>
        </div>

        {/* Main headline */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: "10mm" }}>
          <p style={{ fontSize: "3.2mm", color: S.gold, textTransform: "uppercase", letterSpacing: "0.16em",
              fontWeight: 700, marginBottom: "4mm" }}>Sales Report</p>
          <h1 style={{ fontSize: "14mm", fontWeight: 800, color: S.w, lineHeight: 1.1, margin: "0 0 5mm 0" }}>
            {brand.companyName}
          </h1>
          <p style={{ fontSize: "5.5mm", color: S.body, margin: 0 }}>{period}</p>
        </div>

        {/* KPI summary strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "4mm", marginBottom: "12mm" }}>
          {([
            ["Importados",   headline.totalLeads],
            ["Contactados",  headline.contactedLeads],
            ["Respondieron", headline.repliedCount],
            ["Positivos",    headline.positiveCount],
          ] as [string, number][]).map(([label, val]) => (
            <div key={label} style={{ background: S.card, borderRadius: "3mm", padding: "5mm",
                borderLeft: `2mm solid ${S.gold}` }}>
              <p style={{ fontSize: "2.8mm", color: S.muted, textTransform: "uppercase",
                  letterSpacing: "0.1em", margin: "0 0 2mm 0" }}>{label}</p>
              <p style={{ fontSize: "9mm", fontWeight: 800, color: S.gold, margin: 0, lineHeight: 1 }}>
                {fmt(val)}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "4mm",
            borderTop: `1px solid ${S.border}` }}>
          <span style={{ fontSize: "2.8mm", color: S.muted }}>Generado el {today}</span>
          <span style={{ fontSize: "2.8mm", color: S.muted }}>Growth AI Engine — SWL Consulting</span>
        </div>
      </div>

      {/* ══ OVERVIEW ═══════════════════════════════════════════════════ */}
      {(has("overview.kpis") || has("overview.icps")) && (
        <div className="pg">
          <PageHeader title="Overview" subtitle="Pipeline y performance por ICP" S={S} />

          {has("overview.kpis") && (
            <>
              <SectionLabel label="Pipeline KPIs" S={S} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "4mm", marginBottom: "8mm" }}>
                {([
                  ["Importados",    headline.totalLeads,     "total en pipeline"],
                  ["Contactados",   headline.contactedLeads, `${pct(headline.contactedLeads, headline.totalLeads)} del total`],
                  ["Respondieron",  headline.repliedCount,   `${headline.responseRate}% reply rate`],
                  ["Positivos",     headline.positiveCount,  `${pct(headline.positiveCount, headline.contactedLeads)} positive rate`],
                  ["Ganados",       headline.wonCount,       `${headline.conversionRate}% conv. rate`],
                  ["Campañas act.", data.activeCampaignCount,"activas ahora"],
                ] as [string, number, string][]).map(([label, val, sub]) => (
                  <StatBox key={label} label={label} value={fmt(val)} sub={sub} S={S} />
                ))}
              </div>
            </>
          )}

          {has("overview.icps") && icpPerformance.length > 0 && (
            <>
              <SectionLabel label="Performance por ICP" S={S} />
              <DataTable
                headers={["ICP", "Leads", "Contactados", "Resp.", "Reply %", "Positivos", "Flujos"]}
                rows={icpPerformance.slice(0, 10).map(p => [
                  String(p.name),
                  fmt(Number((p as Record<string,unknown>).leads ?? 0)),
                  fmt(Number((p as Record<string,unknown>).contacted ?? 0)),
                  fmt(Number((p as Record<string,unknown>).replied ?? 0)),
                  pct(Number((p as Record<string,unknown>).replied ?? 0), Number((p as Record<string,unknown>).contacted ?? 0)),
                  fmt(Number((p as Record<string,unknown>).positive ?? 0)),
                  fmt(Number((p as Record<string,unknown>).flows ?? 0)),
                ])}
                S={S}
              />
            </>
          )}
        </div>
      )}

      {/* ══ OUTREACH ═══════════════════════════════════════════════════ */}
      {(has("outreach.campaigns") || has("outreach.channels")) && (
        <div className="pg">
          <PageHeader title="Outreach" subtitle="Campañas y actividad por canal" S={S} />

          {has("outreach.channels") && channelBreakdown.length > 0 && (
            <>
              <SectionLabel label="Desglose por canal" S={S} />
              <DataTable
                headers={["Canal", "Enviados", "Contactados", "Respondieron", "Reply %", "Positivos", "Conv %"]}
                rows={channelBreakdown.map(c => [
                  c.channel.toUpperCase(),
                  fmt(c.sent),
                  fmt(c.contacted),
                  fmt(c.replied),
                  pct(c.replied, c.contacted),
                  fmt(c.positive),
                  pct(c.positive, c.contacted),
                ])}
                S={S}
              />
            </>
          )}

          {has("outreach.campaigns") && campaignPerformance.length > 0 && (
            <>
              <SectionLabel label="Performance por campaña (top 10)" S={S} />
              <DataTable
                headers={["Campaña", "Canal", "Enviados", "Respondieron", "Reply %", "Positivos"]}
                rows={(campaignPerformance as Array<Record<string,unknown>>).slice(0, 10).map(c => [
                  String(c.name ?? "").slice(0, 32),
                  String(c.channel ?? "—").toUpperCase(),
                  fmt(Number(c.sent ?? 0)),
                  fmt(Number(c.replied ?? 0)),
                  pct(Number(c.replied ?? 0), Number(c.sent ?? 1)),
                  fmt(Number(c.positive ?? 0)),
                ])}
                S={S}
              />
            </>
          )}
        </div>
      )}

      {/* ══ CHANNELS ═══════════════════════════════════════════════════ */}
      {(has("channels.email") || has("channels.linkedin") || has("channels.calls")) && (
        <div className="pg">
          <PageHeader title="Channels" subtitle="Estadísticas detalladas por canal" S={S} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "6mm" }}>
            {has("channels.linkedin") && (() => {
              const li = channelMap["linkedin"];
              return <ChannelCard name="LinkedIn" color="#0A66C2" stats={[
                ["Mensajes enviados", fmt(li?.sent ?? 0)],
                ["Contactados",       fmt(li?.contacted ?? 0)],
                ["Conexiones env.",   fmt(data.linkedinConnections.sent)],
                ["Aceptados",         fmt(data.linkedinConnections.accepted)],
                ["Respondieron",      fmt(li?.replied ?? 0)],
                ["Reply rate",        pct(li?.replied ?? 0, li?.contacted ?? 1)],
                ["Positivos",         fmt(li?.positive ?? 0)],
              ]} S={S} />;
            })()}
            {has("channels.email") && (() => {
              const em = channelMap["email"];
              return <ChannelCard name="Email" color="#059669" stats={[
                ["Enviados",     fmt(em?.sent ?? 0)],
                ["Contactados",  fmt(em?.contacted ?? 0)],
                ["Respondieron", fmt(em?.replied ?? 0)],
                ["Reply rate",   pct(em?.replied ?? 0, em?.contacted ?? 1)],
                ["Positivos",    fmt(em?.positive ?? 0)],
                ["Conv. rate",   pct(em?.positive ?? 0, em?.contacted ?? 1)],
              ]} S={S} />;
            })()}
            {has("channels.calls") && (
              <ChannelCard name="Calls" color="#EA580C" stats={[
                ["Realizadas",  fmt(calls?.made ?? 0)],
                ["Contestadas", fmt(calls?.answered ?? 0)],
                ["Positivas",   fmt(calls?.positive ?? 0)],
                ["Negativas",   fmt(calls?.negative ?? 0)],
                ["Pendientes",  fmt(calls?.pending ?? 0)],
                ["Answer rate", pct(calls?.answered ?? 0, calls?.made ?? 1)],
              ]} S={S} />
            )}
          </div>
        </div>
      )}

      {/* ══ SELLERS ════════════════════════════════════════════════════ */}
      {(has("sellers.activity") || has("sellers.table") || has("sellers.calls")) && (
        <div className="pg">
          <PageHeader title="Sellers" subtitle="Activity, leaderboard y call outcomes" S={S} />

          {has("sellers.activity") && sellerRows.length > 0 && (
            <>
              <SectionLabel label="Seller activity" S={S} />
              <DataTable
                headers={["Seller", "Último login", "Llamadas hoy", "Llamadas 7d", "Contactados", "Positivos"]}
                rows={sellerRows.map(s => [
                  s.name,
                  timeAgo(s.lastSeenAt),
                  fmt(s.callsToday),
                  fmt(s.callsWeek),
                  fmt(s.contacted),
                  fmt(s.positive),
                ])}
                S={S}
              />
            </>
          )}

          {has("sellers.table") && sellerRows.length > 0 && (
            <>
              <SectionLabel label="Leaderboard de performance" S={S} />
              <DataTable
                headers={["Seller", "Enviados", "Contactados", "Respondieron", "Reply %", "Positivos", "Campañas"]}
                rows={sellerRows.map(s => [
                  s.name,
                  fmt(s.sent),
                  fmt(s.contacted),
                  fmt(s.replied),
                  pct(s.replied, s.contacted),
                  fmt(s.positive),
                  fmt(s.active),
                ])}
                S={S}
              />
            </>
          )}

          {has("sellers.calls") && callOutcomesBySeller.length > 0 && (
            <>
              <SectionLabel label="Call outcomes por seller" S={S} />
              <DataTable
                headers={["Seller", "Realizadas", "Positivas", "Negativas", "Voicemail", "Sin resp.", "Positiv %"]}
                rows={callOutcomesBySeller.map(s => [
                  s.sellerName,
                  fmt(s.made),
                  fmt(s.interested),
                  fmt(s.notInterested),
                  fmt(s.voicemail),
                  fmt(s.wrongNumber + s.badTiming),
                  pct(s.interested, s.made),
                ])}
                S={S}
              />
            </>
          )}
        </div>
      )}

      <PrintTrigger />
    </>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function PageHeader({ title, subtitle, S }: { title: string; subtitle: string; S: Palette }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "4mm", marginBottom: "7mm",
        paddingBottom: "4mm", borderBottom: `1px solid ${S.border}` }}>
      <h2 style={{ fontSize: "8mm", fontWeight: 800, color: S.gold, margin: 0 }}>{title}</h2>
      <span style={{ fontSize: "3.5mm", color: S.muted }}>{subtitle}</span>
    </div>
  );
}

function SectionLabel({ label, S }: { label: string; S: Palette }) {
  return (
    <p style={{ fontSize: "2.8mm", color: S.muted, textTransform: "uppercase", letterSpacing: "0.12em",
        fontWeight: 700, margin: "0 0 3mm 0", paddingLeft: "2mm", borderLeft: `1.5mm solid ${S.gold}` }}>
      {label}
    </p>
  );
}

function StatBox({ label, value, sub, S }: { label: string; value: string; sub: string; S: Palette }) {
  return (
    <div style={{ background: S.card, borderRadius: "3mm", padding: "5mm 5mm 5mm 4mm",
        borderLeft: `2mm solid ${S.gold}` }}>
      <p style={{ fontSize: "2.5mm", color: S.muted, textTransform: "uppercase", letterSpacing: "0.1em",
          margin: "0 0 2.5mm 0" }}>{label}</p>
      <p style={{ fontSize: "9mm", fontWeight: 800, color: S.gold, margin: "0 0 1.5mm 0", lineHeight: 1 }}>
        {value}
      </p>
      <p style={{ fontSize: "2.5mm", color: S.muted, margin: 0 }}>{sub}</p>
    </div>
  );
}

function DataTable({ headers, rows, S }: { headers: string[]; rows: string[][]; S: Palette }) {
  return (
    <div style={{ width: "100%", marginBottom: "7mm" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr style={{ background: S.cardAlt }}>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: "3mm 3.5mm",
                textAlign: i === 0 ? "left" : "right",
                color: S.gold,
                fontWeight: 700,
                fontSize: "2.5mm",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                borderBottom: `1px solid ${S.border}`,
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
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} style={{ padding: "5mm", textAlign: "center",
                  color: S.muted, fontSize: "3mm" }}>
                Sin datos para el período seleccionado
              </td>
            </tr>
          ) : rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? S.card : S.cardAlt }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: "3mm 3.5mm",
                  color: ci === 0 ? S.body : S.w,
                  textAlign: ci === 0 ? "left" : "right",
                  fontWeight: ci === 0 ? 500 : 600,
                  fontSize: "3mm",
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
        </tbody>
      </table>
    </div>
  );
}

function ChannelCard({ name, color, stats, S }: { name: string; color: string; stats: [string, string][]; S: Palette }) {
  return (
    <div style={{ background: S.card, borderRadius: "3mm", padding: "6mm", borderTop: `3mm solid ${color}` }}>
      <p style={{ fontSize: "5mm", fontWeight: 700, color: S.w, margin: "0 0 5mm 0" }}>{name}</p>
      {stats.map(([label, val]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "baseline", marginBottom: "2.5mm" }}>
          <span style={{ fontSize: "3mm", color: S.muted }}>{label}</span>
          <span style={{ fontSize: "3.8mm", fontWeight: 700, color: S.w }}>{val}</span>
        </div>
      ))}
    </div>
  );
}
