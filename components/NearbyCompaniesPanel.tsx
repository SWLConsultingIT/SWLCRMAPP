"use client";

import { useState } from "react";
import { ChevronDown, RefreshCw, X, Phone, Globe, MapPin, ExternalLink, Star, Loader2, Sparkles, UserPlus, CheckCircle2 } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

export type NearbyCompany = { name: string; address: string | null; phone: string | null; web: string | null };

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Very rough rooftop-PV fit by business category — demo estimates, not measured.
function solarFit(industry: string | null): { kwp: number; savingsEur: number } {
  const i = (industry || "").toLowerCase();
  const kwp = /lodging|hotel|resort/.test(i) ? 90
    : /restaurant|bar|cafe|food/.test(i) ? 35
    : /store|retail|shopping/.test(i) ? 55
    : /spa|gym|health/.test(i) ? 45
    : 40;
  return { kwp, savingsEur: Math.round(kwp * 260) };
}

type Review = { author: string | null; rating: number | null; text: string; when: string | null };
type RichDetail = {
  name: string; address: string | null; phone: string | null; web: string | null;
  rating: number | null; ratingsTotal: number | null; types: string[];
  photoUrl: string | null; mapsUrl: string | null; businessStatus: string | null;
  description?: string | null; priceLevel?: number | null; openNow?: boolean | null;
  lat?: number | null; lng?: number | null; photoUrls?: string[]; reviews?: Review[];
};

