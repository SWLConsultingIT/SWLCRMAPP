"use client";

import { useState } from "react";
import { FileDown, X, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { printPdf } from "@/lib/print-pdf";

const gold = "#C9A83A";
const dark = "#0C0E1B";
const borderColor = "rgba(201,168,58,0.15)";

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
    description: "Leaderboard + outcomes de llamadas",
    items: [
      { id: "table", label: "Seller leaderboard" },
      { id: "calls", label: "Call outcomes" },
    ],
  },
];

function allKeys() {
  return new Set(TABS.flatMap(t => t.items.map(i => `${t.id}.${i.id}`)));
}

function Checkbox({ checked, partial = false }: { checked: boolean; partial?: boolean }) {
  return (
    <span
      className="w-4 h-4 rounded flex items-center justify-center shrink-0"
      style={{
        border: `1.5px solid ${checked || partial ? gold : "rgba(201,168,58,0.3)"}`,
        background: checked ? gold : partial ? "rgba(201,168,58,0.14)" : "transparent",
        transition: "background 0.12s",
      }}
    >
      {checked && (
        <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
          <path d="M1 3L3 5L7 1" stroke="#0B0F1A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {!checked && partial && (
        <svg width="8" height="2" viewBox="0 0 8 2" fill="none">
          <path d="M1 1H7" stroke={gold} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
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
  const [loading, setLoading]   = useState(false);

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

  function download() {
    if (selected.size === 0 || loading) return;
    setLoading(true);
    const qs = new URLSearchParams();
    qs.set("sections", [...selected].join(","));
    if (searchParams.from)     qs.set("from",     searchParams.from);
    if (searchParams.to)       qs.set("to",        searchParams.to);
    if (searchParams.campaign) qs.set("campaign",  searchParams.campaign);
    if (searchParams.seller)   qs.set("seller",    searchParams.seller);
    if (searchParams.icp)      qs.set("icp",       searchParams.icp);
    const today = new Date().toISOString().slice(0, 10);
    printPdf(`/dashboard/print?${qs.toString()}`, `GrowthAI-Report-${today}`);
    setTimeout(() => { setLoading(false); setOpen(false); }, 1500);
  }

  const totalItems = TABS.flatMap(t => t.items).length;

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90 whitespace-nowrap"
        style={{
          background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
          color: "#0B0F1A",
          boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 34%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
        }}
      >
        <FileDown size={13} /> Download
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Drawer — right side */}
          <div
            className="fixed right-0 top-0 h-full z-50 flex flex-col"
            style={{ width: 320, background: dark, borderLeft: `1px solid ${borderColor}` }}
          >
            {/* Header */}
            <div
              className="flex items-start justify-between px-5 py-4 shrink-0 border-b"
              style={{ borderColor }}
            >
              <div>
                <p className="text-[14px] font-bold" style={{ color: gold }}>Export PDF</p>
                <p className="text-[11px] mt-0.5" style={{ color: "#6A6A8A" }}>
                  Elegí qué secciones incluir
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="mt-0.5 hover:opacity-70 transition-opacity"
                style={{ color: "#6A6A8A" }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Period */}
            <div className="px-5 py-3 shrink-0 border-b" style={{ borderColor: "rgba(201,168,58,0.07)" }}>
              <p className="text-[9.5px] uppercase tracking-[0.14em] font-bold mb-1" style={{ color: "#6A6A8A" }}>
                Período
              </p>
              <p className="text-[12.5px] font-semibold" style={{ color: "#BBBDD0" }}>
                {periodLabel}
              </p>
            </div>

            {/* Section list */}
            <div className="flex-1 overflow-y-auto py-2">
              {TABS.map(tab => {
                const allSel  = tab.items.every(i => selected.has(`${tab.id}.${i.id}`));
                const someSel = tab.items.some(i => selected.has(`${tab.id}.${i.id}`));
                const isExp   = expanded.has(tab.id);

                return (
                  <div key={tab.id} className="mb-0.5">
                    {/* Tab row */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.028] select-none"
                      onClick={() => toggleTab(tab.id)}
                    >
                      <Checkbox checked={allSel} partial={someSel && !allSel} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-semibold leading-tight" style={{ color: "#FFFFFF" }}>
                          {tab.label}
                        </p>
                        <p className="text-[10.5px] leading-tight mt-0.5" style={{ color: "#6A6A8A" }}>
                          {tab.description}
                        </p>
                      </div>
                      <button
                        className="shrink-0 hover:opacity-70 transition-opacity p-0.5"
                        style={{ color: "#6A6A8A" }}
                        onClick={e => { e.stopPropagation(); toggleExpand(tab.id); }}
                      >
                        {isExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    </div>

                    {/* Sub-items */}
                    {isExp && (
                      <div className="pl-11 pr-4 pb-2">
                        {tab.items.map(item => {
                          const k       = `${tab.id}.${item.id}`;
                          const checked = selected.has(k);
                          return (
                            <div
                              key={item.id}
                              className="flex items-center gap-2.5 py-1.5 px-2 -mx-2 cursor-pointer hover:bg-white/[0.02] rounded"
                              onClick={() => toggleItem(tab.id, item.id)}
                            >
                              <Checkbox checked={checked} />
                              <span className="text-[11.5px]" style={{ color: "#BBBDD0" }}>
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
            <div
              className="px-5 py-4 shrink-0 border-t"
              style={{ borderColor }}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10.5px]" style={{ color: "#6A6A8A" }}>
                  {selected.size}/{totalItems} secciones
                </p>
                <button
                  className="text-[10.5px] font-semibold hover:opacity-70 transition-opacity"
                  style={{ color: gold }}
                  onClick={() => setSelected(selected.size === totalItems ? new Set() : allKeys())}
                >
                  {selected.size === totalItems ? "Deseleccionar todo" : "Seleccionar todo"}
                </button>
              </div>
              <button
                onClick={download}
                disabled={selected.size === 0 || loading}
                className="w-full py-2.5 rounded-lg text-[12.5px] font-bold flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
                style={{
                  background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
                  color: "#0B0F1A",
                }}
              >
                {loading
                  ? <><Loader2 size={14} className="animate-spin" /> Abriendo...</>
                  : <><FileDown size={14} /> Descargar PDF</>
                }
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
