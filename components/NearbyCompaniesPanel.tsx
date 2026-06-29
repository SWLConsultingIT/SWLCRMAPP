"use client";

import { useState } from "react";
import { ChevronDown, RefreshCw, X, Phone, Globe, MapPin, ExternalLink, Star, Loader2, Sparkles } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

export type NearbyCompany = { name: string; address: string | null; phone: string | null; web: string | null };

type RichDetail = {
  name: string; address: string | null; phone: string | null; web: string | null;
  rating: number | null; ratingsTotal: number | null; types: string[];
  photoUrl: string | null; mapsUrl: string | null; businessStatus: string | null;
};

// Cross-sell panel (Gruppo Everest demo): a prominent button → expandable list
// of nearby businesses → click a company → it scrapes Google Places live and
// opens a rich card (photo, name, rating, category, address, phone, web).
export default function NearbyCompaniesPanel({
  leadId,
  initial,
}: {
  leadId: string;
  initial: NearbyCompany[];
}) {
  const { locale } = useLocale();
  const L = (en: string, es: string) => (locale === "es" ? es : en);
  const [list, setList] = useState<NearbyCompany[]>(initial ?? []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<NearbyCompany | null>(null);
  const [detail, setDetail] = useState<RichDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  async function openDetail(c: NearbyCompany) {
    setSelected(c); setDetail(null); setDetailLoading(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/place-detail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: c.name, address: c.address }),
      });
      const d = await r.json();
      if (r.ok) setDetail(d);
      else setDetail({ name: c.name, address: c.address, phone: c.phone, web: c.web, rating: null, ratingsTotal: null, types: [], photoUrl: null, mapsUrl: null, businessStatus: null });
    } catch {
      setDetail({ name: c.name, address: c.address, phone: c.phone, web: c.web, rating: null, ratingsTotal: null, types: [], photoUrl: null, mapsUrl: null, businessStatus: null });
    } finally { setDetailLoading(false); }
  }

  const webHref = (w: string) => (w.startsWith("http") ? w : `https://${w}`);
  const prettyType = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
  const teal = "#1A7F74";
  const ai = "#7C3AED";

  return (
    <div className="mt-5">
      {/* Prominent AI CTA */}
      <button
        onClick={() => (list.length ? setOpen(o => !o) : scrape())}
        disabled={loading}
        className="group w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-white font-semibold transition-all hover:shadow-lg hover:-translate-y-px disabled:opacity-70"
        style={{ background: `linear-gradient(135deg, ${ai}, #5B21B6)`, boxShadow: `0 6px 20px color-mix(in srgb, ${ai} 40%, transparent)` }}
      >
        <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.18)" }}>
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
        </span>
        <span className="flex-1 text-left leading-tight">
          <span className="flex items-center gap-1.5 text-[14px]">
            {L("Find nearby companies", "Buscar empresas cercanas")}
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.22)" }}>AI</span>
          </span>
          <span className="block text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.82)" }}>
            {loading
              ? L("Scanning the area with AI…", "Escaneando el área con IA…")
              : list.length
                ? L(`${list.length} businesses around the plant · tap to view`, `${list.length} negocios cerca de la planta · tocá para ver`)
                : L("Scan the plant's surroundings for cross-sell", "Escanear los alrededores de la planta para cross-sell")}
          </span>
        </span>
        {list.length > 0 && <ChevronDown size={16} className="shrink-0" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />}
      </button>

      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={scrape}
          disabled={loading}
          title={L("Re-scan with Google Places", "Re-escanear con Google Places")}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
          style={{ backgroundColor: C.bg, color: C.textMuted, borderColor: C.border }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          {loading ? L("Scanning…", "Escaneando…") : L("Refresh list", "Actualizar lista")}
        </button>
        {err && <span className="text-[11px]" style={{ color: C.red }}>{err}</span>}
      </div>

      {/* Dropdown list */}
      {open && list.length > 0 && (
        <div className="mt-3 rounded-xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <div className="max-h-[340px] overflow-y-auto divide-y" style={{ borderColor: C.border }}>
            {list.map((c, i) => (
              <button
                key={i}
                onClick={() => openDetail(c)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-black/[0.03] transition-colors"
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: `color-mix(in srgb, ${teal} 12%, transparent)`, color: teal }}>
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

      {/* Rich detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }} onClick={() => setSelected(null)}>
          <div className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }} onClick={e => e.stopPropagation()}>
            {/* Cover photo / loading */}
            <div className="relative h-44 flex items-center justify-center" style={{ backgroundColor: C.bg }}>
              {detailLoading ? (
                <div className="flex flex-col items-center gap-2" style={{ color: C.textMuted }}>
                  <Loader2 size={22} className="animate-spin" />
                  <span className="text-[11px] font-medium">{L("Fetching from Google…", "Trayendo datos de Google…")}</span>
                </div>
              ) : detail?.photoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={detail.photoUrl} alt={detail.name} className="w-full h-full object-cover" />
              ) : (
                <span className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold"
                  style={{ background: `linear-gradient(135deg, ${teal}, #145F56)`, color: "#fff" }}>
                  {(detail?.name ?? selected.name)?.[0]?.toUpperCase() ?? "?"}
                </span>
              )}
              <button onClick={() => setSelected(null)} className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)", color: "#fff" }}><X size={16} /></button>
            </div>

            <div className="p-5">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: teal }}>{L("Nearby company · cross-sell", "Empresa cercana · cross-sell")}</p>
              <p className="text-[18px] font-bold leading-tight" style={{ color: C.textPrimary }}>{detail?.name ?? selected.name}</p>

              {/* rating + category */}
              <div className="flex items-center flex-wrap gap-2 mt-2">
                {detail?.rating != null && (
                  <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)", color: "#B45309" }}>
                    <Star size={11} fill="#B45309" stroke="#B45309" /> {detail.rating}{detail.ratingsTotal != null && <span className="font-medium" style={{ color: C.textMuted }}>({detail.ratingsTotal})</span>}
                  </span>
                )}
                {(detail?.types ?? []).filter(t => !["establishment", "point_of_interest"].includes(t)).slice(0, 2).map(t => (
                  <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${teal} 12%, transparent)`, color: teal }}>{prettyType(t)}</span>
                ))}
              </div>

              <div className="space-y-2.5 mt-3">
                {(detail?.address ?? selected.address) && (
                  <a href={detail?.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((detail?.name ?? selected.name) + " " + (detail?.address ?? selected.address ?? ""))}`} target="_blank" rel="noopener" className="flex items-start gap-2.5 p-3 rounded-lg hover:underline" style={{ backgroundColor: C.bg, color: C.textBody }}>
                    <MapPin size={15} style={{ color: teal, marginTop: 1 }} />
                    <span className="text-[13px]">{detail?.address ?? selected.address}</span>
                  </a>
                )}
                {(detail?.phone ?? selected.phone) && (
                  <a href={`tel:${(detail?.phone ?? selected.phone ?? "").replace(/\s/g, "")}`} className="flex items-center gap-2.5 p-3 rounded-lg" style={{ backgroundColor: C.bg, color: C.textBody }}>
                    <Phone size={15} style={{ color: C.phone }} />
                    <span className="text-[13px] font-medium">{detail?.phone ?? selected.phone}</span>
                  </a>
                )}
                {(detail?.web ?? selected.web) && (
                  <a href={webHref(detail?.web ?? selected.web ?? "")} target="_blank" rel="noopener" className="flex items-center gap-2.5 p-3 rounded-lg hover:underline" style={{ backgroundColor: C.bg, color: C.blue }}>
                    <Globe size={15} />
                    <span className="text-[13px] font-medium truncate">{(detail?.web ?? selected.web ?? "").replace(/^https?:\/\//, "")}</span>
                    <ExternalLink size={11} className="shrink-0" />
                  </a>
                )}
              </div>

              <a href={detail?.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((detail?.name ?? selected.name))}`} target="_blank" rel="noopener"
                className="flex items-center justify-center gap-2 p-2.5 rounded-lg text-[13px] font-semibold mt-3"
                style={{ background: `linear-gradient(135deg, ${teal}, #145F56)`, color: "#fff" }}>
                <MapPin size={14} /> {L("Open in Google Maps", "Abrir en Google Maps")}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
