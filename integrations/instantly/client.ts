// Cliente HTTP de Instantly (API v2).
//
// Extraido en la Fase 3B. Seis archivos declaraban su propio
// `const INSTANTLY_BASE = "https://api.instantly.ai/api/v2"` y armaban el mismo
// header Bearer a mano.
//
// Lo que vive aca es COMO se le habla a Instantly: base URL v2, Bearer con la
// api key del tenant y el accept. QUE se pide se queda en la route, y la api
// key sigue viniendo de getInstantlyConfig(companyBioId) — este modulo NO
// resuelve tenants ni elige workspace: recibe la key ya resuelta.
//
// Devuelve el Response crudo: varios call sites leen res.status para decidir
// (404 de /emails/send fue un incidente real), y normalizar eso cambiaria
// comportamiento.

export const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

/** Llamada cruda. `path` arranca con "/" y va despues de /api/v2. */
export function instantlyFetch(apiKey: string, path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(`${INSTANTLY_BASE}${path}`, { ...init, headers });
}

/** GET con JSON ya parseado. Devuelve null si la respuesta no es 2xx. */
// El shape lo define el endpoint de Instantly que pide el call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function instantlyGet<T = any>(apiKey: string, path: string, init?: RequestInit): Promise<T | null> {
  const res = await instantlyFetch(apiKey, path, init);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export const listAccounts = (apiKey: string, limit = 100, init?: RequestInit) =>
  instantlyFetch(apiKey, `/accounts?limit=${limit}`, init);