// Cross-sell panel (Gruppo Everest demo): a prominent button → expandable list
// of nearby businesses → click a company → it scrapes Google Places live and
// opens a rich card (photo, name, rating, category, address, phone, web).
export default function NearbyCompaniesPanel({
  leadId,
  initial,
  plantLat,
  plantLng,
  plantCompany,
}: {
  leadId: string;
  initial: NearbyCompany[];
  plantLat?: number | null;
  plantLng?: number | null;
  plantCompany?: string | null;
}) {
  const { t } = useLocale();
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
  const [createState, setCreateState] = useState<"idle" | "creating" | "created" | "error">("idle");
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function scrape() {
    if (loading) return;
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/nearby-companies`, { method: "POST" });
      const d = await r.json();
      if (r.ok && Array.isArray(d.companies)) { setList(d.companies); setOpen(true); setScraped(true); }
      else setErr(d.error || t("nearby.err.search"));
    } catch { setErr(t("nearby.err.network")); }
    finally { setLoading(false); }
  }

  function clear() {
    setList([]); setScraped(false); setOpen(false); setErr(null);
  }

  async function createLead() {
    if (!selected || createState === "creating") return;
    setCreateState("creating");
    try {
      const ind = (detail?.types || []).find(x => !["establishment", "point_of_interest", "premise", "geocode", "food"].includes(x));
      const r = await fetch(`/api/leads/${leadId}/nearby-companies/create-lead`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: detail?.name ?? selected.name,
          address: detail?.address ?? selected.address,
          phone: detail?.phone ?? selected.phone,
          web: detail?.web ?? selected.web,
          industry: ind ? prettyType(ind) : null,
          fromCompany: plantCompany ?? null,
        }),
      });
      const d = await r.json();
      if (r.ok && d.leadId) { setCreatedId(d.leadId); setCreateState("created"); }
      else setCreateState("error");
    } catch { setCreateState("error"); }
  }

  async function openDetail(c: NearbyCompany) {
    setSelected(c); setDetail(null); setDetailLoading(true); setCreateState("idle"); setCreatedId(null);
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
    ?? (industry && addr
      ? t("nearby.about", { industry, city: addr.split(",").slice(-3, -1).join(",").trim() })
      : null);
  const distanceKm = (plantLat != null && plantLng != null && detail?.lat != null && detail?.lng != null)
    ? haversineKm(plantLat, plantLng, detail.lat, detail.lng) : null;
  const fit = solarFit(industry);
  const anchorName = plantCompany ? plantCompany.replace(/\s+(s\.?r\.?l\.?|srl|s\.?p\.?a\.?|spa)\.?$/i, "").trim() : t("nearby.thePlant");
  // The proximity clause is its own key: the preposition and word order
  // around the distance differ per language, so it cannot be interpolated
  // from an English skeleton.
  const aiAngle = detail
    ? t("nearby.aiAngle", {
        prefix: industry ? industry + " " : "",
        proximity: distanceKm != null
          ? t("nearby.proximity.km", { km: distanceKm.toFixed(1), anchor: anchorName })
          : t("nearby.proximity.near", { anchor: anchorName }),
        kwp: fit.kwp,
        savings: fit.savingsEur.toLocaleString(),
      })
    : null;

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
            <span className="text-[13px]">{loading ? t("nearby.scanning") : t("nearby.find")}</span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.22)" }}>AI</span>
          </button>
          {!loading && <p className="text-[11px] mt-1.5" style={{ color: C.textMuted }}>{t("nearby.findHint")}</p>}
          {err && <p className="text-[11px] mt-1" style={{ color: C.red }}>{err}</p>}
        </div>
      ) : (
        <div>
          {/* results header + actions */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: ai }}>
              <Sparkles size={14} /> {list.length} {t("nearby.countLabel")}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={scrape} disabled={loading} title={t("nearby.rescan")}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border disabled:opacity-50"
                style={{ backgroundColor: C.bg, color: C.textMuted, borderColor: C.border }}>
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> {loading ? t("nearby.scanningShort") : t("nearby.rescan")}
              </button>
              <button onClick={clear} title={t("nearby.clear")}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border"
                style={{ backgroundColor: C.bg, color: C.textMuted, borderColor: C.border }}>
                <X size={12} /> {t("nearby.clear")}
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
                  <span className="text-[11px] font-medium">{t("nearby.fetchingDetails")}</span>
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
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: teal }}>{t("nearby.eyebrow")}</p>
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
                    {detail.openNow ? t("nearby.openNow") : t("nearby.closed")}
                  </span>
                )}
                {detail?.priceLevel != null && detail.priceLevel > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: C.bg, color: C.textMuted }}>{"€".repeat(detail.priceLevel)}</span>
                )}
              </div>

              {/* About / what they do */}
              {about && (
                <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: C.bg, borderLeft: `3px solid ${teal}` }}>
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: teal }}>{t("nearby.whatTheyDo")}</p>
                  <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{about}</p>
                </div>
              )}

              {/* AI cross-sell angle */}
              {aiAngle && (
                <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: `color-mix(in srgb, ${ai} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${ai} 28%, transparent)` }}>
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-1 inline-flex items-center gap-1" style={{ color: ai }}><Sparkles size={11} /> {t("nearby.aiAngleLabel")}</p>
                  <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{aiAngle}</p>
                </div>
              )}

              {/* Photo gallery */}
              {(detail?.photoUrls?.length ?? 0) > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {detail!.photoUrls!.slice(1, 5).map((u, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={i} src={u} alt="" className="h-16 w-24 object-cover rounded-lg shrink-0 border" style={{ borderColor: C.border }} />
                  ))}
                </div>
              )}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-2.5 mt-3">
                {industry && (
                  <div className="p-2.5 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{t("nearby.industry")}</p>
                    <p className="text-[13px] font-semibold" style={{ color: C.textBody }}>{industry}</p>
                  </div>
                )}
                {detail?.rating != null && (
                  <div className="p-2.5 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{t("nearby.rating")}</p>
                    <p className="text-[13px] font-semibold" style={{ color: C.textBody }}>{detail.rating} ★ {detail.ratingsTotal != null ? `· ${detail.ratingsTotal} ${t("nearby.reviews")}` : ""}</p>
                  </div>
                )}
                {phone && (
                  <a href={`tel:${phone.replace(/\s/g, "")}`} className="p-2.5 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{t("nearby.phone")}</p>
                    <p className="text-[13px] font-semibold inline-flex items-center gap-1.5" style={{ color: C.textBody }}><Phone size={12} style={{ color: C.phone }} /> {phone}</p>
                  </a>
                )}
                {web && (
                  <a href={webHref(web)} target="_blank" rel="noopener" className="p-2.5 rounded-lg min-w-0" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{t("nearby.website")}</p>
                    <p className="text-[13px] font-semibold inline-flex items-center gap-1.5 truncate" style={{ color: C.blue }}><Globe size={12} /> <span className="truncate">{web.replace(/^https?:\/\/(www\.)?/, "")}</span></p>
                  </a>
                )}
                {distanceKm != null && (
                  <div className="p-2.5 rounded-lg" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{t("nearby.distance")}</p>
                    <p className="text-[13px] font-semibold" style={{ color: C.textBody }}>{distanceKm.toFixed(1)} km</p>
                  </div>
                )}
                <div className="p-2.5 rounded-lg" style={{ backgroundColor: "color-mix(in srgb, #D97706 8%, transparent)" }}>
                  <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "#B45309" }}>{t("nearby.solarFit")}</p>
                  <p className="text-[13px] font-semibold" style={{ color: C.textBody }}>~{fit.kwp} kWp · ~€{fit.savingsEur.toLocaleString()}/{t("nearby.perYear")}</p>
                </div>
                {addr && (
                  <div className="p-2.5 rounded-lg col-span-2" style={{ backgroundColor: C.bg }}>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{t("nearby.address")}</p>
                    <p className="text-[13px] font-medium inline-flex items-start gap-1.5" style={{ color: C.textBody }}><MapPin size={13} style={{ color: teal, marginTop: 1 }} /> {addr}</p>
                  </div>
                )}
              </div>

              {/* Recent reviews */}
              {(detail?.reviews?.length ?? 0) > 0 && (
                <div className="mt-3">
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>{t("nearby.recentReviews")}</p>
                  <div className="space-y-2">
                    {detail!.reviews!.slice(0, 2).map((rv, i) => (
                      <div key={i} className="rounded-lg p-2.5" style={{ backgroundColor: C.bg }}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[11px] font-semibold" style={{ color: C.textBody }}>{rv.author ?? "—"}</span>
                          {rv.rating != null && <span className="text-[10px] font-bold" style={{ color: "#B45309" }}>{rv.rating}★</span>}
                          {rv.when && <span className="text-[10px]" style={{ color: C.textDim }}>· {rv.when}</span>}
                        </div>
                        <p className="text-[12px] leading-snug" style={{ color: C.textMuted }}>{rv.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions: create as lead + maps */}
              <div className="flex gap-2 mt-4">
                {createState === "created" ? (
                  <a href={`/leads/${createdId}`} className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg text-[13px] font-semibold"
                    style={{ backgroundColor: C.greenLight, color: C.green, border: `1px solid color-mix(in srgb, ${C.green} 32%, transparent)` }}>
                    <CheckCircle2 size={14} /> {t("nearby.leadCreated")}
                  </a>
                ) : (
                  <button onClick={createLead} disabled={createState === "creating"}
                    className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, var(--brand, #c9a83a), #A8862E)", color: "#fff" }}>
                    {createState === "creating"
                      ? <><Loader2 size={14} className="animate-spin" /> {t("nearby.creating")}</>
                      : <><UserPlus size={14} /> {t("nearby.createAsLead")}</>}
                  </button>
                )}
                <a href={detail?.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((detail?.name ?? selected.name))}`} target="_blank" rel="noopener"
                  title={t("nearby.openInMaps")}
                  className="flex items-center justify-center gap-2 px-4 p-2.5 rounded-lg text-[13px] font-semibold"
                  style={{ background: `linear-gradient(135deg, ${teal}, #145F56)`, color: "#fff" }}>
                  <MapPin size={14} /> Maps
                </a>
              </div>
              {createState === "error" && <p className="text-[11px] mt-1.5" style={{ color: C.red }}>{t("nearby.err.create")}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
