// Everest demo only: add dummy "Meeting Notes" to enrichment.meeting_notes on
// the two Everest leads, so the Personalized Info panel can show the discovery
// notes the boss wants in the demo. Decrypt → merge → re-encrypt.
import { readFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const svc=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const KEY=Buffer.from(env.LEADS_ENCRYPTION_KEY,"base64");
const BIO="4ab610c8-e852-4b37-97d7-c41ba19b0d0e";
const dec=b=>{const d=createDecipheriv("aes-256-gcm",KEY,b.subarray(1,13));d.setAuthTag(b.subarray(13,29));return JSON.parse(Buffer.concat([d.update(b.subarray(29)),d.final()]).toString());};
const enc=p=>{const iv=randomBytes(12);const c=createCipheriv("aes-256-gcm",KEY,iv);const ct=Buffer.concat([c.update(Buffer.from(JSON.stringify(p))),c.final()]);return Buffer.concat([Buffer.from([1]),iv,c.getAuthTag(),ct]);};

const MEETING_NOTES = {
  title: "Everest SRL — Notas de Reunión (Consolidada)",
  subtitle: "Discovery · SWL × Everest — Bernardo",
  tag: "Confidencial",
  sections: [
    { h: "Contexto general",
      p: ["Identificar oportunidades concretas donde SWL pueda ayudar a Everest a generar nuevas oportunidades comerciales con datos, automatización e IA — bajo una premisa clara: las soluciones deben apoyarse en capacidades reales del negocio, no sólo en tecnología.",
          "Bernardo remarcó que no busca una herramienta aislada, sino desarrollar capacidades internas que fortalezcan el posicionamiento de Everest a largo plazo."] },
    { h: "Desafío comercial actual",
      p: ["Everest tiene dificultades para identificar y llegar a sus clientes ideales."],
      bulletsLabel: "Factores que definen si una oportunidad tiene sentido",
      bullets: ["Tamaño de la empresa","Tamaño de la instalación fotovoltaica","Nivel de consumo energético","Tipo de industria","Identificar correctamente al decisor / receptor de la propuesta"],
      note: "Ejemplo: no es lo mismo una instalación de 200 kW que una de 3 MW — cambian el tipo de cliente, el modelo comercial y la propuesta de valor." },
    { h: "Servicios que ofrece Everest",
      bullets: ["Instalaciones fotovoltaicas","Ingeniería","Instalación y construcción","Sistemas de baterías","Infraestructura eléctrica","HVAC"],
      note: "Desafío: definir mejor la propuesta de valor de cada línea de servicio y analizar dónde la IA puede potenciar la generación de oportunidades." },
    { h: "Principio de trabajo — “Rule House”",
      p: ["Desarrollar soluciones internas que permitan a Everest construir y aprovechar capacidades propias, sin depender de terceros para operar el negocio."],
      bullets: ["Aprovechar soporte externo cuando aporte expertise real","Desarrollar herramientas propias","Construir conocimiento interno","Crear procesos y metodologías que queden dentro de la organización"],
      note: "La tecnología por sí sola deja de ser diferencial rápido. La ventaja sostenible: conocimiento del mercado, experiencia sectorial, datos propios y capacidad operativa." },
    { h: "Confidencialidad",
      bullets: ["La información de Everest no debe compartirse con VAM","No informar nada al fondo inversor","Todo análisis dentro del marco de trabajo acordado con Everest"] },
    { h: "Oportunidad 1 — Inteligencia comercial sobre plantas FV incentivadas",
      p: ["Construir una base de datos estructurada de plantas fotovoltaicas que recibieron incentivos estatales y detectar oportunidades de expansión o desarrollo.",
          "Fuente: GSE (Gestore dei Servizi Energetici) — listados de beneficiarios, información de plantas, documentación y PDFs técnicos, registros públicos. Bernardo aportará un dataset inicial (empresas con links de GSE) y ejemplos de PDFs."],
      bulletsLabel: "Datos a extraer por planta",
      bullets: ["Titular del incentivo y nombre de la empresa","Datos y ubicación de la planta (provincia · ciudad · geo)","Fecha de otorgamiento, vigencia y vencimiento del incentivo","Potencia instalada"],
      note: "Segmentar: excluir < 100 kW · Segmento 1: 100–500 kW · Segmento 2: 500 kW–1 MW. Determinar rooftop vs ground-mounted, estimar superficie de techo y potencial de expansión, e identificar la estructura de propiedad (el beneficiario del incentivo no siempre es el dueño del techo/edificio)." },
    { h: "Oportunidad 2 — Match entre productores y consumidores de energía",
      p: ["Una vez identificadas las plantas, encontrar empresas cercanas con alto consumo energético: muchas instalaciones podrían ampliarse para abastecer a consumidores vecinos.",
          "Lógica: en lugar de Productor → Red eléctrica, apuntar a Productor → empresa vecina consumidora (comunidades energéticas o acuerdos privados de suministro)."],
      bulletsLabel: "Información necesaria por planta",
      bullets: ["Empresas e industrias cercanas","Nivel estimado de consumo energético","Distancia respecto de la planta"] },
  ],
};

const { data: leads } = await svc.from("leads").select("id, encrypted_payload").eq("company_bio_id", BIO);
for (const lead of leads || []) {
  if (!lead.encrypted_payload) { console.log("! no payload", lead.id); continue; }
  const p = dec(Buffer.from(lead.encrypted_payload.slice(2), "hex"));
  p.enrichment = { ...(p.enrichment || {}), meeting_notes: MEETING_NOTES };
  await svc.from("leads").update({ encrypted_payload: "\\x" + enc(p).toString("hex") }).eq("id", lead.id);
  console.log("✓", p.company_name, "→ meeting_notes added (", MEETING_NOTES.sections.length, "sections )");
}
