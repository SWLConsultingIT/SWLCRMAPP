"use client";

// Portfolio tab (super-admin only): pick companies to compare and see each
// one's weekly activity with week-over-week trend + cumulative pipeline.
// Pure client-side toggle over server-preloaded data — no extra fetch.

import { useState } from "react";
import { C } from "@/lib/design";
import { TrendingUp, TrendingDown, Minus, Users, Phone, MessageSquare, ThumbsUp } from "lucide-react";
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
  const active = companies.filter(c => c.contacted > 0 || c.calls > 0 || c.replies > 0);
  const [selected, setSelected] = useState<Set<string>>(
    new Set((active.length ? active : companies).map(c => c.bioId)),
  );
  const toggle = (id: string) =>
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const shown = companies.filter(c => selected.has(c.bioId));

  const num = (c: PortfolioCompany, k: string) => (c as unknown as Record<string, number>)[k];
  const rate = (c: PortfolioCompany) => (c.contacted ? Math.round((c.replies / c.contacted) * 100) : 0);

  return (
    <section className="space-y-5 pt-3">
      {/* Header + period note */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>Portfolio · comparativo de empresas</h2>
          <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
            Últimos {days} días vs. los {days} previos · solo super-admin
          </p>
        </div>
      </div>

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
                      {shown.map(c => (
                        <td key={c.bioId} className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-base font-bold tabular-nums" style={{ color: m.key === "positives" && num(c, m.key) > 0 ? C.green : C.textPrimary }}>
                              {num(c, m.key).toLocaleString("es-AR")}
                            </span>
                            <Delta cur={num(c, m.key)} prev={num(c, m.prevKey)} />
                          </div>
                        </td>
                      ))}
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
