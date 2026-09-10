// Merge the REAL CACER/PNRR data (insertar.csv) into the 2 Everest demo leads:
// location, lat/long, potenza, CUP/COR, contributo, real satellite rooftop
// photo, and the nearby-companies list (cross-selling base). Decrypt → merge →
// re-encrypt. Everest-only; touches nothing else.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")
  .filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const KEY = Buffer.from(env.LEADS_ENCRYPTION_KEY, "base64");
const BIO = "4ab610c8-e852-4b37-97d7-c41ba19b0d0e";

function decrypt(b64) { const b = Buffer.from(b64, "base64"); const d = createDecipheriv("aes-256-gcm", KEY, b.subarray(1, 13)); d.setAuthTag(b.subarray(13, 29)); return JSON.parse(Buffer.concat([d.update(b.subarray(29)), d.final()]).toString()); }
function encrypt(p) { const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", KEY, iv); const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(p))), c.final()]); return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]); }
const nc = (name, address, phone, web) => ({ name, address, phone: phone === "Sin teléfono" ? null : phone, web: web === "Sin web" ? null : web });

const DATA = {
  "cacer-1": { // Officina Meccanica Rivoltana SRL
    city: "Arzago d'Adda", state: "Bergamo", address: "Strada Provinciale, Via Rivoltana, 12, 24040 Arzago d'Adda BG, Italy",
    lat: 45.476885, lng: 9.5621697, photo: "/everest-rooftops/officina-arzago.png",
    codice: "CRPR000006989", cup: "F83D26006200004", cor: "26049562", potenza_kw: 200, contributo_eur: 65240.00,
    tipologia: "Comunità energetica rinnovabile", comune: "ARZAGO D'ADDA", provincia: "BERGAMO",
    angle: "Officina Meccanica Rivoltana's industrial rooftop in Arzago d'Adda (BG) is approved for a 200 kW renewable-energy-community (CACER) install with €65,240 of PNRR subsidy already granted. As the anchor plant of the local CER, it unlocks shared-savings pooling with ~20 nearby businesses — the cross-sell hook for the whole Treviglio/Cassano cluster.",
    nearby: [
      nc("Comune di Treviglio", "24047 Treviglio BG, Italy", "Sin teléfono", "http://www.comune.treviglio.bg.it/"),
      nc("Hotel Castello Visconteo", "Piazza Generale Domenico Perrucchetti, 3a, 20062 Cassano d'Adda MI", "0363 360221", "http://www.castellovisconteo.it/"),
      nc("San Martino", "Viale Cesare Battisti, 3, 24047 Treviglio BG", "0363 49075", "http://www.sanmartinotreviglio.it/"),
      nc("Hotel Ristorante Julia", "Via Isola Ponti, 1, 20062 Cassano d'Adda MI", "0363 360360", "http://www.hoteljulia.info/"),
      nc("Park Hotel Cassano", "Via SP, 20062 Cassano d'Adda MI", "340 193 1932", "http://parkhotelcassano.com/"),
      nc("Hotel Villa Belvedere 1849", "Via Beata Vergine, 1, 24040 Misano di Gera d'Adda BG", "0363 340695", "http://www.villabelvedere1849.it/"),
      nc("Hotel Meublè Atlantic", "Via Canonica, 1, 24047 Treviglio BG", "0363 304640", "https://s-hotels.it/s-hotel-atlantic/"),
      nc("Azienda Agricola Cascina Bassanella", "Via Castolda, 88, 24047 Treviglio BG", "333 731 2713", "http://www.bassanella.it/"),
      nc("Locanda I Tarocchi Risto Alloggi & Pizza", "Via G. Verdi, 18, 26019 Vailate CR", "334 254 6522", "https://pizzeria-locanda-tarocchi.migliorhotel.top/"),
      nc("Hotel Ristorante Vergani", "Via Adda, 22, 24045 Fara Gera d'Adda BG", "378 306 1563", "http://www.botaniquehotelvergani.it/"),
      nc("BCC di Treviglio - Filiale Albignano d'Adda", "Via Nicola Calipari, 1, 20060 Albignano MI", "02 9530 9074", "Sin web"),
      nc("Motorace Srl", "Via Pietro Nenni, 27, 24047 Treviglio BG", "0363 671492", "Sin web"),
      nc("Sanitaria Lodigiana Arzago", "Via Lodi, 11, 24040 Arzago d'Adda BG", "0363 87878", "https://www.clerici.store/"),
      nc("Simec", "Via dell'Artigiano, 25, 26019 Vailate CR", "0363 84738", "Sin web"),
      nc("Parco della Preistoria - Rivolta d'Adda", "Viale Ponte Vecchio, 21, 26027 Rivolta d'Adda CR", "0363 78184", "http://www.parcodellapreistoria.it/"),
      nc("Belliotti Assicurazioni dal 1958 - Treviglio", "Via Andrea Verga, 18, 24047 Treviglio BG", "0363 48279", "https://www.belliottiassicurazioni.it/"),
      nc("Antico Benessere - Ristorante Spa Hotel", "Via Treviglio, 2058, 24045 Fara Gera d'Adda BG", "0363 391601", "https://www.anticobenessere.it/"),
      nc("C.r.b. srl", "Via Milano, 24/D, 20062 Cassano d'Adda MI", "0363 361164", "Sin web"),
      nc("Euromaster Tires Minoia", "Viale Europa Unita, 92, 24043 Caravaggio BG", "0363 50233", "https://minoiagomme.euromaster-pneumatici.it/"),
    ],
  },
  "cacer-5": { // Moreschi S.r.l.
    city: "Vilminore di Scalve", state: "Bergamo", address: "Località Ponte Formello, 13/A, 24020 Vilminore di Scalve BG, Italy",
    lat: 45.9888932, lng: 10.0988592, photo: "/everest-rooftops/moreschi-vilminore.png",
    codice: "CRPR000003595", cup: "F43D25001570004", cor: "25429400", potenza_kw: 99.73, contributo_eur: 47870.40,
    tipologia: "Comunità energetica rinnovabile", comune: "VILMINORE DI SCALVE", provincia: "BERGAMO",
    angle: "Moreschi S.r.l.'s plant in Vilminore di Scalve (BG) is approved for a ~100 kW CACER install with €47,870 of PNRR subsidy granted. Sitting at the head of the Val di Scalve / Presolana valley, it's the anchor for a CER spanning the area's hotels and alberghi — a ready cross-sell list of ~20 tourism businesses for shared renewable pooling.",
    nearby: [
      nc("Comune di Castione della Presolana", "24020 Castione della Presolana BG", "Sin teléfono", "Sin web"),
      nc("Hotel Des Alpes", "Via Donico, 10, 24020 Castione della Presolana BG", "0346 31682", "http://www.hotel-desalpes.it/"),
      nc("Hotel Prealpi", "Via Provinciale, 54, 24020 Castione della Presolana BG", "0346 31180", "https://www.hotelprealpi.it/"),
      nc("Hotel Milano Alpen Resort Meeting & SPA", "Via Silvio Pellico, 3, 24020 Castione della Presolana BG", "348 662 6501", "http://www.hotelmilano.com/"),
      nc("Hotel Spampatti", "Via Cantoniera, 89, 24020 Castione della Presolana BG", "0346 030517", "Sin web"),
      nc("Albergo Max Meublè", "Via Corna, 3, 24020 Castione della Presolana BG", "0346 31698", "http://www.albergomax.com/"),
      nc("Hotel La Rosa", "Via Cantoniera, 20, 24020 Castione della Presolana BG", "0346 31640", "http://www.hotelresidencelarosa.com/"),
      nc("Albergo Ristorante Scanapà", "Via Cantoniera, 16, 24020 Castione della Presolana BG", "371 417 7750", "http://www.hotelscanapa.it/"),
      nc("Hotel Migliorati", "Via Provinciale, 84, 24020 Castione della Presolana BG", "0346 31133", "http://www.hotelmigliorati.it/"),
      nc("Grand Hotel Presolana", "Via Santuario, 35, 24020 Castione della Presolana BG", "0346 32911", "Sin web"),
      nc("Albergo Ristorante La Pigna", "Via Salven, 9, 25042 Borno BS", "0364 311694", "http://www.albergolapigna-borno.it/"),
      nc("Hotel Ferrari", "Via Antonio Locatelli, 2, 24020 Castione della Presolana BG", "0346 31034", "http://www.hotel-ferrari.it/"),
      nc("Residence Cirese", "Via Cirese, 6, 25042 Borno BS", "347 803 9785", "http://www.cirese.it/"),
      nc("Hotel Valle D'Oro", "Via Funivia, 26, 25042 Borno BS", "0364 41236", "http://www.hotelvalledoro.com/"),
      nc("Albergo Ristorante Aurora", "Via Sant'Antonio, 19, 24020 Castione della Presolana BG", "0346 60004", "http://www.auroraalbergo.it/"),
      nc("B&B Via Fantoni 4", "Via Andrea Fantoni, 4, 24020 Castione della Presolana BG", "327 559 5909", "https://beb.it/viafantoni4"),
      nc("B&B la Dina", "Via Arciprete Figura, 8, 24020 Vilminore BG", "347 282 8079", "Sin web"),
      nc("Olimpic Hostel", "Via della Costa, 14, 24020 Schilpario BG", "348 265 0651", "https://olimpic-hostel.albergo.top/"),
      nc("Albergo Brescia", "Piazza Giustizia, 6, 24020 Vilminore BG", "0346 51019", "http://www.albergobresciavilminore.it/"),
    ],
  },
};

async function main() {
  for (const seq of Object.keys(DATA)) {
    const ID = { "cacer-1": "aa274eaf-86a7-4c54-95b0-be332345c82d", "cacer-5": "60eed7a4-4d4b-4b0d-9c3b-af88f6eb508e" }[seq]; const D = DATA[seq];
    const { data: lead } = await svc.from("leads").select("id, encrypted_payload").eq("id", ID).maybeSingle();
    if (!lead) { console.log(`! ${seq} not found`); continue; }
    const b64 = Buffer.from(lead.encrypted_payload.slice(2), "hex").toString("base64");
    const p = decrypt(b64);
    // company-level real location
    p.company_city = D.city; p.company_state = D.state; p.company_address_1 = D.address; p.company_country = "Italy";
    // enrichment merge
    p.enrichment = {
      ...p.enrichment,
      rooftop_photo_url: D.photo,
      rooftop_lat: D.lat, rooftop_lng: D.lng,
      proposed_system_kwp: Math.round(D.potenza_kw),
      cacer_codice_richiesta: D.codice, cacer_cup: D.cup, cacer_cor: D.cor,
      cacer_potenza_kw: D.potenza_kw, cacer_contributo_eur: D.contributo_eur,
      cacer_tipologia: D.tipologia, cacer_comune: D.comune, cacer_provincia: D.provincia,
      cer_eligible: true, transizione_5_0_eligible: true,
      ai_outreach_angle: D.angle,
      nearby_companies: D.nearby,
    };
    const blob = encrypt(p);
    const { error } = await svc.from("leads").update({ encrypted_payload: "\\x" + blob.toString("hex") }).eq("id", lead.id);
    if (error) { console.log(`✘ ${seq}: ${error.message}`); continue; }
    console.log(`✓ ${seq} ${p.primary_first_name} ${p.primary_last_name} (${p.company_name}) — ${D.city}, ${D.potenza_kw}kW, €${D.contributo_eur}, ${D.nearby.length} nearby, photo ${D.photo}`);
  }
}
main().catch(e => { console.error("✘", e.message); process.exit(1); });
