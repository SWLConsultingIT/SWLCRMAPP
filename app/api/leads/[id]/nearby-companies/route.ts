import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import {
  resolveTenantKey,
  decryptWithResolvedKey,
  encryptWithResolvedKey,
  bufferFromSupabaseBytea,
} from "@/lib/leads-crypto";

// Cross-sell scraper (Gruppo Everest demo). Given a lead with rooftop_lat/lng
// in its enrichment, queries Google Places for nearby establishments (the CER
// cross-sell pool around the anchor plant), enriches each with phone + website,
// stores the list in enrichment.nearby_companies, and returns it.
//
// DEMO-SCOPED: only runs for the Gruppo Everest tenant. Any other tenant gets
// 403 — keeps the feature (and the Google Places quota) contained to the demo.
export const maxDuration = 60;

const EVEREST_BIO = "4ab610c8-e852-4b37-97d7-c41ba19b0d0e";
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyDFMsj9b2TLRBt9ISZOJ_8GtQhUNZL0Qso";

type NearbyCompany = { name: string; address: string | null; phone: string | null; web: string | null };

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const svc = getSupabaseService();

  const { data: lead, error } = await svc
    .from("leads")
    .select("id, company_bio_id, source, encrypted_payload, enrichment")
    .eq("id", id)
    .maybeSingle();
  if (error || !lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  if (lead.company_bio_id !== EVEREST_BIO) {
    return NextResponse.json({ error: "nearby-companies is demo-only (Gruppo Everest)" }, { status: 403 });
  }

  // Resolve enrichment (decrypt for client-source leads).
  let enrichment: Record<string, unknown> = (lead.enrichment as Record<string, unknown>) ?? {};
  let key: Buffer | null = null;
  if (lead.source === "client" && lead.encrypted_payload) {
    try {
      const resolved = await resolveTenantKey(lead.company_bio_id as string);
      key = resolved.key;
      const decrypted = decryptWithResolvedKey(bufferFromSupabaseBytea(lead.encrypted_payload), key);
      enrichment = (decrypted.enrichment as Record<string, unknown>) ?? {};
      // keep the rest of the payload so we can re-encrypt with the new list
      (enrichment as any).__full = decrypted;
    } catch (e) {
      return NextResponse.json({ error: "decrypt failed: " + (e as Error).message }, { status: 500 });
    }
  }

  const lat = Number((enrichment as any).rooftop_lat);
  const lng = Number((enrichment as any).rooftop_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lead has no rooftop_lat/lng to search around" }, { status: 400 });
  }

  // 1) Nearby search (legacy Places API — matches the client's Apps Script).
  const nbUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=10000&type=establishment&key=${GOOGLE_KEY}`;
  const nbRes = await fetch(nbUrl, { cache: "no-store" });
  const nbData = await nbRes.json();
  if (nbData.status !== "OK" && nbData.status !== "ZERO_RESULTS") {
    return NextResponse.json({ error: `Places nearby: ${nbData.status} ${nbData.error_message ?? ""}` }, { status: 502 });
  }
  const results: any[] = Array.isArray(nbData.results) ? nbData.results.slice(0, 20) : [];

  // 2) Details per place (name, address, phone, website).
  const companies: NearbyCompany[] = [];
  for (const place of results) {
    try {
      const dUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website&key=${GOOGLE_KEY}`;
      const dRes = await fetch(dUrl, { cache: "no-store" });
      const dData = await dRes.json();
      if (dData.status === "OK") {
        const d = dData.result;
        companies.push({
          name: d.name || place.name || "—",
          address: d.formatted_address || place.vicinity || null,
          phone: d.formatted_phone_number || null,
          web: d.website || null,
        });
      }
    } catch { /* skip one bad place */ }
  }

  if (companies.length === 0) {
    return NextResponse.json({ error: "no nearby companies found" }, { status: 404 });
  }

  // 3) Persist into enrichment.nearby_companies (re-encrypt for client leads).
  const newEnrichment = { ...enrichment };
  delete (newEnrichment as any).__full;
  (newEnrichment as any).nearby_companies = companies;
  (newEnrichment as any).nearby_scraped_at = new Date().toISOString();

  if (key && lead.source === "client") {
    const full = { ...((enrichment as any).__full as Record<string, unknown>) };
    full.enrichment = newEnrichment;
    const { ciphertext, version } = encryptWithResolvedKey(full, key);
    await svc.from("leads").update({
      encrypted_payload: "\\x" + ciphertext.toString("hex"),
      encryption_version: version,
    }).eq("id", id);
  } else {
    await svc.from("leads").update({ enrichment: newEnrichment }).eq("id", id);
  }

  return NextResponse.json({ companies, count: companies.length });
}
