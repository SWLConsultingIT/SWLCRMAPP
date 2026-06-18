"use client";

// Portfolio tab (super-admin only): pick companies to compare and see each
// one's weekly activity with week-over-week trend, seller comparison, channel
// mix (incl. calls) and cumulative pipeline. Live version of the status PDF.
// Pure client-side toggle over server-preloaded data — no extra fetch.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { C, N } from "@/lib/design";
import { TrendingUp, TrendingDown, Minus, Users, Phone, MessageSquare, ThumbsUp, Download } from "lucide-react";
import type { PortfolioCompany } from "@/lib/portfolio";

const gold = "var(--brand, #c9a83a)";

function dict(locale: "es" | "en") {
  const es = {
    brand: "GrowthAI · Portfolio", live: "En vivo", title: "Comparativo de empresas",
    note: (d: number) => `Últimos ${d} días vs. los ${d} previos · datos al instante`,
    pdf: "Descargar PDF", pick: "Empresas a comparar", noAct: "(sin actividad)",
    pickPrompt: "Elegí al menos una empresa para comparar.",
    activity: "Actividad del período", metric: "Métrica", respRate: "Tasa de respuesta",
    contacted: "Contactados", calls: "Llamadas", replies: "Respuestas", positives: "Positivas",
    meetings: "Reuniones", winsPeriod: "Wins (período)",
    sumTitle: "Resumen ejecutivo", sLeads: "leads contactados", sCalls: "llamadas",
    sPos: "positivas", sMeet: "reuniones", sWins: "wins",
    aCallsDown: "⚠ llamadas en fuerte baja vs. el período previo",
    aNoPos: "⚠ sin respuestas positivas en el período",
    aUp: "✓ actividad en alza vs. el período previo",
    pipeTitle: "Pipeline acumulado (histórico)",
    totalLeads: "Leads totales", activeLeads: "En flujo activo", activeFlows: "Flows activos",
    opportunities: "Oportunidades (positivas)", wins: "Wins",
    sellersTitle: "Sellers · actividad del período", seller: "Seller", company: "Empresa",
    leads: "Leads", channelMix: "Contacto por canal", noSends: "Sin actividad este período",
    unassigned: "Sin asignar", flows: "flows", msgs: "msgs", leadsLow: "leads",
    noSellers: "Sin actividad de sellers en el período",
  };
  const en = {
    brand: "GrowthAI · Portfolio", live: "Live", title: "Company comparison",
    note: (d: number) => `Last ${d} days vs. prior ${d} · real-time`,
    pdf: "Download PDF", pick: "Companies to compare", noAct: "(no activity)",
    pickPrompt: "Pick at least one company to compare.",
    activity: "Activity this period", metric: "Metric", respRate: "Response rate",
    contacted: "Contacted", calls: "Calls", replies: "Replies", positives: "Positive",
    meetings: "Meetings", winsPeriod: "Wins (period)",
    sumTitle: "Executive summary", sLeads: "leads contacted", sCalls: "calls",
    sPos: "positive", sMeet: "meetings", sWins: "wins",
    aCallsDown: "⚠ calls dropping sharply vs. the prior period",
    aNoPos: "⚠ no positive replies this period",
    aUp: "✓ activity trending up vs. the prior period",
    pipeTitle: "Cumulative pipeline (all-time)",
    totalLeads: "Total leads", activeLeads: "In active flow", activeFlows: "Active flows",
    opportunities: "Opportunities (positive)", wins: "Wins",
    sellersTitle: "Sellers · activity this period", seller: "Seller", company: "Company",
    leads: "Leads", channelMix: "Contact by channel", noSends: "No activity this period",
    unassigned: "Unassigned", flows: "flows", msgs: "msgs", leadsLow: "leads",
    noSellers: "No seller activity this period",
  };
  return locale === "en" ? en : es;
}

function channelLabel(ch: string) {
  return ch === "linkedin" ? "LinkedIn" : ch === "email" ? "Email" : ch === "call" ? "Call" : ch;
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0) return <span className="text-[10px]" style={{ color: C.textDim }}>—</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = cur > prev, flat = cur === prev;
  const col = flat ? C.textDim : up ? C.green : C.red;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums" style={{ color: col }}>
      <Icon size={10} />{pct > 0 ? `+${pct}` : pct}%
    </span>
  );
}

