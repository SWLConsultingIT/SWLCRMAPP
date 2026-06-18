"use client";

// Portfolio tab (super-admin only): pick companies to compare and see each
// one's weekly activity with week-over-week trend, seller comparison, channel
// mix (incl. calls) and cumulative pipeline. Live version of the status PDF.
// Pure client-side toggle over server-preloaded data — no extra fetch.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { C, N } from "@/lib/design";
import { TrendingUp, TrendingDown, Minus, Users, Phone, MessageSquare, ThumbsUp, Download, Building2, Trophy } from "lucide-react";
import type { PortfolioCompany } from "@/lib/portfolio";

const gold = "var(--brand, #c9a83a)";
const CARD_SH = "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -16px rgba(0,0,0,0.18)";

function dict(locale: "es" | "en") {
  const es = {
    brand: "GrowthAI · Portfolio", live: "En vivo", title: "Comparativo de empresas", allTime: "Todo",
    note: (d: number) => d <= 0 ? "Histórico completo · datos al instante" : `Últimos ${d} días vs. los ${d} previos · datos al instante`,
    pdf: "Descargar PDF", pick: "Empresas a comparar", noAct: "sin actividad",
    pickPrompt: "Elegí al menos una empresa para comparar.",
    activity: "Actividad del período", metric: "Métrica", respRate: "Tasa de respuesta",
    contacted: "Contactados", calls: "Llamadas", replies: "Respuestas", positives: "Positivas",
    meetings: "Reuniones", winsPeriod: "Wins (período)",
    sumTitle: "Resumen ejecutivo", sLeads: "leads contactados", sCalls: "llamadas",
    sPos: "positivas", sMeet: "reuniones", sWins: "wins",
    aCallsDown: "⚠ llamadas en fuerte baja vs. el período previo",
    aNoPos: "⚠ sin respuestas positivas en el período",
    aUp: "✓ actividad en alza vs. el período previo",
    pipeTitle: "Pipeline · estado actual", pipeNote: "Totales actuales y acumulados — no varían con el filtro de período.",
    totalLeads: "Leads totales", activeLeads: "En flujo activo", activeFlows: "Flows activos",
    opportunities: "Oportunidades (positivas)", wins: "Wins",
    sellersTitle: "Sellers · actividad del período", seller: "Seller", company: "Empresa",
    leads: "Leads", channelMix: "Contacto por canal", noSends: "Sin actividad este período",
    unassigned: "Sin asignar", flows: "flows", msgs: "msgs", leadsLow: "leads",
    noSellers: "Sin actividad de sellers en el período",
  };
  const en = {
    brand: "GrowthAI · Portfolio", live: "Live", title: "Company comparison", allTime: "All",
    note: (d: number) => d <= 0 ? "All-time · real-time data" : `Last ${d} days vs. prior ${d} · real-time`,
    pdf: "Download PDF", pick: "Companies to compare", noAct: "no activity",
    pickPrompt: "Pick at least one company to compare.",
    activity: "Activity this period", metric: "Metric", respRate: "Response rate",
    contacted: "Contacted", calls: "Calls", replies: "Replies", positives: "Positive",
    meetings: "Meetings", winsPeriod: "Wins (period)",
    sumTitle: "Executive summary", sLeads: "leads contacted", sCalls: "calls",
    sPos: "positive", sMeet: "meetings", sWins: "wins",
    aCallsDown: "⚠ calls dropping sharply vs. the prior period",
    aNoPos: "⚠ no positive replies this period",
    aUp: "✓ activity trending up vs. the prior period",
    pipeTitle: "Pipeline · current state", pipeNote: "Current & cumulative totals — not affected by the period filter.",
    totalLeads: "Total leads", activeLeads: "In active flow", activeFlows: "Active flows",
    opportunities: "Opportunities (positive)", wins: "Wins",
    sellersTitle: "Sellers · activity this period", seller: "Seller", company: "Company",
    leads: "Leads", channelMix: "Contact by channel", noSends: "No activity this period",
    unassigned: "Unassigned", flows: "flows", msgs: "msgs", leadsLow: "leads",
    noSellers: "No seller activity this period",
  };
  return locale === "en" ? en : es;
}

