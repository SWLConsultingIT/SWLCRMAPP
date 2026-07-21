"use client";

import { useState } from "react";
import { FileDown, FileSpreadsheet, X, ChevronDown, ChevronRight, Loader2, Check, Minus } from "lucide-react";
import { printPdf } from "@/lib/print-pdf";
import { C } from "@/lib/design";

const gold = "var(--brand, #C9A83A)";

type SubItem = { id: string; label: string };
type TabSection = { id: string; label: string; description: string; items: SubItem[] };

const TABS: TabSection[] = [
  {
    id: "overview",
    label: "Overview",
    description: "KPIs del pipeline + desglose por ICP",
    items: [
      { id: "kpis",  label: "Pipeline KPIs" },
      { id: "icps",  label: "Tabla de ICPs" },
    ],
  },
  {
    id: "outreach",
    label: "Outreach",
    description: "Campañas activas + canales",
    items: [
      { id: "campaigns", label: "Performance por campaña" },
      { id: "channels",  label: "Desglose por canal" },
    ],
  },
  {
    id: "channels",
    label: "Channels",
    description: "Email, LinkedIn y Calls detallado",
    items: [
      { id: "email",    label: "Email" },
      { id: "linkedin", label: "LinkedIn" },
      { id: "calls",    label: "Calls" },
    ],
  },
  {
    id: "sellers",
    label: "Sellers",
    description: "Activity, leaderboard y call outcomes",
    items: [
      { id: "activity", label: "Seller activity" },
      { id: "table",    label: "Leaderboard" },
      { id: "calls",    label: "Call outcomes" },
    ],
  },
];

function allKeys() {
  return new Set(TABS.flatMap(t => t.items.map(i => `${t.id}.${i.id}`)));
}

function Checkbox({ checked, partial = false }: { checked: boolean; partial?: boolean }) {
  return (
    <span
      className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all"
      style={{
        border: `1.5px solid ${checked || partial ? "var(--brand, #C9A83A)" : C.border}`,
        background: checked
          ? "var(--brand, #C9A83A)"
          : partial
          ? `color-mix(in srgb, var(--brand, #C9A83A) 14%, transparent)`
          : C.surface,
      }}
    >
      {checked && <Check size={9} strokeWidth={3} style={{ color: "#0B0F1A" }} />}
      {!checked && partial && <Minus size={9} strokeWidth={3} style={{ color: "var(--brand, #C9A83A)" }} />}
    </span>
  );
}

