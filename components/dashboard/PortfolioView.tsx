"use client";

// Portfolio tab (super-admin only): pick companies to compare and see each
// one's weekly activity with week-over-week trend + cumulative pipeline.
// Pure client-side toggle over server-preloaded data — no extra fetch.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { C, N } from "@/lib/design";
import { TrendingUp, TrendingDown, Minus, Users, Phone, MessageSquare, ThumbsUp, Download } from "lucide-react";
import type { PortfolioCompany } from "@/lib/portfolio";

const gold = "var(--brand, #c9a83a)";

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

const METRICS = [
  { key: "contacted", prevKey: "contactedPrev", label: "Contactados", Icon: Users, color: gold },
  { key: "calls", prevKey: "callsPrev", label: "Llamadas", Icon: Phone, color: "#E08A1E" },
  { key: "replies", prevKey: "repliesPrev", label: "Respuestas", Icon: MessageSquare, color: C.blue },
  { key: "positives", prevKey: "positivesPrev", label: "Positivas", Icon: ThumbsUp, color: C.green },
] as const;

export default function PortfolioView({
  companies,
  days = 7,
}: {
  companies: PortfolioCompany[];
  days?: number;
}) {
  // Default: select the companies that had any activity this week (so it's not
  // cluttered with empty demo tenants), or all if none.
  const router = useRouter();
  const params = useSearchParams();
  const active = companies.filter(c => c.contacted > 0 || c.calls > 0 || c.replies > 0);
  const [selected, setSelected] = useState<Set<string>>(
    new Set((active.length ? active : companies).map(c => c.bioId)),
  );
  function setPeriod(d: number) {
    const n = new URLSearchParams(params.toString());
    if (d === 7) n.delete("pdays"); else n.set("pdays", String(d));
    router.replace(n.toString() ? `?${n.toString()}` : "?", { scroll: false });
  }
  function exportPdf() {
    const ids = [...selected].join(",");
    window.open(`/reports/portfolio-print?pdays=${days}&companies=${ids}`, "_blank");
  }
  const PERIODS = [7, 30, 90];
  const toggle = (id: string) =>
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const shown = companies.filter(c => selected.has(c.bioId));

  const num = (c: PortfolioCompany, k: string) => (c as unknown as Record<string, number>)[k];
  const rate = (c: PortfolioCompany) => (c.contacted ? Math.round((c.replies / c.contacted) * 100) : 0);

  // Combined totals across the selected companies (for the KPI strip).
  const sum = (k: string) => shown.reduce((s, c) => s + num(c, k), 0);
  // Per-metric leader (highest value among shown) to highlight in gold.
  const leader = (k: string) => shown.reduce((best, c) => (num(c, k) > num(best, k) ? c : best), shown[0])?.bioId;

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
              <span className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: gold }}>GrowthAI · Portfolio</span>
              <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ color: "#34D399", backgroundColor: "rgba(52,211,153,.12)", border: "1px solid rgba(52,211,153,.35)" }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#34D399" }} /> En vivo
              </span>
            </div>
            <h2 className="text-[22px] font-bold mt-1" style={{ color: "#fff", letterSpacing: "-.01em" }}>Comparativo de empresas</h2>
            <p className="text-[11.5px] mt-1" style={{ color: "color-mix(in srgb, #F5F2E8 60%, transparent)" }}>
              Últimos {days} días vs. los {days} previos · datos al instante
            </p>
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
              <Download size={13} /> Descargar PDF
            </button>
          </div>
        </div>
      </div>

      {/* ─── Combined totals strip (selected companies) ───────────── */}
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
                  {sum(m.key).toLocaleString("es-AR")}
                </span>
                <Delta cur={sum(m.key)} prev={sum(m.prevKey)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Company picker */}
      <div className="rounded-xl border p-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>Empresas a comparar</p>
        <div className="flex flex-wrap gap-2">
          {companies.map(c => {
            const on = selected.has(c.bioId);
            const activ = c.contacted > 0 || c.calls > 0 || c.replies > 0;
            return (
              <button
                key={c.bioId}
                onClick={() => toggle(c.bioId)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition border"
                style={{
                  backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : C.surface,
                  borderColor: on ? gold : C.border,
                  color: on ? C.textPrimary : C.textMuted,
                }}
              >
                {c.name}
                {!activ && <span className="ml-1 text-[9px]" style={{ color: C.textDim }}>(sin actividad)</span>}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border py-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm" style={{ color: C.textMuted }}>Elegí al menos una empresa para comparar.</p>
        </div>
      ) : (
        <>
          {/* KPI comparison — one column per company, metrics as rows */}
          <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: C.border }}>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: gold }}>Actividad de la semana</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 120 + shown.length * 150 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>Métrica</th>
                    {shown.map(c => (
                      <th key={c.bioId} className="text-right px-4 py-2.5">
                        <span className="text-xs font-bold" style={{ color: C.textPrimary }}>{c.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map(m => (
                    <tr key={m.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: C.textBody }}>
                          <m.Icon size={13} style={{ color: m.color }} /> {m.label}
                        </span>
                      </td>
                      {shown.map(c => {
                        const isLeader = shown.length > 1 && num(c, m.key) > 0 && c.bioId === leader(m.key);
                        const valCol = m.key === "positives" && num(c, m.key) > 0 ? C.green : isLeader ? gold : C.textPrimary;
                        return (
                          <td key={c.bioId} className="px-4 py-2.5 text-right" style={isLeader ? { backgroundColor: `color-mix(in srgb, ${gold} 7%, transparent)` } : undefined}>
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-base font-bold tabular-nums" style={{ color: valCol }}>
                                {num(c, m.key).toLocaleString("es-AR")}
                              </span>
                              <Delta cur={num(c, m.key)} prev={num(c, m.prevKey)} />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Response rate (derived) */}
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td className="px-4 py-2.5 text-xs font-medium" style={{ color: C.textBody }}>Tasa de respuesta</td>
                    {shown.map(c => (
                      <td key={c.bioId} className="px-4 py-2.5 text-right text-base font-bold tabular-nums" style={{ color: C.textPrimary }}>
                        {rate(c)}%
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Pipeline acumulado */}
          <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: C.border }}>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: gold }}>Pipeline acumulado (histórico)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 120 + shown.length * 150 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: C.textMuted }}>Métrica</th>
                    {shown.map(c => (
                      <th key={c.bioId} className="text-right px-4 py-2.5 text-xs font-bold" style={{ color: C.textPrimary }}>{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Leads totales", k: "totalLeads" as const },
                    { label: "En flujo activo", k: "activeLeads" as const },
                    { label: "Oportunidades (positivas)", k: "opportunities" as const },
                    { label: "Wins", k: "wins" as const, win: true },
                  ].map(r => (
                    <tr key={r.k} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td className="px-4 py-2.5 text-xs font-medium" style={{ color: C.textBody }}>{r.label}</td>
                      {shown.map(c => (
                        <td key={c.bioId} className="px-4 py-2.5 text-right text-base font-bold tabular-nums" style={{ color: r.win && num(c, r.k) > 0 ? C.green : C.textPrimary }}>
                          {num(c, r.k).toLocaleString("es-AR")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-company channel mix + drilldown link */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(shown.length, 3)}, minmax(0,1fr))` }}>
            {shown.map(c => (
              <div key={c.bioId} className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{c.name}</span>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>Contacto por canal</p>
                {c.byChannel.length === 0 ? (
                  <p className="text-xs" style={{ color: C.textDim }}>Sin envíos esta semana</p>
                ) : (
                  <div className="space-y-1">
                    {c.byChannel.map(ch => (
                      <div key={ch.channel} className="flex items-center justify-between text-xs">
                        <span style={{ color: C.textBody }}>{ch.channel === "linkedin" ? "LinkedIn" : ch.channel === "email" ? "Email" : ch.channel === "call" ? "Llamada" : ch.channel}</span>
                        <span className="tabular-nums" style={{ color: C.textMuted }}>
                          <b style={{ color: C.textPrimary }}>{ch.messages}</b> msgs · {ch.leads} leads
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
