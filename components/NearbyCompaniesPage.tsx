"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, X, Phone, Globe, MapPin, ExternalLink, Star, Loader2, Zap, UserPlus, CheckCircle2, Building2 } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

type NearbyCompany = { name: string; address: string | null; phone: string | null; web: string | null };
type Review = { author: string | null; rating: number | null; text: string; when: string | null };
type RichDetail = {
  name: string; address: string | null; phone: string | null; web: string | null;
  rating: number | null; ratingsTotal: number | null; types: string[];
  photoUrl: string | null; photoUrls?: string[]; reviews?: Review[];
  mapsUrl: string | null; description?: string | null; lat?: number | null; lng?: number | null;
};

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const SKIP = new Set(["establishment", "point_of_interest", "premise", "geocode", "food"]);
const industryOf = (t?: string[]) => { const x = (t || []).find(v => !SKIP.has(v)); return x ? x.replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase()) : null; };
// Rough annual demand by category (MWh/yr) — demo estimate.
function demandMwh(industry: string | null) {
  const i = (industry || "").toLowerCase();
  if (/lodging|hotel|resort/.test(i)) return 340;
  if (/restaurant|bar|cafe|food/.test(i)) return 120;
  if (/store|retail|shopping|supermarket/.test(i)) return 210;
  if (/spa|gym|health|hospital|clinic/.test(i)) return 260;
  return 160;
}

