"use client";

// Checklist UI for "what to include in the PDF". Passes the user's choices to
// /reports/print via querystring. The print page is server-side, tenant-
// scoped, and only renders the sections the URL asks for.

import { useState, useMemo } from "react";
import { FileDown, Check, CheckSquare, Square } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type Option = { id: string; label: string };

type Section = { key: string; label: string; description: string; default: boolean };

const SECTIONS: Section[] = [
  { key: "headline", label: "Resumen general", description: "KPIs principales (leads, contactados, respuestas, positivas, reuniones, ganados)", default: true },
  { key: "funnel",   label: "Embudo de conversión", description: "Drop-off entre importados → contactados → respondieron → positivos → ganados", default: true },
  { key: "trend",    label: "Tendencia 30 días", description: "Gráfico de actividad diaria (enviados / respuestas / positivos)", default: true },
  { key: "channels", label: "Performance por canal", description: "LinkedIn, Email, Llamadas (volumen + tasa de respuesta + conversión)", default: true },
  { key: "icps",     label: "Performance por ICP", description: "Comparativo de perfiles ideales — cuál convierte mejor", default: true },
  { key: "campaigns", label: "Performance por campaña", description: "Comparativo de secuencias activas y pasadas con tasa de conversión", default: true },
  { key: "sellers",  label: "Leaderboard de sellers", description: "Quién mueve más volumen y mejor reply rate", default: true },
  { key: "insights", label: "Insights automáticos", description: "Movimientos y outliers detectados en el período (deltas, gaps)", default: true },
];

const PERIODS: { id: string; label: string; days: number | null }[] = [
  { id: "7d", label: "Últimos 7 días", days: 7 },
  { id: "30d", label: "Últimos 30 días", days: 30 },
  { id: "90d", label: "Últimos 90 días", days: 90 },
  { id: "all", label: "Todo el histórico", days: null },
];

export default function ReportPicker({ options }: { options: { campaigns: Option[]; sellers: Option[]; icps: Option[] } }) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    () => Object.fromEntries(SECTIONS.map(s => [s.key, s.default])),
  );
  const [period, setPeriod] = useState<string>("30d");
  const [campaignFilter, setCampaignFilter] = useState<string[]>([]);
  const [icpFilter, setIcpFilter] = useState<string[]>([]);
  const [sellerFilter, setSellerFilter] = useState<string[]>([]);

  const allChecked = useMemo(() => SECTIONS.every(s => selected[s.key]), [selected]);
  const anyChecked = useMemo(() => SECTIONS.some(s => selected[s.key]), [selected]);

  function toggleAll() {
    const flip = !allChecked;
    setSelected(Object.fromEntries(SECTIONS.map(s => [s.key, flip])));
  }

  function buildHref() {
    const params = new URLSearchParams();
    const sectionsCsv = SECTIONS.filter(s => selected[s.key]).map(s => s.key).join(",");
    if (sectionsCsv) params.set("sections", sectionsCsv);
    const periodMeta = PERIODS.find(p => p.id === period);
    if (periodMeta?.days !== null && periodMeta?.days !== undefined) {
      const to = new Date();
      const from = new Date(Date.now() - periodMeta.days * 86_400_000);
      params.set("from", from.toISOString().slice(0, 10));
      params.set("to", to.toISOString().slice(0, 10));
    }
    if (campaignFilter.length > 0) params.set("campaigns", campaignFilter.join("|"));
    if (icpFilter.length > 0) params.set("icps", icpFilter.join("|"));
    if (sellerFilter.length > 0) params.set("sellers", sellerFilter.join("|"));
    return `/reports/print?${params.toString()}`;
  }

  function MultiToggle({
    items,
    value,
    onChange,
    placeholder,
  }: {
    items: Option[];
    value: string[];
    onChange: (next: string[]) => void;
    placeholder: string;
  }) {
    if (items.length === 0) return (
      <p className="text-xs" style={{ color: C.textDim }}>{placeholder}</p>
    );
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map(it => {
          const on = value.includes(it.id);
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onChange(on ? value.filter(v => v !== it.id) : [...value, it.id])}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors border"
              style={{
                backgroundColor: on ? `color-mix(in srgb, ${gold} 14%, transparent)` : C.bg,
                borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border,
                color: on ? gold : C.textBody,
              }}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
      {/* Left column: sections checklist */}
      <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <div>
            <p className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Secciones a incluir</p>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Tildeá las secciones que querés en el PDF</p>
          </div>
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] font-semibold hover:underline"
            style={{ color: gold }}
          >
            {allChecked ? "Deseleccionar todo" : "Seleccionar todo"}
          </button>
        </div>
        <ul>
          {SECTIONS.map(s => {
            const on = !!selected[s.key];
            return (
              <li key={s.key} className="border-t" style={{ borderColor: C.border }}>
                <button
                  type="button"
                  onClick={() => setSelected(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                  className="w-full text-left px-5 py-3 flex items-start gap-3 hover:bg-black/[0.02] transition-colors"
                >
                  <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 border"
                    style={{ backgroundColor: on ? gold : C.bg, borderColor: on ? gold : C.border, color: on ? "#04070d" : C.textMuted }}>
                    {on ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{s.label}</p>
                    <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{s.description}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Right column: period + filters + download CTA */}
      <div className="space-y-4">
        <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm font-bold mb-3" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Período</p>
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map(p => {
              const on = period === p.id;
              return (
                <button key={p.id} onClick={() => setPeriod(p.id)} type="button"
                  className="text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors"
                  style={{ backgroundColor: on ? `color-mix(in srgb, ${gold} 14%, transparent)` : C.bg, borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border, color: on ? gold : C.textBody }}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border p-5 space-y-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Filtros (opcional)</p>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Campañas</p>
            <MultiToggle items={options.campaigns} value={campaignFilter} onChange={setCampaignFilter} placeholder="Sin campañas en este tenant." />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>ICPs</p>
            <MultiToggle items={options.icps} value={icpFilter} onChange={setIcpFilter} placeholder="Sin ICPs aprobados." />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Sellers</p>
            <MultiToggle items={options.sellers} value={sellerFilter} onChange={setSellerFilter} placeholder="Sin sellers asignados." />
          </div>
        </div>

        <a
          href={anyChecked ? buildHref() : "#"}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!anyChecked}
          onClick={(e) => { if (!anyChecked) e.preventDefault(); }}
          className="block text-center font-semibold text-sm py-3 rounded-2xl transition-opacity"
          style={{
            background: anyChecked
              ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`
              : C.surface,
            color: anyChecked ? "#04070d" : C.textDim,
            boxShadow: anyChecked ? `0 4px 16px color-mix(in srgb, ${gold} 28%, transparent)` : "none",
            cursor: anyChecked ? "pointer" : "not-allowed",
            opacity: anyChecked ? 1 : 0.6,
          }}
        >
          <FileDown size={14} className="inline mr-2" /> Descargar PDF
        </a>
        {!anyChecked && (
          <p className="text-[11px] text-center" style={{ color: C.textDim }}>Tildeá al menos una sección para habilitar la descarga.</p>
        )}
      </div>
    </div>
  );
}
