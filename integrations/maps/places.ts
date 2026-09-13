// Transporte de Google Places / Maps Static.
//
// Extraido de app/api/leads/[id]/nearby-companies y .../place-detail en la
// Fase 3B. Lo que vive aca es COMO se le habla a Google: la base URL, la key,
// el query string y el parseo de `status`. QUE se busca y que se hace con el
// resultado se queda en la route.
//
// La API legacy de Places (`/maps/api/place/*/json`) se mantiene a proposito:
// es la que matchea el Apps Script del cliente. No migrar a Places API (New)
// sin verificar que devuelve los mismos campos.
//
// ⚠️ GOOGLE_MAPS_API_KEY trae un fallback hardcodeado que venia duplicado en
// los dos routes. Se centraliza aca sin cambiar el comportamiento — si la env
// no esta, la llamada sigue saliendo con la key de siempre. Es una key que
// conviene rotar y dejar solo en env.

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyDFMsj9b2TLRBt9ISZOJ_8GtQhUNZL0Qso";

const PLACES = "https://maps.googleapis.com/maps/api/place";
const MAPS = "https://maps.googleapis.com/maps/api";

/** Respuesta cruda de Places. `status` es de Google, no HTTP. */
// La respuesta de Places es un blob dinamico: los call sites leen los campos que
// pidieron en `fields`. Tiparlo aca seria adivinar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlacesResponse<T = any> = { status: string; error_message?: string } & T;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function get<T = any>(url: string): Promise<PlacesResponse<T>> {
  const res = await fetch(url, { cache: "no-store" });
  return (await res.json()) as PlacesResponse<T>;
}

/** Nearby search. `radius` en metros. */
export function nearbySearch(lat: number, lng: number, radius = 10000, type = "establishment") {
  return get(`${PLACES}/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}&key=${GOOGLE_KEY}`);
}

/** Place details. `fields` es la lista de Google, tal cual. */
export function placeDetails(placeId: string, fields: string) {
  return get(`${PLACES}/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_KEY}`);
}

/** Find place from text. */
export function findPlaceFromText(q: string, fields = "place_id") {
  return get(`${PLACES}/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=${fields}&key=${GOOGLE_KEY}`);
}

// ── URLs de imagen. No son llamadas: son URLs que la UI carga directo. ──────
export const photoUrl = (photoReference: string, maxwidth = 640) =>
  `${PLACES}/photo?maxwidth=${maxwidth}&photo_reference=${photoReference}&key=${GOOGLE_KEY}`;

export const streetViewUrl = (lat: number, lng: number, size = "640x400", fov = 82) =>
  `${MAPS}/streetview?size=${size}&location=${lat},${lng}&fov=${fov}&key=${GOOGLE_KEY}`;

export const staticMapUrl = (lat: number, lng: number, zoom = 18, size = "640x400") =>
  `${MAPS}/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&maptype=satellite&markers=color:0xC9A83A%7C${lat},${lng}&key=${GOOGLE_KEY}`;
