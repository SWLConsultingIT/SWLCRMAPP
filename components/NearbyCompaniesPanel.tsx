"use client";

import { useState } from "react";
import { Building2, ChevronDown, RefreshCw, X, Phone, Globe, MapPin, ExternalLink } from "lucide-react";
import { C } from "@/lib/design";

export type NearbyCompany = { name: string; address: string | null; phone: string | null; web: string | null };

// Cross-sell panel (Gruppo Everest demo). Shows the businesses around the
// anchor plant: a button → expandable list → click a company → detail modal.
// The list is seeded from enrichment.nearby_companies; "Actualizar" re-scrapes
// live via /api/leads/[id]/nearby-companies (Google Places).
export default function NearbyCompaniesPanel({
  leadId,
  initial,
}: {
  leadId: string;
  initial: NearbyCompany[];
}) {
  const [list, setList] = useState<NearbyCompany[]>(initial ?? []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<NearbyCompany | null>(null);

  async function scrape() {
    if (loading) return;
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/nearby-companies`, { method: "POST" });
      const d = await r.json();
      if (r.ok && Array.isArray(d.companies)) { setList(d.companies); setOpen(true); }
      else setErr(d.error || "No se pudo buscar");
    } catch { setErr("Error de red"); }
    finally { setLoading(false); }
  }

  const mapsLink = (c: NearbyCompany) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.name + " " + (c.address ?? ""))}`;
  const webHref = (w: string) => (w.startsWith("http") ? w : `https://${w}`);

  return (
    <div className="mt-4">
      {/* Trigger row */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => (list.length ? setOpen(o => !o) : scrape())}
          className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors"
          style={{ backgroundColor: "color-mix(in srgb, #1A7F74 10%, transparent)", color: "#1A7F74", borderColor: "color-mix(in srgb, #1A7F74 32%, transparent)" }}
        >
          <Building2 size={14} />
          Empresas cercanas para cross-sell{list.length ? ` (${list.length})` : ""}
          {list.length > 0 && <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />}
        </button>
        <button
          onClick={scrape}
          disabled={loading}
          title="Re-escanear con Google Places"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-2 rounded-lg border transition-colors disabled:opacity-50"
          style={{ backgroundColor: C.bg, color: C.textMuted, borderColor: C.border }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          {loading ? "Buscando…" : "Actualizar"}
        </button>
      </div>
      {err && <p className="text-[11px] mt-1.5" style={{ color: C.red }}>{err}</p>}

      {/* Dropdown list */}
      {open && list.length > 0 && (
        <div className="mt-2 rounded-xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <div className="max-h-[320px] overflow-y-auto divide-y" style={{ borderColor: C.border }}>
            {list.map((c, i) => (
              <button
                key={i}
                onClick={() => setSelected(c)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-black/[0.03] transition-colors"
                style={{ borderColor: C.border }}
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: "color-mix(in srgb, #1A7F74 12%, transparent)", color: "#1A7F74" }}>
                  {c.name?.[0]?.toUpperCase() ?? "?"}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold truncate" style={{ color: C.textPrimary }}>{c.name}</span>
                  {c.address && <span className="block text-[11px] truncate" style={{ color: C.textMuted }}>{c.address}</span>}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {c.phone && <Phone size={12} style={{ color: C.phone }} />}
                  {c.web && <Globe size={12} style={{ color: C.blue }} />}
                  <ChevronDown size={13} style={{ transform: "rotate(-90deg)", color: C.textDim }} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }} onClick={() => setSelected(null)}>
          <div className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }} onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 p-5 pb-4">
              <span className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
                style={{ background: "linear-gradient(135deg, #1A7F74, color-mix(in srgb, #1A7F74 70%, white))", color: "#fff" }}>
                {selected.name?.[0]?.toUpperCase() ?? "?"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#1A7F74" }}>Empresa cercana · cross-sell</p>
                <p className="text-[17px] font-bold leading-tight" style={{ color: C.textPrimary }}>{selected.name}</p>
              </div>
              <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-black/[0.06]" style={{ color: C.textMuted }}><X size={18} /></button>
            </div>
            <div className="px-5 pb-5 space-y-2.5">
              {selected.address && (
                <a href={mapsLink(selected)} target="_blank" rel="noopener" className="flex items-start gap-2.5 p-3 rounded-lg hover:underline" style={{ backgroundColor: C.bg, color: C.textBody }}>
                  <MapPin size={15} style={{ color: "#1A7F74", marginTop: 1 }} />
                  <span className="text-[13px]">{selected.address}</span>
                </a>
              )}
              {selected.phone && (
                <a href={`tel:${selected.phone.replace(/\s/g, "")}`} className="flex items-center gap-2.5 p-3 rounded-lg" style={{ backgroundColor: C.bg, color: C.textBody }}>
                  <Phone size={15} style={{ color: C.phone }} />
                  <span className="text-[13px] font-medium">{selected.phone}</span>
                </a>
              )}
              {selected.web && (
                <a href={webHref(selected.web)} target="_blank" rel="noopener" className="flex items-center gap-2.5 p-3 rounded-lg hover:underline" style={{ backgroundColor: C.bg, color: C.blue }}>
                  <Globe size={15} />
                  <span className="text-[13px] font-medium truncate">{selected.web}</span>
                  <ExternalLink size={11} className="shrink-0" />
                </a>
              )}
              <a href={mapsLink(selected)} target="_blank" rel="noopener"
                className="flex items-center justify-center gap-2 p-2.5 rounded-lg text-[13px] font-semibold mt-1"
                style={{ backgroundColor: "#1A7F74", color: "#fff" }}>
                <MapPin size={14} /> Abrir en Google Maps
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
