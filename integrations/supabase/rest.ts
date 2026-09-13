// Transporte PostgREST.
//
// Extraido en la Fase 3B. Diecisiete archivos hablan con Supabase por HTTP en
// vez de por el cliente, y cada uno armaba su propia base URL y sus headers.
// Cuatro de ellos tenian el id del proyecto HARDCODEADO
// ("https://uljoengwmmwdqpcxnbjs.supabase.co") en vez de leer la env — o sea,
// apuntaban a un proyecto fijo aunque NEXT_PUBLIC_SUPABASE_URL dijera otra cosa.
//
// Esto es TRANSPORTE, no queries. Lo que vive aca es la base URL, la apikey, el
// Authorization y el Prefer. El `path` con su select/filtros/order lo sigue
// armando el call site: una funcion como getHotLeadsForSeller() NO va aca, va
// al server del feature.
//
// Devuelve el Response crudo — varios call sites miran res.ok y siguen de
// largo con un array vacio en vez de tirar.
//
// ⚠️ PostgREST corta en 1000 filas sin avisar. Para lecturas masivas usar
// integrations/supabase/bulk.ts, no esto.

export const SB_REST_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;

/** Headers de service-role. `extra` se mergea encima (Prefer, Range, etc.). */
export function restHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/** Llamada cruda a PostgREST. `path` arranca con "/" y va despues de /rest/v1. */
export function restFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SB_REST_URL}${path}`, {
    ...init,
    headers: restHeaders(init?.headers as Record<string, string> | undefined),
  });
}

/** GET con JSON parseado. Devuelve [] si la respuesta no es 2xx — el mismo
 *  fail-soft que ya tenian los call sites que leen listas. */
// El shape depende del `select` que arma el call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function restGet<T = any>(path: string, init?: RequestInit): Promise<T[]> {
  try {
    const r = await restFetch(path, { cache: "no-store", ...init });
    return r.ok ? ((await r.json()) as T[]) : [];
  } catch {
    return [];
  }
}
