// Print-only portfolio comparison (super-admin). Opened in a new tab from the
// dashboard Portfolio "Descargar PDF" button; auto-prints. Branded SWL/GrowthAI.
// Reads ?pdays=7|30|90 and ?companies=<bioId,bioId,...> (defaults to all).

import { getUserScope } from "@/lib/scope";
import { redirect } from "next/navigation";
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
  const pdaysRaw = Number(Array.isArray(sp.pdays) ? sp.pdays[0] : sp.pdays);
  const days = [7, 30, 90].includes(pdaysRaw) ? pdaysRaw : 7;
  const csv = (Array.isArray(sp.companies) ? sp.companies[0] : sp.companies) ?? "";
  const want = new Set(csv.split(",").map(s => s.trim()).filter(Boolean));

  const all = await getPortfolioComparison(days);
  const companies = (want.size ? all.filter(c => want.has(c.bioId)) : all.filter(c => c.contacted || c.calls || c.replies));
  const cols = companies.length || 1;

  const today = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
  const rate = (c: PortfolioCompany) => (c.contacted ? Math.round((c.replies / c.contacted) * 100) : 0);

  const ACT: { label: string; k: keyof PortfolioCompany; pk: keyof PortfolioCompany }[] = [
    { label: "Leads contactados", k: "contacted", pk: "contactedPrev" },
    { label: "Mensajes enviados", k: "messages", pk: "messagesPrev" },
    { label: "Llamadas", k: "calls", pk: "callsPrev" },
    { label: "Respuestas", k: "replies", pk: "repliesPrev" },
    { label: "Positivas", k: "positives", pk: "positivesPrev" },
  ];
  const PIPE: { label: string; k: keyof PortfolioCompany; win?: boolean }[] = [
    { label: "Leads totales", k: "totalLeads" },
    { label: "En flujo activo", k: "activeLeads" },
    { label: "Oportunidades (positivas)", k: "opportunities" },
    { label: "Wins", k: "wins", win: true },
  ];
  const n = (c: PortfolioCompany, k: keyof PortfolioCompany) => c[k] as number;

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
          <div className="brand">GrowthAI · Status de cartera</div>
          <h1>Portfolio — comparativo de empresas</h1>
          <p>Últimos {days} días vs. los {days} previos · {today}</p>
        </div>

        <div className="ct">Actividad del período</div>
        <table>
          <thead>
            <tr><th>Métrica</th>{companies.map(c => <th key={c.bioId}>{c.name}</th>)}</tr>
          </thead>
          <tbody>
            {ACT.map(m => (
              <tr key={m.k as string}>
                <td>{m.label}</td>
                {companies.map(c => {
                  const d = pct(n(c, m.k), n(c, m.pk));
                  return <td key={c.bioId}><span className="v">{n(c, m.k).toLocaleString("es-AR")}</span><span className="d" style={{ color: d.col }}>{d.txt}</span></td>;
                })}
              </tr>
            ))}
            <tr>
              <td>Tasa de respuesta</td>
              {companies.map(c => <td key={c.bioId}><span className="v">{rate(c)}%</span></td>)}
            </tr>
          </tbody>
        </table>

        <div className="ct">Pipeline acumulado (histórico)</div>
        <table>
          <thead>
            <tr><th>Métrica</th>{companies.map(c => <th key={c.bioId}>{c.name}</th>)}</tr>
          </thead>
          <tbody>
            {PIPE.map(m => (
              <tr key={m.k as string}>
                <td>{m.label}</td>
                {companies.map(c => <td key={c.bioId}><span className="v" style={m.win && n(c, m.k) > 0 ? { color: "#15803D" } : undefined}>{n(c, m.k).toLocaleString("es-AR")}</span></td>)}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="foot"><span>GrowthAI — Status de actividad comercial · uso interno</span><span>Generado {today} · datos en vivo · {cols} empresa{cols === 1 ? "" : "s"}</span></div>
      </body>
    </html>
  );
}