const channelLabel = (ch: string) => ch === "linkedin" ? "LinkedIn" : ch === "email" ? "Email" : ch === "call" ? "Call" : ch;
const channelColor = (ch: string) => ch === "linkedin" ? C.linkedin : ch === "email" ? "#7A5CC0" : ch === "call" ? "#E08A1E" : C.textMuted;

function initials(name: string) {
  return name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}
function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-full font-bold shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), color: "#1A1505",
        background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 68%, white))`,
        boxShadow: `0 1px 4px color-mix(in srgb, ${gold} 35%, transparent)` }}>
      {initials(name)}
    </span>
  );
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0) return <span className="text-[10px]" style={{ color: C.textDim }}>—</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = cur > prev, flat = cur === prev;
  const col = flat ? C.textDim : up ? C.green : C.red;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md"
      style={{ color: col, backgroundColor: flat ? "transparent" : `color-mix(in srgb, ${col} 11%, transparent)` }}>
      <Icon size={10} />{pct > 0 ? `+${pct}` : pct}%
    </span>
  );
}

// Premium panel wrapper — matches the app's chapter panels.
function Panel({ title, icon: Icon, note, children }: { title: string; icon?: React.ElementType; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: CARD_SH }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: C.border, background: `linear-gradient(180deg, color-mix(in srgb, ${gold} 4%, transparent), transparent)` }}>
        <div className="flex items-center gap-2">
          <span className="w-1 h-3.5 rounded-full" style={{ background: gold }} />
          {Icon && <Icon size={13} style={{ color: gold }} />}
          <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: gold }}>{title}</p>
        </div>
        {note && <p className="text-[10px] mt-1 ml-3" style={{ color: C.textDim }}>{note}</p>}
      </div>
      {children}
    </div>
  );
}

export default function PortfolioView({
  companies, days = 7, locale = "es",
}: {
  companies: PortfolioCompany[]; days?: number; locale?: "es" | "en";
}) {
  const L = dict(locale);
  const router = useRouter();
  const params = useSearchParams();
  const active = companies.filter(c => c.contacted > 0 || c.calls > 0 || c.replies > 0);
  const [selected, setSelected] = useState<Set<string>>(new Set((active.length ? active : companies).map(c => c.bioId)));
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  function setPeriod(d: number) {
    const n = new URLSearchParams(params.toString());
    if (d === 7) n.delete("pdays"); else n.set("pdays", d === 0 ? "all" : String(d));
    router.replace(n.toString() ? `?${n.toString()}` : "?", { scroll: false });
  }
  const exportPdf = () => window.open(`/reports/portfolio-print?pdays=${days === 0 ? "all" : days}&companies=${[...selected].join(",")}`, "_blank");
  const PERIODS = [7, 30, 90, 0];

  const shown = companies.filter(c => selected.has(c.bioId));
  const num = (c: PortfolioCompany, k: string) => (c as unknown as Record<string, number>)[k];
  const fmt = (v: number) => v.toLocaleString(locale === "en" ? "en-US" : "es-AR");
  const rate = (c: PortfolioCompany) => (c.contacted ? Math.round((c.replies / c.contacted) * 100) : 0);
  const sum = (k: string) => shown.reduce((s, c) => s + num(c, k), 0);
  const leader = (k: string) => shown.reduce((best, c) => (num(c, k) > num(best, k) ? c : best), shown[0])?.bioId;
  const sellerName = (nm: string) => (nm === "__unassigned__" ? L.unassigned : nm);
  const pctStr = (cur: number, prev: number) => prev === 0 ? "—" : `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%`;

  const METRICS = [
    { key: "contacted", prevKey: "contactedPrev", label: L.contacted, Icon: Users, color: gold },
    { key: "calls", prevKey: "callsPrev", label: L.calls, Icon: Phone, color: "#E08A1E" },
    { key: "replies", prevKey: "repliesPrev", label: L.replies, Icon: MessageSquare, color: C.blue },
    { key: "positives", prevKey: "positivesPrev", label: L.positives, Icon: ThumbsUp, color: C.green },
  ] as const;
  const ACT_ROWS = [
    ...METRICS.map(m => ({ key: m.key, prevKey: m.prevKey, label: m.label, Icon: m.Icon as React.ElementType, color: m.color, green: m.key === "positives", rate: false })),
    { key: "meetings", prevKey: "meetingsPrev", label: L.meetings, Icon: undefined, color: undefined, green: false, rate: false },
    { key: "winsPeriod", prevKey: "winsPeriodPrev", label: L.winsPeriod, Icon: undefined, color: undefined, green: true, rate: false },
    { key: "__rate", prevKey: "", label: L.respRate, Icon: undefined, color: undefined, green: false, rate: true },
  ];
  const PIPE = [
    { label: L.totalLeads, k: "totalLeads", win: false },
    { label: L.activeLeads, k: "activeLeads", win: false },
    { label: L.activeFlows, k: "activeFlows", win: false },
    { label: L.opportunities, k: "opportunities", win: false },
    { label: L.wins, k: "wins", win: true },
  ];
  const sellerRows = shown.flatMap(c => c.sellers.map(s => ({ ...s, company: c.name }))).sort((a, b) => b.calls - a.calls || b.replies - a.replies);

  const agg = (k: string) => shown.reduce((s, c) => s + num(c, k), 0);
  const sumText = `${fmt(agg("contacted"))} ${L.sLeads} (${pctStr(agg("contacted"), agg("contactedPrev"))}) · ${fmt(agg("calls"))} ${L.sCalls} (${pctStr(agg("calls"), agg("callsPrev"))}) · ${fmt(agg("positives"))} ${L.sPos} · ${fmt(agg("meetings"))} ${L.sMeet} · ${fmt(agg("winsPeriod"))} ${L.sWins}.`;
  const alerts: string[] = [];
  if (agg("callsPrev") > 0 && agg("calls") < agg("callsPrev") * 0.7) alerts.push(L.aCallsDown);
  if (agg("positives") === 0) alerts.push(L.aNoPos);
  if (alerts.length === 0 && agg("contacted") >= agg("contactedPrev")) alerts.push(L.aUp);

  // Company column header (avatar + name), reused by both compare tables.
  const colHead = (c: PortfolioCompany) => (
    <th key={c.bioId} className="px-4 py-2.5">
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs font-bold truncate max-w-[120px]" style={{ color: C.textPrimary }}>{c.name}</span>
        <Avatar name={c.name} size={20} />
      </div>
    </th>
  );

  return (
    <section className="space-y-4 pt-3">
      {/* ─── Branded hero ─────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden px-6 py-5"
        style={{ background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`, border: `1px solid color-mix(in srgb, ${gold} 26%, ${N.hairline})`, boxShadow: `0 14px 40px -22px ${N.ink}` }}>
        <span aria-hidden className="absolute -top-16 -right-10 w-60 h-60 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 17%, transparent) 0%, transparent 65%)` }} />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: gold }}>{L.brand}</span>
              <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ color: "#34D399", backgroundColor: "rgba(52,211,153,.12)", border: "1px solid rgba(52,211,153,.35)" }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#34D399" }} /> {L.live}
              </span>
            </div>
            <h2 className="text-[23px] font-bold mt-1.5" style={{ color: "#fff", letterSpacing: "-.015em" }}>{L.title}</h2>
            <p className="text-[11.5px] mt-1" style={{ color: "color-mix(in srgb, #F5F2E8 60%, transparent)" }}>{L.note(days)}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid color-mix(in srgb, #fff 18%, transparent)" }}>
              {PERIODS.map(d => (
                <button key={d} onClick={() => setPeriod(d)} className="px-3 py-1.5 text-xs font-bold transition"
                  style={{ backgroundColor: days === d ? gold : "transparent", color: days === d ? "#1A1505" : "color-mix(in srgb, #F5F2E8 70%, transparent)" }}>{d === 0 ? L.allTime : `${d}d`}</button>
              ))}
            </div>
            <button onClick={exportPdf} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition hover:-translate-y-0.5"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`, color: "#1A1505", boxShadow: `0 6px 18px -6px color-mix(in srgb, ${gold} 60%, transparent)` }}>
              <Download size={13} /> {L.pdf}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Totals — premium KPI cards ───────────────────────────── */}
      {shown.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {METRICS.map(m => (
            <div key={m.key} className="relative rounded-2xl border overflow-hidden p-4 transition-[transform,box-shadow] hover:-translate-y-0.5"
              style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: CARD_SH }}>
              <div aria-hidden className="absolute -top-10 -right-10 w-28 h-28 rounded-full opacity-70 pointer-events-none"
                style={{ background: `radial-gradient(circle, color-mix(in srgb, ${m.color} 18%, transparent) 0%, transparent 70%)` }} />
              <div className="relative flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${m.color} 14%, transparent)`, color: m.color }}>
                  <m.Icon size={12} />
                </span>
                <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>{m.label}</span>
              </div>
              <div className="relative flex items-end justify-between">
                <span className="text-[26px] font-bold leading-none tabular-nums" style={{ color: m.key === "positives" && sum(m.key) > 0 ? C.green : C.textPrimary }}>{fmt(sum(m.key))}</span>
                <Delta cur={sum(m.key)} prev={sum(m.prevKey)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Executive summary ────────────────────────────────────── */}
      {shown.length > 0 && (
        <div className="relative rounded-2xl border overflow-hidden p-4" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `4px solid ${gold}`, boxShadow: CARD_SH }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: gold }}>{L.sumTitle}</p>
          <p className="text-[12.5px] leading-relaxed" style={{ color: C.textBody }}>{sumText}</p>
          {alerts.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {alerts.map((a, i) => {
                const warn = a.startsWith("⚠");
                return <span key={i} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
                  style={{ color: warn ? C.red : C.green, backgroundColor: warn ? C.redLight : "color-mix(in srgb, #059669 11%, transparent)" }}>{a}</span>;
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Company picker ───────────────────────────────────────── */}
      <div className="rounded-2xl border p-3.5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: CARD_SH }}>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5" style={{ color: C.textDim }}><Building2 size={12} /> {L.pick}</p>
        <div className="flex flex-wrap gap-2">
          {companies.map(c => {
            const on = selected.has(c.bioId);
            const activ = c.contacted > 0 || c.calls > 0 || c.replies > 0;
            return (
              <button key={c.bioId} onClick={() => toggle(c.bioId)}
                className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-xs font-semibold transition border"
                style={{ backgroundColor: on ? `color-mix(in srgb, ${gold} 14%, transparent)` : C.surface, borderColor: on ? gold : C.border, color: on ? C.textPrimary : C.textMuted, opacity: on ? 1 : 0.7 }}>
                <Avatar name={c.name} size={18} />
                {c.name}{!activ && <span className="text-[9px] font-medium" style={{ color: C.textDim }}>· {L.noAct}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border py-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: CARD_SH }}>
          <p className="text-sm" style={{ color: C.textMuted }}>{L.pickPrompt}</p>
        </div>
      ) : (
        <>
          {/* ─── Activity comparison ──────────────────────────────── */}
          <Panel title={L.activity} icon={TrendingUp}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 150 + shown.length * 150 }}>
                <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.metric}</th>
                  {shown.map(colHead)}
                </tr></thead>
                <tbody>
                  {ACT_ROWS.map((r, ri) => (
                    <tr key={r.key} className="transition-colors hover:bg-black/[0.015]" style={{ borderBottom: ri < ACT_ROWS.length - 1 ? `1px solid ${C.border}` : "none", backgroundColor: ri % 2 ? "color-mix(in srgb, var(--c-surface) 40%, transparent)" : "transparent" }}>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: C.textBody }}>
                          {r.Icon && <r.Icon size={13} style={{ color: r.color }} />} {r.label}
                        </span>
                      </td>
                      {shown.map(c => {
                        if (r.rate) return <td key={c.bioId} className="px-4 py-2.5 text-right text-base font-bold tabular-nums" style={{ color: C.textPrimary }}>{rate(c)}%</td>;
                        const isLeader = shown.length > 1 && num(c, r.key) > 0 && c.bioId === leader(r.key);
                        const valCol = r.green && num(c, r.key) > 0 ? C.green : isLeader ? gold : C.textPrimary;
                        return (
                          <td key={c.bioId} className="px-4 py-2.5 text-right" style={isLeader ? { backgroundColor: `color-mix(in srgb, ${gold} 6%, transparent)` } : undefined}>
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-base font-bold tabular-nums" style={{ color: valCol }}>{fmt(num(c, r.key))}</span>
                              <Delta cur={num(c, r.key)} prev={num(c, r.prevKey)} />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ─── Sellers comparison ───────────────────────────────── */}
          <Panel title={L.sellersTitle} icon={Trophy}>
            {sellerRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-center" style={{ color: C.textDim }}>{L.noSellers}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.seller}</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.company}</th>
                    {[L.calls, L.leads, L.replies, L.positives].map(h => <th key={h} className="text-right px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {sellerRows.map((s, i) => (
                      <tr key={i} className="transition-colors hover:bg-black/[0.015]" style={{ borderBottom: i < sellerRows.length - 1 ? `1px solid ${C.border}` : "none", backgroundColor: i % 2 ? "color-mix(in srgb, var(--c-surface) 40%, transparent)" : "transparent" }}>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2">
                            {i < 3 && <span className="text-[10px] font-bold w-4 text-center" style={{ color: i === 0 ? gold : C.textDim }}>{i + 1}</span>}
                            <Avatar name={sellerName(s.name)} size={20} />
                            <span className="font-semibold" style={{ color: C.textPrimary }}>{sellerName(s.name)}</span>
                          </span>
                        </td>
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
          </Panel>

          {/* ─── Pipeline · estado actual ─────────────────────────── */}
          <Panel title={L.pipeTitle} icon={Building2} note={L.pipeNote}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 150 + shown.length * 150 }}>
                <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>{L.metric}</th>
                  {shown.map(colHead)}
                </tr></thead>
                <tbody>
                  {PIPE.map((r, ri) => (
                    <tr key={r.k} className="transition-colors hover:bg-black/[0.015]" style={{ borderBottom: ri < PIPE.length - 1 ? `1px solid ${C.border}` : "none", backgroundColor: ri % 2 ? "color-mix(in srgb, var(--c-surface) 40%, transparent)" : "transparent" }}>
                      <td className="px-4 py-2.5 text-xs font-medium" style={{ color: C.textBody }}>{r.label}</td>
                      {shown.map(c => (
                        <td key={c.bioId} className="px-4 py-2.5 text-right text-base font-bold tabular-nums" style={{ color: r.win && num(c, r.k) > 0 ? C.green : C.textPrimary }}>{fmt(num(c, r.k))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ─── Per-company: leads/flows + channel mix ───────────── */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(shown.length, 3)}, minmax(0,1fr))` }}>
            {shown.map(c => {
              const maxCh = Math.max(1, ...c.byChannel.map(x => x.messages));
              return (
                <div key={c.bioId} className="relative rounded-2xl border overflow-hidden p-4" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: CARD_SH }}>
                  <div aria-hidden className="absolute -top-10 -right-10 w-24 h-24 rounded-full opacity-60 pointer-events-none" style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 14%, transparent) 0%, transparent 70%)` }} />
                  <div className="relative flex items-center gap-2.5 mb-3">
                    <Avatar name={c.name} size={30} />
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>{c.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: C.surface, color: C.textBody }}>{fmt(c.totalLeads)} {L.leads.toLowerCase()}</span>
                        <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${gold} 13%, transparent)`, color: C.textBody }}>{c.activeFlows} {L.flows}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>{L.channelMix}</p>
                  {c.byChannel.length === 0 ? (
                    <p className="text-xs" style={{ color: C.textDim }}>{L.noSends}</p>
                  ) : (
                    <div className="space-y-2">
                      {c.byChannel.map(ch => (
                        <div key={ch.channel}>
                          <div className="flex items-center justify-between text-xs mb-0.5">
                            <span className="font-medium" style={{ color: C.textBody }}>{channelLabel(ch.channel)}</span>
                            <span className="tabular-nums text-[11px]" style={{ color: C.textMuted }}><b style={{ color: C.textPrimary }}>{ch.messages}</b> {L.msgs} · {ch.leads} {L.leadsLow}</span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: C.surface }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.round((ch.messages / maxCh) * 100)}%`, backgroundColor: channelColor(ch.channel) }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
