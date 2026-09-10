// Everest demo: the two leads ARE the PV plants. Remove the misplaced
// meeting_notes (that was OUR goal, not the data) and attach structured
// "plant intelligence" = the Opportunity-1 output for each plant (dummy but
// realistic): incentive, power, install type, roof, expansion, ownership.
import { readFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const svc=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const KEY=Buffer.from(env.LEADS_ENCRYPTION_KEY,"base64");
const BIO="4ab610c8-e852-4b37-97d7-c41ba19b0d0e";
const dec=b=>{const d=createDecipheriv("aes-256-gcm",KEY,b.subarray(1,13));d.setAuthTag(b.subarray(13,29));return JSON.parse(Buffer.concat([d.update(b.subarray(29)),d.final()]).toString());};
const enc=p=>{const iv=randomBytes(12);const c=createCipheriv("aes-256-gcm",KEY,iv);const ct=Buffer.concat([c.update(Buffer.from(JSON.stringify(p))),c.final()]);return Buffer.concat([Buffer.from([1]),iv,c.getAuthTag(),ct]);};

const INTEL = {
  "Officina Meccanica Rivoltana srl": {
    incentive_holder: "Officina Meccanica Rivoltana S.r.l.",
    beneficiary: "Officina Meccanica Rivoltana S.r.l.",
    building_owner: "Immobiliare San Rocco S.r.l.",
    installation_owner: "Officina Meccanica Rivoltana S.r.l.",
    ownership_note: "Beneficiary holds a right-of-use on the roof — the building is owned by a separate property company. Any expansion needs the landlord on board.",
    province: "Bergamo", city: "Arzago d'Adda",
    installation_type: "Rooftop",
    installed_power_kw: 200,
    segment: "Segment 1 · 100–500 kW",
    incentive_granted: "Apr 2026",
    incentive_valid_until: "Apr 2046",
    cup: "F83D26006200004", cor: "26049562", contributo_eur: 65240,
    roof_area_m2: 2690, roof_available_m2: 1450, expansion_potential_kwp: 180,
  },
  "Moreschi S.r.l.": {
    incentive_holder: "Moreschi S.r.l.",
    beneficiary: "Moreschi S.r.l.",
    building_owner: "Moreschi S.r.l.",
    installation_owner: "Moreschi S.r.l.",
    ownership_note: "Single-owner site — Moreschi owns the building, the roof and the array. Cleanest possible case for an expansion or a community-energy deal.",
    province: "Bergamo", city: "Vilminore di Scalve",
    installation_type: "Rooftop",
    installed_power_kw: 100,
    segment: "Segment 1 · 100–500 kW",
    incentive_granted: "Feb 2025",
    incentive_valid_until: "Feb 2045",
    cup: "F43D25001570004", cor: "25429400", contributo_eur: 47870,
    roof_area_m2: 3020, roof_available_m2: 1900, expansion_potential_kwp: 210,
  },
};

const { data: leads } = await svc.from("leads").select("id, encrypted_payload").eq("company_bio_id", BIO);
for (const lead of leads || []) {
  if (!lead.encrypted_payload) continue;
  const p = dec(Buffer.from(lead.encrypted_payload.slice(2), "hex"));
  const intel = INTEL[p.company_name];
  if (!intel) { console.log("! no intel for", p.company_name); continue; }
  const e = { ...(p.enrichment || {}) };
  delete e.meeting_notes;              // remove the misplaced goal notes
  e.plant_intel = intel;               // attach real plant data
  p.enrichment = e;
  await svc.from("leads").update({ encrypted_payload: "\\x" + enc(p).toString("hex") }).eq("id", lead.id);
  console.log("✓", p.company_name, "→ plant_intel set, meeting_notes removed");
}