export default function NearbyCompaniesPage({
  leadId, company, plantLat, plantLng, potenzaKw, initial,
}: {
  leadId: string; company: string;
  plantLat: number | null; plantLng: number | null; potenzaKw: number | null;
  initial: NearbyCompany[];
}) {
  const { locale } = useLocale();
  const L = (en: string, es: string) => (locale === "es" ? es : en);
  const list = initial ?? [];
  const [selected, setSelected] = useState<NearbyCompany | null>(null);
  const [detail, setDetail] = useState<RichDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [createState, setCreateState] = useState<"idle" | "creating" | "created" | "error">("idle");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const teal = "#1A7F74", amber = "#D97706";

  async function open(c: NearbyCompany) {
    setSelected(c); setDetail(null); setLoading(true); setCreateState("idle"); setCreatedId(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/place-detail`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: c.name, address: c.address }) });
      const d = await r.json();
      setDetail(r.ok ? d : { name: c.name, address: c.address, phone: c.phone, web: c.web, rating: null, ratingsTotal: null, types: [], photoUrl: null, mapsUrl: null });
    } catch { setDetail({ name: c.name, address: c.address, phone: c.phone, web: c.web, rating: null, ratingsTotal: null, types: [], photoUrl: null, mapsUrl: null }); }
    finally { setLoading(false); }
  }
  async function createLead() {
    if (!selected || createState === "creating") return;
    setCreateState("creating");
    try {
      const r = await fetch(`/api/leads/${leadId}/nearby-companies/create-lead`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: detail?.name ?? selected.name, address: detail?.address ?? selected.address, phone: detail?.phone ?? selected.phone, web: detail?.web ?? selected.web, industry: industryOf(detail?.types), fromCompany: company }) });
      const d = await r.json();
      if (r.ok && d.leadId) { setCreatedId(d.leadId); setCreateState("created"); } else setCreateState("error");
    } catch { setCreateState("error"); }
  }

  const webHref = (w: string) => (w.startsWith("http") ? w : `https://${w}`);
  const industry = industryOf(detail?.types);
  const addr = detail?.address ?? selected?.address ?? null;
  const phone = detail?.phone ?? selected?.phone ?? null;
  const web = detail?.web ?? selected?.web ?? null;
  const distKm = plantLat != null && plantLng != null && detail?.lat != null && detail?.lng != null ? haversineKm(plantLat, plantLng, detail.lat, detail.lng) : null;
  const demand = demandMwh(industry);
  const anchor = company.replace(/\s+(s\.?r\.?l\.?|srl|s\.?p\.?a\.?|spa)\.?$/i, "").trim();

  return (
    <div className="p-6 w-full fade-in" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Link href={`/leads/${leadId}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold mb-5" style={{ color: C.textMuted }}>
        <ArrowLeft size={15} /> {L("Back to lead", "Volver al lead")}
      </Link>

      <div className="rounded-2xl border p-6 mb-6" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${teal} 12%, ${C.card}), ${C.card})`, borderColor: C.border }}>
        <p className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: teal }}>{L("Opportunity 2 · Producer ↔ Consumer match", "Oportunidad 2 · Match productor ↔ consumidor")}</p>
        <h1 className="text-[26px] font-bold tracking-tight" style={{ color: C.textPrimary }}>{L("Energy consumers around", "Consumidores de energía cerca de")} {anchor}</h1>
        <p className="text-[14px] mt-2 leading-relaxed" style={{ color: C.textMuted, maxWidth: "78ch" }}>
          {L(
            `Businesses within reach of the ${potenzaKw ? `${Math.round(potenzaKw)} kW ` : ""}array — potential off-takers for surplus generation, or anchor members for a renewable energy community (CER). ${list.length} found nearby.`,
            `Negocios al alcance del parque ${potenzaKw ? `de ${Math.round(potenzaKw)} kW ` : ""}— posibles consumidores del excedente, o miembros de una comunidad energética (CER). ${list.length} cerca.`
          )}
        </p>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {list.map((c, i) => (
          <button key={i} onClick={() => open(c)} className="text-left rounded-xl border p-4 flex items-start gap-3 transition-all hover:shadow-md hover:-translate-y-px"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <span className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${teal} 12%, transparent)`, color: teal }}>
              {c.name?.[0]?.toUpperCase() ?? "?"}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold truncate" style={{ color: C.textPrimary }}>{c.name}</span>
              {c.address && <span className="block text-[12px] truncate mt-0.5" style={{ color: C.textMuted }}>{c.address}</span>}
              <span className="flex items-center gap-2 mt-2">
                {c.phone && <Phone size={12} style={{ color: C.phone }} />}
                {c.web && <Globe size={12} style={{ color: C.blue }} />}
                <span className="text-[11px] font-semibold" style={{ color: teal }}>{L("View match →", "Ver match →")}</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }} onClick={() => setSelected(null)}>
          <div className="w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden max-h-[92vh] flex flex-col" style={{ backgroundColor: C.card, borderColor: C.border }} onClick={e => e.stopPropagation()}>
            <div className="relative h-44 flex items-center justify-center shrink-0" style={{ backgroundColor: C.bg }}>
              {loading ? (
                <div className="flex flex-col items-center gap-2" style={{ color: C.textMuted }}><Loader2 size={22} className="animate-spin" /><span className="text-[11px]">{L("Fetching details…", "Trayendo datos…")}</span></div>
              ) : detail?.photoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={detail.photoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold" style={{ background: `linear-gradient(135deg, ${teal}, #145F56)`, color: "#fff" }}>{(detail?.name ?? selected.name)?.[0]?.toUpperCase() ?? "?"}</span>
              )}
              <button onClick={() => setSelected(null)} className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)", color: "#fff" }}><X size={16} /></button>
            </div>
            <div className="p-5 overflow-y-auto">
              <p className="text-[18px] font-bold leading-tight" style={{ color: C.textPrimary }}>{detail?.name ?? selected.name}</p>
              <div className="flex items-center flex-wrap gap-2 mt-2">
                {industry && <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${teal} 12%, transparent)`, color: teal }}>{industry}</span>}
                {detail?.rating != null && <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)", color: "#B45309" }}><Star size={11} fill="#B45309" stroke="#B45309" /> {detail.rating}{detail.ratingsTotal != null && <span className="font-medium" style={{ color: C.textMuted }}>({detail.ratingsTotal})</span>}</span>}
              </div>

              {/* Producer ↔ Consumer match */}
              <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: `color-mix(in srgb, ${teal} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${teal} 26%, transparent)` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5" style={{ color: teal }}><Zap size={12} /> {L("Producer ↔ consumer match", "Match productor ↔ consumidor")}</p>
                <div className="grid grid-cols-3 gap-3">
                  <div><p className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>{L("Distance to plant", "Distancia a la planta")}</p><p className="text-[15px] font-bold" style={{ color: C.textPrimary }}>{distKm != null ? `${distKm.toFixed(1)} km` : "—"}</p></div>
                  <div><p className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>{L("Est. demand", "Consumo est.")}</p><p className="text-[15px] font-bold" style={{ color: C.textPrimary }}>~{demand} MWh/{L("yr", "año")}</p></div>
                  <div><p className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>{L("Array", "Parque")}</p><p className="text-[15px] font-bold" style={{ color: C.textPrimary }}>{potenzaKw ? `${Math.round(potenzaKw)} kW` : "—"}</p></div>
                </div>
                <p className="text-[12.5px] leading-relaxed mt-3" style={{ color: C.textBody }}>
                  {L(
                    `${industry || "This business"} with steady daytime load, ${distKm != null ? `~${distKm.toFixed(1)} km from` : "near"} ${anchor}'s array — a strong off-taker for surplus generation, or an anchor member for a local renewable energy community (CER).`,
                    `${industry || "Este negocio"} con consumo diurno sostenido, ${distKm != null ? `a ~${distKm.toFixed(1)} km de` : "cerca de"} el parque de ${anchor} — fuerte consumidor del excedente, o miembro ancla de una comunidad energética (CER) local.`
                  )}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 mt-3">
                {addr && <div className="p-2.5 rounded-lg col-span-2" style={{ backgroundColor: C.bg }}><p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{L("Address", "Dirección")}</p><p className="text-[13px] font-medium inline-flex items-start gap-1.5" style={{ color: C.textBody }}><MapPin size={13} style={{ color: teal, marginTop: 1 }} /> {addr}</p></div>}
                {phone && <a href={`tel:${phone.replace(/\s/g, "")}`} className="p-2.5 rounded-lg" style={{ backgroundColor: C.bg }}><p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{L("Phone", "Teléfono")}</p><p className="text-[13px] font-semibold inline-flex items-center gap-1.5" style={{ color: C.textBody }}><Phone size={12} style={{ color: C.phone }} /> {phone}</p></a>}
                {web && <a href={webHref(web)} target="_blank" rel="noopener" className="p-2.5 rounded-lg min-w-0" style={{ backgroundColor: C.bg }}><p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{L("Website", "Sitio web")}</p><p className="text-[13px] font-semibold inline-flex items-center gap-1.5 truncate" style={{ color: C.blue }}><Globe size={12} /> <span className="truncate">{web.replace(/^https?:\/\/(www\.)?/, "")}</span></p></a>}
              </div>

              {(detail?.reviews?.length ?? 0) > 0 && (
                <div className="mt-3">
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>{L("Recent reviews", "Reseñas recientes")}</p>
                  <div className="space-y-2">
                    {detail!.reviews!.slice(0, 2).map((rv, i) => (
                      <div key={i} className="rounded-lg p-2.5" style={{ backgroundColor: C.bg }}>
                        <div className="flex items-center gap-1.5 mb-0.5"><span className="text-[11px] font-semibold" style={{ color: C.textBody }}>{rv.author ?? "—"}</span>{rv.rating != null && <span className="text-[10px] font-bold" style={{ color: "#B45309" }}>{rv.rating}★</span>}{rv.when && <span className="text-[10px]" style={{ color: C.textDim }}>· {rv.when}</span>}</div>
                        <p className="text-[12px] leading-snug" style={{ color: C.textMuted }}>{rv.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-4">
                {createState === "created" ? (
                  <a href={`/leads/${createdId}`} className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg text-[13px] font-semibold" style={{ backgroundColor: C.greenLight, color: C.green, border: `1px solid color-mix(in srgb, ${C.green} 32%, transparent)` }}><CheckCircle2 size={14} /> {L("Lead created · view", "Lead creado · ver")}</a>
                ) : (
                  <button onClick={createLead} disabled={createState === "creating"} className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--brand, #c9a83a), #A8862E)", color: "#fff" }}>
                    {createState === "creating" ? <><Loader2 size={14} className="animate-spin" /> {L("Creating…", "Creando…")}</> : <><UserPlus size={14} /> {L("Create as lead", "Crear como lead")}</>}
                  </button>
                )}
                <a href={detail?.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((detail?.name ?? selected.name))}`} target="_blank" rel="noopener" className="flex items-center justify-center gap-2 px-4 p-2.5 rounded-lg text-[13px] font-semibold" style={{ background: `linear-gradient(135deg, ${teal}, #145F56)`, color: "#fff" }}><MapPin size={14} /> Maps</a>
              </div>
              {createState === "error" && <p className="text-[11px] mt-1.5" style={{ color: C.red }}>{L("Couldn't create the lead", "No se pudo crear el lead")}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