export default function PortfolioView({
  companies,
  days = 7,
  locale = "es",
}: {
  companies: PortfolioCompany[];
  days?: number;
  locale?: "es" | "en";
}) {
  const L = dict(locale);
  const router = useRouter();
  const params = useSearchParams();
  const active = companies.filter(c => c.contacted > 0 || c.calls > 0 || c.replies > 0);
  const [selected, setSelected] = useState<Set<string>>(
    new Set((active.length ? active : companies).map(c => c.bioId)),
  );
  const toggle = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  function setPeriod(d: number) {
    const n = new URLSearchParams(params.toString());
    if (d === 7) n.delete("pdays"); else n.set("pdays", String(d));
    router.replace(n.toString() ? `?${n.toString()}` : "?", { scroll: false });
  }
  function exportPdf() {
    window.open(`/reports/portfolio-print?pdays=${days}&companies=${[...selected].join(",")}`, "_blank");
  }
  const PERIODS = [7, 30, 90];

  const shown = companies.filter(c => selected.has(c.bioId));
  const num = (c: PortfolioCompany, k: string) => (c as unknown as Record<string, number>)[k];
  const rate = (c: PortfolioCompany) => (c.contacted ? Math.round((c.replies / c.contacted) * 100) : 0);
  const sum = (k: string) => shown.reduce((s, c) => s + num(c, k), 0);
  const leader = (k: string) => shown.reduce((best, c) => (num(c, k) > num(best, k) ? c : best), shown[0])?.bioId;
  const sellerName = (nm: string) => (nm === "__unassigned__" ? L.unassigned : nm);

  const METRICS = [
    { key: "contacted", prevKey: "contactedPrev", label: L.contacted, Icon: Users, color: gold },
    { key: "calls", prevKey: "callsPrev", label: L.calls, Icon: Phone, color: "#E08A1E" },
    { key: "replies", prevKey: "repliesPrev", label: L.replies, Icon: MessageSquare, color: C.blue },
    { key: "positives", prevKey: "positivesPrev", label: L.positives, Icon: ThumbsUp, color: C.green },
  ] as const;
  const PIPE = [
    { label: L.totalLeads, k: "totalLeads" },
    { label: L.activeLeads, k: "activeLeads" },
    { label: L.activeFlows, k: "activeFlows" },
    { label: L.opportunities, k: "opportunities" },
    { label: L.wins, k: "wins", win: true },
  ] as const;

  // Flatten sellers across shown companies for the comparison leaderboard.
  const sellerRows = shown.flatMap(c => c.sellers.map(s => ({ ...s, company: c.name })))
    .sort((a, b) => b.calls - a.calls || b.replies - a.replies);

  const fmt = (v: number) => v.toLocaleString(locale === "en" ? "en-US" : "es-AR");
  const pctStr = (cur: number, prev: number) => prev === 0 ? "—" : `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%`;
  // Trend cell for the activity table.
  const tcell = (k: string, pk: string, green = false) => (c: PortfolioCompany) => (
    <div className="flex items-center justify-end gap-2">
      <span className="text-base font-bold tabular-nums" style={{ color: green && num(c, k) > 0 ? C.green : C.textPrimary }}>{fmt(num(c, k))}</span>
      <Delta cur={num(c, k)} prev={num(c, pk)} />
    </div>
  );
  // Executive summary — aggregate of the shown companies + an alert.
  const agg = (k: string) => shown.reduce((s, c) => s + num(c, k), 0);
  const sumText = `${fmt(agg("contacted"))} ${L.sLeads} (${pctStr(agg("contacted"), agg("contactedPrev"))}) · ${fmt(agg("calls"))} ${L.sCalls} (${pctStr(agg("calls"), agg("callsPrev"))}) · ${fmt(agg("positives"))} ${L.sPos} · ${fmt(agg("meetings"))} ${L.sMeet} · ${fmt(agg("winsPeriod"))} ${L.sWins}.`;
  const alerts: string[] = [];
  if (agg("callsPrev") > 0 && agg("calls") < agg("callsPrev") * 0.7) alerts.push(L.aCallsDown);
  if (agg("positives") === 0) alerts.push(L.aNoPos);
  if (alerts.length === 0 && agg("contacted") >= agg("contactedPrev")) alerts.push(L.aUp);

  return (
    <section className="space-y-5 pt-3">
      {/* ─── Branded hero ─────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden px-6 py-5"
        style={{ background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`, border: `1px solid color-mix(in srgb, ${gold} 26%, ${N.hairline})` }}>
        <span aria-hidden className="absolute -top-16 -right-10 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 16%, transparent) 0%, transparent 65%)` }} />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: gold }}>{L.brand}</span>
              <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ color: "#34D399", backgroundColor: "rgba(52,211,153,.12)", border: "1px solid rgba(52,211,153,.35)" }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#34D399" }} /> {L.live}
              </span>
            </div>
            <h2 className="text-[22px] font-bold mt-1" style={{ color: "#fff", letterSpacing: "-.01em" }}>{L.title}</h2>
            <p className="text-[11.5px] mt-1" style={{ color: "color-mix(in srgb, #F5F2E8 60%, transparent)" }}>{L.note(days)}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid color-mix(in srgb, #fff 18%, transparent)" }}>
              {PERIODS.map(d => (
                <button key={d} onClick={() => setPeriod(d)}
                  className="px-3 py-1.5 text-xs font-bold transition"
                  style={{ backgroundColor: days === d ? gold : "transparent", color: days === d ? "#1A1505" : "color-mix(in srgb, #F5F2E8 70%, transparent)" }}>
                  {d}d
                </button>
              ))}
            </div>
            <button onClick={exportPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition hover:-translate-y-0.5"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`, color: "#1A1505" }}>
              <Download size={13} /> {L.pdf}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Combined totals strip ────────────────────────────────── */}
      {shown.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {METRICS.map(m => (
            <div key={m.key} className="rounded-xl border p-3.5 relative overflow-hidden"
              style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid color-mix(in srgb, ${m.color} 70%, transparent)` }}>
              <div className="flex items-center gap-1.5 mb-1">
                <m.Icon size={12} style={{ color: m.color }} />
                <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>{m.label}</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-[24px] font-bold leading-none tabular-nums" style={{ color: m.key === "positives" && sum(m.key) > 0 ? C.green : C.textPrimary }}>
                  {sum(m.key).toLocaleString(locale === "en" ? "en-US" : "es-AR")}
                </span>
                <Delta cur={sum(m.key)} prev={sum(m.prevKey)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Executive summary ────────────────────────────────────── */}
      {shown.length > 0 && (
        <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `4px solid ${gold}` }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1.5" style={{ color: gold }}>{L.sumTitle}</p>
          <p className="text-[12.5px] leading-relaxed" style={{ color: C.textBody }}>{sumText}</p>
          {alerts.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {alerts.map((a, i) => {
                const warn = a.startsWith("⚠");
                return (
                  <span key={i} className="text-[11px] font-semibold px-2 py-1 rounded-md"
                    style={{ color: warn ? C.red : C.green, backgroundColor: warn ? C.redLight : "color-mix(in srgb, #15803D 10%, transparent)" }}>
                    {a}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Company picker ───────────────────────────────────────── */}
      <div className="rounded-xl border p-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>{L.pick}</p>
        <div className="flex flex-wrap gap-2">
          {companies.map(c => {
            const on = selected.has(c.bioId);
            const activ = c.contacted > 0 || c.calls > 0 || c.replies > 0;
            return (
              <button key={c.bioId} onClick={() => toggle(c.bioId)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition border"
                style={{ backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : C.surface, borderColor: on ? gold : C.border, color: on ? C.textPrimary : C.textMuted }}>
                {c.name}{!activ && <span className="ml-1 text-[9px]" style={{ color: C.textDim }}>{L.noAct}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border py-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm" style={{ color: C.textMuted }}>{L.pickPrompt}</p>
        </div>
      ) : (
        <>
          {/* ─── Activity comparison ──────────────────────────────── */}
          <CompareTable title={L.activity} metricLabel={L.metric} companies={shown}
            rows={METRICS.map(m => ({
              label: m.label, Icon: m.Icon, color: m.color,
              cell: (c) => {
                const isLeader = shown.length > 1 && num(c, m.key) > 0 && c.bioId === leader(m.key);
                const valCol = m.key === "positives" && num(c, m.key) > 0 ? C.green : isLeader ? gold : C.textPrimary;
                return (
                  <div className="flex items-center justify-end gap-2" style={isLeader ? { } : undefined}>
                    <span className="text-base font-bold tabular-nums" style={{ color: valCol }}>{num(c, m.key).toLocaleString(locale === "en" ? "en-US" : "es-AR")}</span>
                    <Delta cur={num(c, m.key)} prev={num(c, m.prevKey)} />
                  </div>
                );
              },
            })).concat([
              { label: L.meetings, cell: tcell("meetings", "meetingsPrev") },
              { label: L.winsPeriod, cell: tcell("winsPeriod", "winsPeriodPrev", true) },
              { label: L.respRate, cell: (c) => <span className="text-base font-bold tabular-nums" style={{ color: C.textPrimary }}>{rate(c)}%</span> },
            ])}
          />

          {/* ─── Sellers comparison ───────────────────────────────── */}
          <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: C.border }}>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: gold }}>{L.sellersTitle}</p>
            </div>
            {sellerRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-center" style={{ color: C.textDim }}>{L.noSellers}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.seller}</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.company}</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.calls}</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.leads}</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.replies}</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.positives}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellerRows.map((s, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td className="px-4 py-2.5 font-semibold" style={{ color: C.textPrimary }}>{sellerName(s.name)}</td>
                        <td className="px-4 py-2.5 text-xs" style={{ color: C.textMuted }}>{s.company}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums" style={{ color: C.textPrimary }}>{s.calls}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: C.textBody }}>{s.leads}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: C.textBody }}>{s.replies}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums" style={{ color: s.positives > 0 ? C.green : C.textBody }}>{s.positives}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ─── Pipeline acumulado ───────────────────────────────── */}
          <CompareTable title={L.pipeTitle} metricLabel={L.metric} companies={shown}
            rows={PIPE.map(r => ({
              label: r.label,
              cell: (c) => <span className="text-base font-bold tabular-nums" style={{ color: ("win" in r && r.win) && num(c, r.k) > 0 ? C.green : C.textPrimary }}>{num(c, r.k).toLocaleString(locale === "en" ? "en-US" : "es-AR")}</span>,
            }))}
          />

          {/* ─── Per-company: leads/flows + channel mix ───────────── */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(shown.length, 3)}, minmax(0,1fr))` }}>
            {shown.map(c => (
              <div key={c.bioId} className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{c.name}</span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: C.surface, color: C.textBody }}>{c.totalLeads.toLocaleString(locale === "en" ? "en-US" : "es-AR")} {L.leads.toLowerCase()}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${gold} 13%, transparent)`, color: C.textBody }}>{c.activeFlows} {L.flows}</span>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>{L.channelMix}</p>
                {c.byChannel.length === 0 ? (
                  <p className="text-xs" style={{ color: C.textDim }}>{L.noSends}</p>
                ) : (
                  <div className="space-y-1">
                    {c.byChannel.map(ch => (
                      <div key={ch.channel} className="flex items-center justify-between text-xs">
                        <span style={{ color: C.textBody }}>{channelLabel(ch.channel)}</span>
                        <span className="tabular-nums" style={{ color: C.textMuted }}>
                          <b style={{ color: C.textPrimary }}>{ch.messages}</b> {L.msgs} · {ch.leads} {L.leadsLow}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// Shared comparison table — metrics as rows, one column per company.
function CompareTable({
  title, metricLabel, companies, rows,
}: {
  title: string; metricLabel: string; companies: PortfolioCompany[];
  rows: { label: string; Icon?: React.ElementType; color?: string; cell: (c: PortfolioCompany) => React.ReactNode }[];
}) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: C.border }}>
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: gold }}>{title}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 140 + companies.length * 150 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{metricLabel}</th>
              {companies.map(c => (
                <th key={c.bioId} className="text-right px-4 py-2.5 text-xs font-bold" style={{ color: C.textPrimary }}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: C.textBody }}>
                    {r.Icon && <r.Icon size={13} style={{ color: r.color }} />} {r.label}
                  </span>
                </td>
                {companies.map(c => (
                  <td key={c.bioId} className="px-4 py-2.5 text-right">{r.cell(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
