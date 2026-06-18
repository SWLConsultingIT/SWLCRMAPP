// Print-only portfolio comparison (super-admin). Opened in a new tab from the
// dashboard Portfolio "Descargar PDF" button; auto-prints. Branded SWL/GrowthAI.
// Reads ?pdays=7|30|90 and ?companies=<bioId,bioId,...> (defaults to all).

import { getUserScope } from "@/lib/scope";
import { redirect } from "next/navigation";
import { getServerLocale } from "@/lib/i18n-server";
import { getPortfolioComparison, type PortfolioCompany } from "@/lib/portfolio";
import PrintTrigger from "../print/PrintTrigger";

export const dynamic = "force-dynamic";

const NAVY = "#0E2A47", NAVY2 = "#14365C", GOLD = "#C7A24B", MUTED = "#5b6b7b", LINE = "#e4e9ef";

function pct(cur: number, prev: number): { txt: string; col: string } {
  if (prev === 0) return { txt: "—", col: MUTED };
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p === 0) return { txt: "=", col: MUTED };
  return { txt: `${p > 0 ? "▲ +" : "▼ "}${p}%`, col: p > 0 ? "#15803D" : "#DC2626" };
}

export default async function PortfolioPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = await getUserScope();
  if (scope.tier !== "super_admin") redirect("/");
  const sp = await searchParams;
  const rawLoc = await getServerLocale();
  const es = rawLoc !== "en";
  const pdaysStr = Array.isArray(sp.pdays) ? sp.pdays[0] : sp.pdays;
  const days = pdaysStr === "all" ? 0 : [30, 90].includes(Number(pdaysStr)) ? Number(pdaysStr) : 7;
  const csv = (Array.isArray(sp.companies) ? sp.companies[0] : sp.companies) ?? "";
  const want = new Set(csv.split(",").map(s => s.trim()).filter(Boolean));

  const all = await getPortfolioComparison(days);
  const companies = (want.size ? all.filter(c => want.has(c.bioId)) : all.filter(c => c.contacted || c.calls || c.replies));
  const cols = companies.length || 1;
  const numLoc = es ? "es-AR" : "en-US";

  const T = es ? {
    brand: "GrowthAI · Status de cartera", title: "Portfolio — comparativo de empresas",
    note: days <= 0 ? "Histórico completo" : `Últimos ${days} días vs. los ${days} previos`, metric: "Métrica",
    act: "Actividad del período", contacted: "Leads contactados", messages: "Mensajes enviados",
    calls: "Llamadas", replies: "Respuestas", positives: "Positivas", meetings: "Reuniones", winsPeriod: "Wins (período)", respRate: "Tasa de respuesta",
    sumTitle: "Resumen ejecutivo",
    pipe: "Pipeline acumulado (histórico)", totalLeads: "Leads totales", activeLeads: "En flujo activo",
    activeFlows: "Flows activos", opportunities: "Oportunidades (positivas)", wins: "Wins",
    sellers: "Sellers · actividad del período", seller: "Seller", company: "Empresa", leads: "Leads", unassigned: "Sin asignar",
    foot: "GrowthAI — Status de actividad comercial · uso interno", gen: "Generado", live: "datos en vivo", comp: cols === 1 ? "empresa" : "empresas",
  } : {
    brand: "GrowthAI · Portfolio status", title: "Portfolio — company comparison",
    note: days <= 0 ? "All-time" : `Last ${days} days vs. prior ${days}`, metric: "Metric",
    act: "Activity this period", contacted: "Contacted leads", messages: "Messages sent",
    calls: "Calls", replies: "Replies", positives: "Positive", meetings: "Meetings", winsPeriod: "Wins (period)", respRate: "Response rate",
    sumTitle: "Executive summary",
    pipe: "Cumulative pipeline (all-time)", totalLeads: "Total leads", activeLeads: "In active flow",
    activeFlows: "Active flows", opportunities: "Opportunities (positive)", wins: "Wins",
    sellers: "Sellers · activity this period", seller: "Seller", company: "Company", leads: "Leads", unassigned: "Unassigned",
    foot: "GrowthAI — Commercial activity status · internal", gen: "Generated", live: "live data", comp: cols === 1 ? "company" : "companies",
  };
  const today = new Date().toLocaleDateString(numLoc, { day: "2-digit", month: "long", year: "numeric" });
  const rate = (c: PortfolioCompany) => (c.contacted ? Math.round((c.replies / c.contacted) * 100) : 0);

  const ACT: { label: string; k: keyof PortfolioCompany; pk: keyof PortfolioCompany }[] = [
    { label: T.contacted, k: "contacted", pk: "contactedPrev" },
    { label: T.messages, k: "messages", pk: "messagesPrev" },
    { label: T.calls, k: "calls", pk: "callsPrev" },
    { label: T.replies, k: "replies", pk: "repliesPrev" },
    { label: T.positives, k: "positives", pk: "positivesPrev" },
    { label: T.meetings, k: "meetings", pk: "meetingsPrev" },
    { label: T.winsPeriod, k: "winsPeriod", pk: "winsPeriodPrev" },
  ];
  const PIPE: { label: string; k: keyof PortfolioCompany; win?: boolean }[] = [
    { label: T.totalLeads, k: "totalLeads" },
    { label: T.activeLeads, k: "activeLeads" },
    { label: T.activeFlows, k: "activeFlows" },
    { label: T.opportunities, k: "opportunities" },
    { label: T.wins, k: "wins", win: true },
  ];
  const n = (c: PortfolioCompany, k: keyof PortfolioCompany) => c[k] as number;
  // Sellers flattened across companies for the print leaderboard.
  const sellerRows = companies.flatMap(c => c.sellers.map(s => ({ ...s, company: c.name })))
    .sort((a, b) => b.calls - a.calls || b.replies - a.replies);
  // Executive summary aggregate.
  const agg = (k: keyof PortfolioCompany) => companies.reduce((s, c) => s + (c[k] as number), 0);
  const fmt = (v: number) => v.toLocaleString(numLoc);
  const pc = (cur: number, prev: number) => prev === 0 ? "—" : `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%`;
  const sumText = es
    ? `${fmt(agg("contacted"))} leads contactados (${pc(agg("contacted"), agg("contactedPrev"))}) · ${fmt(agg("calls"))} llamadas (${pc(agg("calls"), agg("callsPrev"))}) · ${fmt(agg("positives"))} positivas · ${fmt(agg("meetings"))} reuniones · ${fmt(agg("winsPeriod"))} wins.`
    : `${fmt(agg("contacted"))} contacted leads (${pc(agg("contacted"), agg("contactedPrev"))}) · ${fmt(agg("calls"))} calls (${pc(agg("calls"), agg("callsPrev"))}) · ${fmt(agg("positives"))} positive · ${fmt(agg("meetings"))} meetings · ${fmt(agg("winsPeriod"))} wins.`;

  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <style>{`
          @page { size: A4; margin: 13mm 14mm; }
          * { margin:0; padding:0; box-sizing:border-box; }
          html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          body { font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif; color:#1c2733; font-size:10.5px; }
          .hero { background:linear-gradient(135deg,${NAVY},${NAVY2}); border-radius:14px; padding:22px 26px; color:#fff; position:relative; overflow:hidden; }
          .hero:after { content:""; position:absolute; right:-40px; top:-40px; width:150px; height:150px; border-radius:50%; background:rgba(199,162,75,.14); }
          .brand { font-size:11px; letter-spacing:.3em; font-weight:700; color:${GOLD}; text-transform:uppercase; }
          .hero h1 { font-size:22px; font-weight:800; margin-top:6px; }
          .hero p { font-size:11.5px; color:#cdd9e6; margin-top:5px; }
          .ct { font-size:9.5px; font-weight:800; letter-spacing:.13em; text-transform:uppercase; color:${GOLD}; margin:18px 0 7px; }
          .summary { background:#fff; border:1px solid ${LINE}; border-left:4px solid ${GOLD}; border-radius:11px; padding:12px 15px; margin-top:13px; }
          .summary .stitle { font-size:9px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:${GOLD}; margin-bottom:4px; }
          .summary p { font-size:11px; line-height:1.55; color:#33424f; }
          table { width:100%; border-collapse:collapse; border:1px solid ${LINE}; border-radius:10px; overflow:hidden; }
          th,td { padding:8px 11px; font-size:10.5px; border-bottom:1px solid ${LINE}; text-align:right; }
          th:first-child, td:first-child { text-align:left; }
          thead th { background:${NAVY}; color:#fff; font-size:10px; font-weight:700; }
          tbody tr:last-child td { border-bottom:none; }
          tbody td:first-child { color:${MUTED}; font-weight:500; }
          .v { font-weight:800; font-variant-numeric:tabular-nums; color:${NAVY}; }
          .d { font-size:9px; font-weight:700; margin-left:5px; }
          .foot { margin-top:18px; padding-top:8px; border-top:1px solid ${LINE}; font-size:8.5px; color:#9aa7b4; display:flex; justify-content:space-between; }
        `}</style>
      </head>
      <body>
        <PrintTrigger />
        <div className="hero">
          <div className="brand">{T.brand}</div>
          <h1>{T.title}</h1>
          <p>{T.note} · {today}</p>
        </div>

        <div className="summary"><div className="stitle">{T.sumTitle}</div><p>{sumText}</p></div>

        <div className="ct">{T.act}</div>
        <table>
          <thead>
            <tr><th>{T.metric}</th>{companies.map(c => <th key={c.bioId}>{c.name}</th>)}</tr>
          </thead>
          <tbody>
            {ACT.map(m => (
              <tr key={m.k as string}>
                <td>{m.label}</td>
                {companies.map(c => {
                  const d = pct(n(c, m.k), n(c, m.pk));
                  return <td key={c.bioId}><span className="v">{n(c, m.k).toLocaleString(numLoc)}</span><span className="d" style={{ color: d.col }}>{d.txt}</span></td>;
                })}
              </tr>
            ))}
            <tr>
              <td>{T.respRate}</td>
              {companies.map(c => <td key={c.bioId}><span className="v">{rate(c)}%</span></td>)}
            </tr>
          </tbody>
        </table>

        {sellerRows.length > 0 && (
          <>
            <div className="ct">{T.sellers}</div>
            <table>
              <thead>
                <tr><th>{T.seller}</th><th>{T.company}</th><th>{T.calls}</th><th>{T.leads}</th><th>{T.replies}</th><th>{T.positives}</th></tr>
              </thead>
              <tbody>
                {sellerRows.map((s, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: "left", fontWeight: 600, color: "#1c2733" }}>{s.name === "__unassigned__" ? T.unassigned : s.name}</td>
                    <td style={{ textAlign: "left", color: MUTED }}>{s.company}</td>
                    <td><span className="v">{s.calls}</span></td>
                    <td>{s.leads}</td>
                    <td>{s.replies}</td>
                    <td><span className="v" style={s.positives > 0 ? { color: "#15803D" } : undefined}>{s.positives}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="ct">{T.pipe}</div>
        <table>
          <thead>
            <tr><th>{T.metric}</th>{companies.map(c => <th key={c.bioId}>{c.name}</th>)}</tr>
          </thead>
          <tbody>
            {PIPE.map(m => (
              <tr key={m.k as string}>
                <td>{m.label}</td>
                {companies.map(c => <td key={c.bioId}><span className="v" style={m.win && n(c, m.k) > 0 ? { color: "#15803D" } : undefined}>{n(c, m.k).toLocaleString(numLoc)}</span></td>)}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="foot"><span>{T.foot}</span><span>{T.gen} {today} · {T.live} · {cols} {T.comp}</span></div>
      </body>
    </html>
  );
}
