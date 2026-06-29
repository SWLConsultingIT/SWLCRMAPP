import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

// Rich detail for a single nearby company (Gruppo Everest cross-sell demo).
// Resolves a place by text (name + address) → Google Place Details with photo,
// rating, category, website, phone. Used when the user clicks a company in the
// nearby list so the modal shows a full "scraped" card. Demo-scoped.
export const maxDuration = 30;

const EVEREST_BIO = "4ab610c8-e852-4b37-97d7-c41ba19b0d0e";
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyDFMsj9b2TLRBt9ISZOJ_8GtQhUNZL0Qso";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name, address, placeId } = body as { name?: string; address?: string; placeId?: string };

  const svc = getSupabaseService();
  const { data: lead } = await svc.from("leads").select("company_bio_id").eq("id", id).maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  if (lead.company_bio_id !== EVEREST_BIO) {
    return NextResponse.json({ error: "demo-only (Gruppo Everest)" }, { status: 403 });
  }

  // 1) Resolve place_id (from text if not provided).
  let resolvedId = placeId;
  if (!resolvedId) {
    const q = [name, address].filter(Boolean).join(", ");
    if (!q) return NextResponse.json({ error: "name or address required" }, { status: 400 });
    const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=place_id&key=${GOOGLE_KEY}`;
    const fRes = await fetch(findUrl, { cache: "no-store" });
    const fData = await fRes.json();
    resolvedId = fData.candidates?.[0]?.place_id;
    if (!resolvedId) {
      // No match — return whatever we were given so the modal still shows basics.
      return NextResponse.json({ name: name ?? "—", address: address ?? null, phone: null, web: null, rating: null, photoUrl: null, types: [], mapsUrl: q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null });
    }
  }

  // 2) Place details.
  const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${resolvedId}&fields=name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,photos,types,url,business_status&key=${GOOGLE_KEY}`;
  const dRes = await fetch(detUrl, { cache: "no-store" });
  const dData = await dRes.json();
  if (dData.status !== "OK") {
    return NextResponse.json({ error: `Places details: ${dData.status}` }, { status: 502 });
  }
  const d = dData.result;
  const photoRef = d.photos?.[0]?.photo_reference as string | undefined;
  const photoUrl = photoRef
    ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=640&photo_reference=${photoRef}&key=${GOOGLE_KEY}`
    : null;

  return NextResponse.json({
    name: d.name ?? name ?? "—",
    address: d.formatted_address ?? address ?? null,
    phone: d.formatted_phone_number ?? d.international_phone_number ?? null,
    web: d.website ?? null,
    rating: typeof d.rating === "number" ? d.rating : null,
    ratingsTotal: typeof d.user_ratings_total === "number" ? d.user_ratings_total : null,
    types: Array.isArray(d.types) ? d.types : [],
    photoUrl,
    mapsUrl: d.url ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(", "))}`,
    businessStatus: d.business_status ?? null,
  });
}
