"use client";

// Checklist UI for "what to include in the PDF". Passes the user's choices to
// /reports/print via querystring. The print page is server-side, tenant-
// scoped, and only renders the sections the URL asks for.

import { useState, useMemo } from "react";
import { FileDown, Check, CheckSquare, Square } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

type Option = { id: string; label: string };

// The label and description are dictionary keys, resolved at render — the
// section identity (`key`) is what goes on the querystring.
type Section = { key: string; default: boolean };

const SECTIONS: Section[] = [
  { key: "headline",  default: true },
  { key: "funnel",    default: true },
  { key: "trend",     default: true },
  { key: "channels",  default: true },
  { key: "icps",      default: true },
  { key: "campaigns", default: true },
  { key: "sellers",   default: true },
  { key: "insights",  default: true },
];

const PERIODS: { id: string; days: number | null }[] = [
  { id: "7d",  days: 7 },
  { id: "30d", days: 30 },
  { id: "90d", days: 90 },
  { id: "all", days: null },
];

export default function ReportPicker({ options }: { options: { campaigns: Option[]; sellers: Option[]; icps: Option[] } }) {
  const { t } = useLocale();
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
            <p className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{t("rep.pick.sections")}</p>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{t("rep.pick.sectionsHint")}</p>
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
                    <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t(`rep.section.${s.key}`)}</p>
                    <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{t(`rep.section.${s.key}.desc`)}</p>
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
          <p className="text-sm font-bold mb-3" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{t("rep.pick.period")}</p>
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map(p => {
              const on = period === p.id;
              return (
                <button key={p.id} onClick={() => setPeriod(p.id)} type="button"
                  className="text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors"
                  style={{ backgroundColor: on ? `color-mix(in srgb, ${gold} 14%, transparent)` : C.bg, borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border, color: on ? gold : C.textBody }}>
                  {t(`rep.period.${p.id}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border p-5 space-y-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{t("rep.pick.filters")}</p>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>{t("rep.pick.campaigns")}</p>
            <MultiToggle items={options.campaigns} value={campaignFilter} onChange={setCampaignFilter} placeholder={t("rep.pick.noCampaigns")} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>{t("rep.pick.icps")}</p>
            <MultiToggle items={options.icps} value={icpFilter} onChange={setIcpFilter} placeholder={t("rep.pick.noIcps")} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>{t("rep.pick.sellers")}</p>
            <MultiToggle items={options.sellers} value={sellerFilter} onChange={setSellerFilter} placeholder={t("rep.pick.noSellers")} />
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
          <FileDown size={14} className="inline mr-2" /> {t("rep.downloadPdf")}
        </a>
        {!anyChecked && (
          <p className="text-[11px] text-center" style={{ color: C.textDim }}>{t("rep.pick.needOne")}</p>
        )}
      </div>
    </div>
  );
}
