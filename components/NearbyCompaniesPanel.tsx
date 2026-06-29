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
  description?: string | null; priceLevel?: number | null; openNow?: boolean | null;
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
  // Demo: start EMPTY on purpose — the seller taps the AI button and watches it
  // scrape the area live. (initial is ignored for display; kept for API parity.)
  void initial;
  const [list, setList] = useState<NearbyCompany[]>([]);
  const [scraped, setScraped] = useState(false);
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
      if (r.ok && Array.isArray(d.companies)) { setList(d.companies); setOpen(true); setScraped(true); }
      else setErr(d.error || L("Couldn't search", "No se pudo buscar"));
    } catch { setErr(L("Network error", "Error de red")); }
    finally { setLoading(false); }
  }

  function clear() {
    setList([]); setScraped(false); setOpen(false); setErr(null);
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
  const SKIP_TYPES = new Set(["establishment", "point_of_interest", "premise", "geocode", "food"]);
  const industryOf = (types?: string[]) => {
    const t = (types || []).find(x => !SKIP_TYPES.has(x));
    return t ? prettyType(t) : null;
  };
  const addr = detail?.address ?? selected?.address ?? null;
  const phone = detail?.phone ?? selected?.phone ?? null;
  const web = detail?.web ?? selected?.web ?? null;
  const industry = industryOf(detail?.types);
  const about = detail?.description
    ?? (industry && addr ? L(`${industry} based in ${addr.split(",").slice(-3, -1).join(",").trim()}.`, `${industry} en ${addr.split(",").slice(-3, -1).join(",").trim()}.`) : null);

  return (
    <div className="mt-5">
      {/* ── Empty state: small AI scrape button ── */}
      {!scraped ? (
        <div>
          <button
            onClick={scrape}
            disabled={loading}
            className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-white font-semibold transition-all hover:shadow-lg hover:-translate-y-px disabled:opacity-70"
            style={{ background: `linear-gradient(135deg, ${ai}, #5B21B6)`, boxShadow: `0 4px 14px color-mix(in srgb, ${ai} 38%, transparent)` }}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            <span className="text-[13px]">{loading ? L("Scanning the area with AI…", "Escaneando el área con IA…") : L("Find nearby companies", "Buscar empresas cercanas")}</span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.22)" }}>AI</span>
          </button>
          {!loading && <p className="text-[11px] mt-1.5" style={{ color: C.textMuted }}>{L("Scan the plant's surroundings to surface cross-sell targets.", "Escaneá los alrededores de la planta para encontrar oportunidades de cross-sell.")}</p>}
          {err && <p className="text-[11px] mt-1" style={{ color: C.red }}>{err}</p>}
        </div>
      ) : (
        <div>
          {/* results header + actions */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: ai }}>
              <Sparkles size={14} /> {list.length} {L("nearby companies", "empresas cercanas")}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={scrape} disabled={loading} title={L("Re-scan", "Re-escanear")}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border disabled:opacity-50"
                style={{ backgroundColor: C.bg, color: C.textMuted, borderColor: C.border }}>
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> {loading ? L("Scanning…", "Escaneando…") : L("Re-scan", "Re-escanear")}
              </button>
              <button onClick={clear} title={L("Clear", "Limpiar")}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border"
                style={{ backgroundColor: C.bg, color: C.textMuted, borderColor: C.border }}>
                <X size={12} /> {L("Clear", "Limpiar")}
              </button>
            </div>
          </div>
          {err && <p className="text-[11px] mb-1" style={{ color: C.red }}>{err}</p>}
          {list.length > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
              <div className="max-h-[340px] overflow-y-auto divide-y" style={{ borderColor: C.border }}>
                {list.map((c, i) => (
                  <button key={i} onClick={() => openDetail(c)}
                    className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-black/[0.03] transition-colors">
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
        </div>
      )}

      {/* ── Rich detail card — lead-detail style ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }} onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" style={{ backgroundColor: C.card, borderColor: C.border }} onClick={e => e.stopPropagation()}>
            {/* Cover */}
            <div className="relative h-40 flex items-center justify-center shrink-0" style={{ backgroundColor: C.bg }}>
              {detailLoading ? (
                <div className="flex flex-col items-center gap-2" style={{ color: C.textMuted }}>
                  <Loader2 size={22} className="animate-spin" />
                  <span className="text-[11px] font-medium">{L("Fetching company details from Google…", "Trayendo datos de la empresa de Google…")}</span>
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

            <div className="p-5 overflow-y-auto">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: teal }}>{L("Nearby company · cross-sell", "Empresa cercana · cross-sell")}</p>
              <p className="text-[20px] font-bold leading-tight" style={{ color: C.textPrimary }}>{detail?.name ?? selected.name}</p>

              {/* badges: industry + rating + open + price */}
              <div className="flex items-center flex-wrap gap-2 mt-2">
                {industry && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${teal} 12%, transparent)`, color: teal }}>{industry}</span>
                )}
                {detail?.rating != null && (
                  <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)", color: "#B45309" }}>
                    <Star size={11} fill="#B45309" stroke="#B45309" /> {detail.rating}{detail.ratingsTotal != null && <span className="font-medium" style={{ color: C.textMuted }}>({detail.ratingsTotal})</span>}
                  </span>
                )}
                {detail?.openNow != null && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: detail.openNow ? C.greenLight : C.redLight, color: detail.openNow ? C.green : C.red }}>
                    {detail.openNow ? L("Open now", "Abierto") : L("Closed", "Cerrado")}
                  </span>
                )}
                {detail?.priceLevel != null && detail.priceLevel > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: C.bg, color: C.textMuted }}>{"€".repeat(detail.priceLevel)}</span>
                )}
              </div>

              {/* About / what they do */}
              {about && (
                <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: C.bg, borderLeft: `3px solid ${teal}` }}>
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: teal }}>{L("What they do", "A qué se dedican")}</p>
                  <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{about}</p>
                </div>
              )}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-2.5 mt-3">
                {industry && (
                  <div className="p-2.5 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{L("Industry", "Industria")}</p>
                    <p className="text-[13px] font-semibold" style={{ color: C.textBody }}>{industry}</p>
                  </div>
                )}
                {detail?.rating != null && (
                  <div className="p-2.5 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{L("Rating", "Reputación")}</p>
                    <p className="text-[13px] font-semibold" style={{ color: C.textBody }}>{detail.rating} ★ {detail.ratingsTotal != null ? `· ${detail.ratingsTotal} ${L("reviews", "reseñas")}` : ""}</p>
                  </div>
                )}
                {phone && (
                  <a href={`tel:${phone.replace(/\s/g, "")}`} className="p-2.5 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{L("Phone", "Teléfono")}</p>
                    <p className="text-[13px] font-semibold inline-flex items-center gap-1.5" style={{ color: C.textBody }}><Phone size={12} style={{ color: C.phone }} /> {phone}</p>
                  </a>
                )}
                {web && (
                  <a href={webHref(web)} target="_blank" rel="noopener" className="p-2.5 rounded-lg min-w-0" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{L("Website", "Sitio web")}</p>
                    <p className="text-[13px] font-semibold inline-flex items-center gap-1.5 truncate" style={{ color: C.blue }}><Globe size={12} /> <span className="truncate">{web.replace(/^https?:\/\/(www\.)?/, "")}</span></p>
                  </a>
                )}
                {addr && (
                  <div className="p-2.5 rounded-lg col-span-2" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{L("Address", "Dirección")}</p>
                    <p className="text-[13px] font-medium inline-flex items-start gap-1.5" style={{ color: C.textBody }}><MapPin size={13} style={{ color: teal, marginTop: 1 }} /> {addr}</p>
                  </div>
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
