"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, X, Phone, Globe, MapPin, Star, Loader2, Zap, UserPlus, CheckCircle2, Search, ArrowUpDown, ChevronRight } from "lucide-react";
import { C, N } from "@/lib/design";
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

// Keyword classifier so the table has an industry BEFORE we fetch place details.
const NAME_RULES: [RegExp, string][] = [
  [/hotel|albergo|resort|locanda|b&b|ostello|agriturismo/i, "Lodging"],
  [/ristorante|restaurant|pizzeria|trattoria|osteria|gastronomia|tavola calda/i, "Restaurant"],
  [/\bbar\b|caff[eè]|cafe|pasticceria|gelateria|panificio|panetteria/i, "Café & bakery"],
  [/supermercato|market|conad|coop|esselunga|lidl|carrefour|alimentari|discount/i, "Supermarket"],
  [/farmacia|clinica|poliambulatorio|studio medico|dentist|ospedale|centro medico/i, "Health"],
  [/palestra|fitness|spa|wellness|piscina/i, "Fitness & wellness"],
  [/officina|meccanic|carrozzeria|autofficina|gomm|auto\b/i, "Automotive"],
  [/scuola|istituto|asilo|universit|formazione/i, "Education"],
  [/stamperia|tipografia|lavanderia|industria|manifattura|fonderia|acciaieria|capannone|logistica|magazzino|plast|metall/i, "Industrial"],
  [/negozio|boutique|store|abbigliamento|ferramenta|mobili|arredament/i, "Retail"],
  [/banca|assicurazion|consulenza|immobiliare|ufficio|notaio|commercialista/i, "Office / services"],
];
function industryFromName(name: string | null) {
  for (const [re, label] of NAME_RULES) if (re.test(name || "")) return label;
  return "Business";
}
// Rough annual demand by category (MWh/yr) — demo estimate.
function demandMwh(industry: string | null) {
  const i = (industry || "").toLowerCase();
  if (/lodging|hotel|resort/.test(i)) return 340;
  if (/supermarket|supermercato/.test(i)) return 280;
  if (/health|clinic|hospital/.test(i)) return 260;
  if (/fitness|wellness|spa/.test(i)) return 230;
  if (/industrial|manufactur/.test(i)) return 480;
  if (/retail|store|shopping/.test(i)) return 210;
  if (/automotive/.test(i)) return 180;
  if (/education|school/.test(i)) return 160;
  if (/restaurant|bar|food/.test(i)) return 120;
  if (/caf[eé]|bakery/.test(i)) return 90;
  if (/office|services/.test(i)) return 110;
  return 150;
}
function cityOf(address: string | null) {
  if (!address) return null;
  const parts = address.split(",").map(s => s.trim()).filter(Boolean).filter(p => !/^italia?$/i.test(p));
  const capPart = parts.find(p => /\b\d{5}\b/.test(p)) ?? parts[parts.length - 1] ?? null;
  if (!capPart) return null;
  return capPart.replace(/\b\d{5}\b/g, "").replace(/\b[A-Z]{2}\b\s*$/, "").trim() || null;
}
function fitOf(demand: number) {
  if (demand >= 250) return { label: "High", color: N.ink, bg: C.gold };
  if (demand >= 150) return { label: "Medium", color: C.goldDim, bg: "color-mix(in srgb, var(--brand, #c9a83a) 16%, transparent)" };
  return { label: "Low", color: C.textMuted, bg: "color-mix(in srgb, #64748B 12%, transparent)" };
}

type Row = NearbyCompany & { industry: string; city: string | null; demand: number };