export default function DashboardExportModal({
  periodLabel,
  searchParams,
}: {
  periodLabel: string;
  searchParams: Record<string, string | undefined>;
}) {
  const [open, setOpen]         = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(TABS.map(t => t.id)));
  const [selected, setSelected] = useState<Set<string>>(allKeys());
  const [loading, setLoading]     = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [lang, setLang]           = useState<"es" | "en">("es");

  function toggleTab(tabId: string) {
    const items   = TABS.find(t => t.id === tabId)?.items ?? [];
    const allSel  = items.every(i => selected.has(`${tabId}.${i.id}`));
    const next    = new Set(selected);
    items.forEach(i => {
      const k = `${tabId}.${i.id}`;
      if (allSel) next.delete(k); else next.add(k);
    });
    setSelected(next);
  }

  function toggleItem(tabId: string, itemId: string) {
    const k    = `${tabId}.${itemId}`;
    const next = new Set(selected);
    if (next.has(k)) next.delete(k); else next.add(k);
    setSelected(next);
  }

  function toggleExpand(tabId: string) {
    const next = new Set(expanded);
    if (next.has(tabId)) next.delete(tabId); else next.add(tabId);
    setExpanded(next);
  }

  function buildQs() {
    const qs = new URLSearchParams();
    qs.set("sections", [...selected].join(","));
    if (searchParams.from)     qs.set("from",     searchParams.from);
    if (searchParams.to)       qs.set("to",        searchParams.to);
    if (searchParams.campaign) qs.set("campaign",  searchParams.campaign);
    if (searchParams.seller)   qs.set("seller",    searchParams.seller);
    if (searchParams.icp)      qs.set("icp",       searchParams.icp);
    qs.set("lang", lang);
    return qs;
  }

  function download() {
    if (selected.size === 0 || loading) return;
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    printPdf(`/dashboard/print?${buildQs().toString()}`, `GrowthAI-Report-${today}`);
    setTimeout(() => { setLoading(false); setOpen(false); }, 1500);
  }

  function downloadCsv() {
    if (selected.size === 0 || csvLoading) return;
    setCsvLoading(true);
    // Use a hidden iframe — same pattern as printPdf — so the Next.js router
    // never sees a navigation event. Content-Disposition: attachment makes the
    // browser save the file without affecting the current page.
    const ID = "growthai-xlsx-frame";
    const prev = document.getElementById(ID);
    if (prev) prev.remove();
    const iframe = document.createElement("iframe");
    iframe.id = ID;
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    iframe.src = `/api/dashboard/export-csv?${buildQs().toString()}`;
    document.body.appendChild(iframe);
    // Reset loading after a generous delay (server query + xlsx generation)
    setTimeout(() => setCsvLoading(false), 8000);
  }

  const totalItems = TABS.flatMap(t => t.items).length;

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90 whitespace-nowrap"
        style={{
          background: `linear-gradient(135deg, var(--brand, #C9A83A), color-mix(in srgb, var(--brand, #C9A83A) 78%, white))`,
          color: "#0B0F1A",
          boxShadow: `0 4px 14px color-mix(in srgb, var(--brand, #C9A83A) 28%, transparent)`,
        }}
      >
        <FileDown size={13} /> Download
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <div
            className="fixed right-0 top-0 h-full z-50 flex flex-col shadow-2xl"
            style={{ width: 340, backgroundColor: C.card, borderLeft: `1px solid ${C.border}` }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 shrink-0 border-b" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)` }}
                >
                  <FileDown size={15} style={{ color: "var(--brand, #C9A83A)" }} />
                </div>
                <div>
                  <p className="text-[13px] font-bold leading-tight" style={{ color: C.textPrimary }}>Exportar PDF</p>
                  <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>Elegí qué secciones incluir</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center hover:opacity-70 transition-opacity"
                style={{ color: C.textMuted, backgroundColor: C.surface }}
              >
                <X size={13} />
              </button>
            </div>

            {/* Period chip */}
            <div className="px-5 py-3 shrink-0 border-b" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-[0.14em] font-bold" style={{ color: C.textDim }}>Período</span>
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: C.surface, color: C.textBody, border: `1px solid ${C.border}` }}
                >
                  {periodLabel}
                </span>
              </div>
            </div>

            {/* Section list */}
            <div className="flex-1 overflow-y-auto py-1">
              {TABS.map(tab => {
                const allSel  = tab.items.every(i => selected.has(`${tab.id}.${i.id}`));
                const someSel = tab.items.some(i => selected.has(`${tab.id}.${i.id}`));
                const isExp   = expanded.has(tab.id);

                return (
                  <div key={tab.id}>
                    {/* Section header row */}
                    <div
                      className="flex items-center gap-3 px-5 py-3 cursor-pointer select-none group transition-colors hover:bg-black/[0.03]"
                      onClick={() => toggleTab(tab.id)}
                    >
                      <Checkbox checked={allSel} partial={someSel && !allSel} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-semibold leading-tight" style={{ color: C.textPrimary }}>
                          {tab.label}
                        </p>
                        <p className="text-[10.5px] leading-tight mt-0.5" style={{ color: C.textMuted }}>
                          {tab.description}
                        </p>
                      </div>
                      <button
                        className="shrink-0 p-1 rounded hover:opacity-60 transition-opacity"
                        style={{ color: C.textDim }}
                        onClick={e => { e.stopPropagation(); toggleExpand(tab.id); }}
                      >
                        {isExp ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </div>

                    {/* Sub-items */}
                    {isExp && (
                      <div className="pb-2 border-b" style={{ borderColor: C.border }}>
                        {tab.items.map(item => {
                          const k       = `${tab.id}.${item.id}`;
                          const checked = selected.has(k);
                          return (
                            <div
                              key={item.id}
                              className="flex items-center gap-3 py-2 px-5 pl-14 cursor-pointer hover:bg-black/[0.03] transition-colors"
                              onClick={() => toggleItem(tab.id, item.id)}
                            >
                              <Checkbox checked={checked} />
                              <span className="text-[11.5px]" style={{ color: C.textBody }}>
                                {item.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 shrink-0 border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              {/* Language picker */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[10px] uppercase tracking-[0.12em] font-bold" style={{ color: C.textDim }}>
                  Idioma
                </span>
                <div className="flex gap-1.5">
                  {(["es", "en"] as const).map(l => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className="px-3 py-1 rounded-md text-[10.5px] font-bold transition-all"
                      style={{
                        background: lang === l ? `color-mix(in srgb, ${gold} 14%, transparent)` : "transparent",
                        color: lang === l ? "var(--brand, #C9A83A)" : C.textMuted,
                        border: `1px solid ${lang === l ? "var(--brand, #C9A83A)" : C.border}`,
                      }}
                    >
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
                <span className="ml-auto text-[10.5px]" style={{ color: C.textMuted }}>
                  {selected.size}/{totalItems}
                </span>
                <button
                  className="text-[10.5px] font-semibold hover:opacity-70 transition-opacity"
                  style={{ color: "var(--brand, #C9A83A)" }}
                  onClick={() => setSelected(selected.size === totalItems ? new Set() : allKeys())}
                >
                  {selected.size === totalItems ? "Ninguna" : "Todas"}
                </button>
              </div>

              <button
                onClick={download}
                disabled={selected.size === 0 || loading}
                className="w-full py-2.5 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-2 transition-opacity disabled:opacity-40 hover:opacity-90"
                style={{
                  background: `linear-gradient(135deg, var(--brand, #C9A83A), color-mix(in srgb, var(--brand, #C9A83A) 78%, white))`,
                  color: "#0B0F1A",
                  boxShadow: selected.size > 0 ? `0 4px 16px color-mix(in srgb, var(--brand, #C9A83A) 28%, transparent)` : "none",
                }}
              >
                {loading
                  ? <><Loader2 size={14} className="animate-spin" /> Abriendo...</>
                  : <><FileDown size={14} /> Descargar PDF</>
                }
              </button>

              <button
                onClick={downloadCsv}
                disabled={selected.size === 0 || csvLoading}
                className="w-full mt-2 py-2.5 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-2 transition-opacity disabled:opacity-40 hover:opacity-80"
                style={{
                  background: "transparent",
                  color: "var(--brand, #C9A83A)",
                  border: `1.5px solid var(--brand, #C9A83A)`,
                }}
              >
                {csvLoading
                  ? <><Loader2 size={14} className="animate-spin" /> Exportando...</>
                  : <><FileSpreadsheet size={14} /> Descargar Excel</>
                }
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