export default function NearbyCompaniesPage({
  leadId, company, plantLat, plantLng, potenzaKw, initial,
}: {
  leadId: string; company: string;
  plantLat: number | null; plantLng: number | null; potenzaKw: number | null;
  initial: NearbyCompany[];
}) {
  const { locale } = useLocale();
  const L = (en: string, es: string) => (locale === "es" ? es : en);
  const gold = C.gold;

  const [query, setQuery] = useState("");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [sort, setSort] = useState<{ key: "name" | "industry" | "city" | "demand"; dir: 1 | -1 }>({ key: "demand", dir: -1 });

  const [selected, setSelected] = useState<NearbyCompany | null>(null);
  const [detail, setDetail] = useState<RichDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [createState, setCreateState] = useState<"idle" | "creating" | "created" | "error">("idle");
  const [createdId, setCreatedId] = useState<string | null>(null);

  const rows: Row[] = useMemo(() => (initial ?? []).map(c => {
    const industry = industryFromName(c.name);
    return { ...c, industry, city: cityOf(c.address), demand: demandMwh(industry) };
  }), [initial]);

  const industries = useMemo(() => Array.from(new Set(rows.map(r => r.industry))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = rows.filter(row =>
      (industryFilter === "all" || row.industry === industryFilter) &&
      (!q || [row.name, row.city, row.industry, row.address].some(v => (v || "").toLowerCase().includes(q)))
    );
    const { key, dir } = sort;
    r = [...r].sort((a, b) => {
      if (key === "demand") return (a.demand - b.demand) * dir;
      return String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * dir;
    });
    return r;
  }, [rows, query, industryFilter, sort]);

  const totalDemand = useMemo(() => filtered.reduce((s, r) => s + r.demand, 0), [filtered]);
  const toggleSort = (key: "name" | "industry" | "city" | "demand") =>
    setSort(s => s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) } : { key, dir: key === "demand" ? -1 : 1 });

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
        body: JSON.stringify({ name: detail?.name ?? selected.name, address: detail?.address ?? selected.address, phone: detail?.phone ?? selected.phone, web: detail?.web ?? selected.web, industry: industryOf(detail?.types) ?? industryFromName(selected.name), fromCompany: company }) });
      const d = await r.json();
      if (r.ok && d.leadId) { setCreatedId(d.leadId); setCreateState("created"); } else setCreateState("error");
    } catch { setCreateState("error"); }
  }

  const webHref = (w: string) => (w.startsWith("http") ? w : `https://${w}`);
  const industry = industryOf(detail?.types) ?? (selected ? industryFromName(selected.name) : null);
  const addr = detail?.address ?? selected?.address ?? null;
  const phone = detail?.phone ?? selected?.phone ?? null;
  const web = detail?.web ?? selected?.web ?? null;
  const distKm = plantLat != null && plantLng != null && detail?.lat != null && detail?.lng != null ? haversineKm(plantLat, plantLng, detail.lat, detail.lng) : null;
  const demand = demandMwh(industry);
  const anchor = company.replace(/\s+(s\.?r\.?l\.?|srl|s\.?p\.?a\.?|spa)\.?$/i, "").trim();

  const Th = ({ k, children, right }: { k: "name" | "industry" | "city" | "demand"; children: React.ReactNode; right?: boolean }) => (
    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider select-none cursor-pointer" style={{ color: C.textMuted, textAlign: right ? "right" : "left" }} onClick={() => toggleSort(k)}>
      <span className={`inline-flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
        {children}
        <ArrowUpDown size={11} style={{ opacity: sort.key === k ? 1 : 0.3, color: sort.key === k ? gold : C.textMuted }} />
      </span>
    </th>
  );

  return (
    <div className="px-6 py-6 lg:px-10 w-full fade-in">
      <Link href={`/leads/${leadId}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold mb-5" style={{ color: C.textMuted }}>
        <ArrowLeft size={15} /> {L("Back to lead", "Volver al lead")}
      </Link>

      {/* Hero — SWL navy with gold accents */}
      <div className="rounded-2xl border p-7 lg:p-8 mb-5 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${N.ink2} 0%, ${N.ink} 70%)`, borderColor: N.hairline }}>
        {/* ambient gold glow */}
        <div aria-hidden className="absolute pointer-events-none" style={{ top: -120, right: -80, width: 420, height: 420, borderRadius: "50%", background: `radial-gradient(circle, ${C.goldGlow}, transparent 70%)` }} />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="max-w-[68ch]">
            <span className="inline-flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] px-2.5 py-1 rounded-full mb-3"
              style={{ backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 18%, transparent)", color: N.goldOnDark, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 30%, transparent)` }}>
              <Zap size={12} /> {L("Opportunity 2 · Producer ↔ Consumer match", "Oportunidad 2 · Match productor ↔ consumidor")}
            </span>
            <h1 className="text-[30px] lg:text-[34px] font-bold tracking-tight leading-[1.1]" style={{ color: "#fff" }}>
              {L("Energy consumers around", "Consumidores de energía cerca de")}{" "}
              <span style={{ color: N.goldOnDark }}>{anchor}</span>
            </h1>
            <p className="text-[14px] mt-3 leading-relaxed" style={{ color: "rgba(255,255,255,0.66)" }}>
              {L(
                `Businesses within reach of the ${potenzaKw ? `${Math.round(potenzaKw)} kW ` : ""}array — potential off-takers for surplus generation, or anchor members for a renewable energy community (CER).`,
                `Negocios al alcance del parque ${potenzaKw ? `de ${Math.round(potenzaKw)} kW ` : ""}— posibles consumidores del excedente, o miembros de una comunidad energética (CER).`
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5 shrink-0">
            {[
              { v: String(rows.length), l: L("companies nearby", "empresas cerca") },
              { v: `~${totalDemand.toLocaleString("it-IT")}`, sub: `MWh/${L("yr", "año")}`, l: L("combined demand", "demanda combinada") },
              { v: potenzaKw ? `${Math.round(potenzaKw)}` : "—", sub: "kW", l: L("plant array", "parque planta") },
            ].map((s, i) => (
              <div key={i} className="rounded-xl px-4 py-3 min-w-[120px]" style={{ backgroundColor: "rgba(255,255,255,0.05)", border: `1px solid ${N.hairline}` }}>
                <p className="text-[22px] font-bold leading-none" style={{ color: "#fff", fontVariantNumeric: "tabular-nums" }}>
                  {s.v}{s.sub && <span className="text-[12px] font-semibold ml-1" style={{ color: N.goldOnDark }}>{s.sub}</span>}
                </p>
                <p className="text-[9.5px] font-semibold uppercase tracking-wider mt-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.textMuted }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={L("Search company, city, industry…", "Buscar empresa, ciudad, industria…")}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border text-[13px] outline-none" style={{ backgroundColor: C.card, borderColor: C.border, color: C.textPrimary }} />
        </div>
        <select value={industryFilter} onChange={e => setIndustryFilter(e.target.value)}
          className="py-2.5 px-3 rounded-xl border text-[13px] font-medium outline-none cursor-pointer" style={{ backgroundColor: C.card, borderColor: C.border, color: C.textPrimary }}>
          <option value="all">{L("All industries", "Todas las industrias")}</option>
          {industries.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <span className="text-[12px] font-semibold px-2" style={{ color: C.textMuted }}>{filtered.length} {L("results", "resultados")}</span>
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <div style={{ overflowX: "auto" }}>
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 860 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.bg }}>
                <Th k="name">{L("Company", "Empresa")}</Th>
                <Th k="industry">{L("Industry", "Industria")}</Th>
                <Th k="city">{L("City", "Ciudad")}</Th>
                <Th k="demand" right>{L("Est. demand", "Demanda est.")}</Th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>{L("Fit", "Encaje")}</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>{L("Contact", "Contacto")}</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const fit = fitOf(r.demand);
                return (
                  <tr key={i} onClick={() => open(r)} className="cursor-pointer transition-colors hover:bg-[var(--row-h)]"
                    style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : undefined, ["--row-h" as any]: C.bg }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>{r.name?.[0]?.toUpperCase() ?? "?"}</span>
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-semibold truncate" style={{ color: C.textPrimary, maxWidth: 300 }}>{r.name}</p>
                          {r.address && <p className="text-[11.5px] truncate" style={{ color: C.textMuted, maxWidth: 300 }}>{r.address}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${gold} 11%, transparent)`, color: gold }}>{r.industry}</span>
                    </td>
                    <td className="px-4 py-3 text-[13px]" style={{ color: C.textBody }}>{r.city ?? "—"}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-right" style={{ color: C.textPrimary, fontVariantNumeric: "tabular-nums" }}>~{r.demand} <span className="text-[11px] font-medium" style={{ color: C.textMuted }}>MWh/{L("yr", "año")}</span></td>
                    <td className="px-4 py-3 text-center"><span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ backgroundColor: fit.bg, color: fit.color }}>{fit.label}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2.5">
                        {r.phone ? <Phone size={13} style={{ color: C.phone }} /> : <span style={{ width: 13 }} />}
                        {r.web ? <Globe size={13} style={{ color: C.blue }} /> : <span style={{ width: 13 }} />}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right"><ChevronRight size={16} style={{ color: C.textMuted }} /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: C.textMuted }}>{L("No companies match your filters.", "Ninguna empresa coincide con los filtros.")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
                <span className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold" style={{ background: `linear-gradient(135deg, ${N.ink3}, ${N.ink})`, color: "#fff" }}>{(detail?.name ?? selected.name)?.[0]?.toUpperCase() ?? "?"}</span>
              )}
              <button onClick={() => setSelected(null)} className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)", color: "#fff" }}><X size={16} /></button>
            </div>
            <div className="p-5 overflow-y-auto">
              <p className="text-[18px] font-bold leading-tight" style={{ color: C.textPrimary }}>{detail?.name ?? selected.name}</p>
              <div className="flex items-center flex-wrap gap-2 mt-2">
                {industry && <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>{industry}</span>}
                {detail?.rating != null && <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)", color: "#B45309" }}><Star size={11} fill="#B45309" stroke="#B45309" /> {detail.rating}{detail.ratingsTotal != null && <span className="font-medium" style={{ color: C.textMuted }}>({detail.ratingsTotal})</span>}</span>}
              </div>

              {/* Producer ↔ Consumer match */}
              <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${gold} 26%, transparent)` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5" style={{ color: gold }}><Zap size={12} /> {L("Producer ↔ consumer match", "Match productor ↔ consumidor")}</p>
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
                {addr && <div className="p-2.5 rounded-lg col-span-2" style={{ backgroundColor: C.bg }}><p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{L("Address", "Dirección")}</p><p className="text-[13px] font-medium inline-flex items-start gap-1.5" style={{ color: C.textBody }}><MapPin size={13} style={{ color: gold, marginTop: 1 }} /> {addr}</p></div>}
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
                <a href={detail?.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((detail?.name ?? selected.name))}`} target="_blank" rel="noopener" className="flex items-center justify-center gap-2 px-4 p-2.5 rounded-lg text-[13px] font-semibold" style={{ background: `linear-gradient(135deg, ${N.ink3}, ${N.ink})`, color: "#fff" }}><MapPin size={14} /> Maps</a>
              </div>
              {createState === "error" && <p className="text-[11px] mt-1.5" style={{ color: C.red }}>{L("Couldn't create the lead", "No se pudo crear el lead")}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
