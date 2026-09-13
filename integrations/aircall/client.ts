// Cliente HTTP de Aircall.
//
// Extraido en la Fase 3B. Antes, 8 archivos armaban a mano el mismo header:
//
//   Buffer.from(`${AIRCALL_API_ID}:${AIRCALL_API_TOKEN}`).toString("base64")
//
// Lo que vive aca es COMO se le habla a Aircall: base URL v1, Basic auth y la
// respuesta cruda. QUE se pide y que se hace con el resultado —a que asiento
// dialar, como reconciliar una llamada, cuando archivar una grabacion— se
// queda en la route.
//
// Devuelve el Response sin tocar a proposito: varios call sites miran
// res.ok / res.status y arman su propio error. Cambiar eso seria cambiar
// comportamiento.

const API = "https://api.aircall.io/v1";

/** Basic auth de Aircall. Se calcula por llamada, no al importar el modulo:
 *  en build time las env pueden no estar y no queremos un header congelado. */
function auth(): string {
  return Buffer.from(`${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`).toString("base64");
}

/** True si hay credenciales. Varios call sites cortan antes de llamar. */
export function hasAircallCredentials(): boolean {
  return Boolean(process.env.AIRCALL_API_ID && process.env.AIRCALL_API_TOKEN);
}

/** Llamada cruda. `path` arranca con "/" y va despues de /v1. */
export function aircallFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth()}`,
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(`${API}${path}`, { ...init, headers });
}

export const listNumbers = (init?: RequestInit) => aircallFetch("/numbers", init);
export const getNumber = (id: string | number, init?: RequestInit) => aircallFetch(`/numbers/${id}`, init);
export const listUsers = (perPage = 50, init?: RequestInit) => aircallFetch(`/users?per_page=${perPage}`, init);
export const getUser = (id: string | number, init?: RequestInit) => aircallFetch(`/users/${id}`, init);
export const getCall = (id: string | number, init?: RequestInit) => aircallFetch(`/calls/${id}`, init);
export const getCallTranscription = (id: string | number, init?: RequestInit) =>
  aircallFetch(`/calls/${id}/transcription`, init);
export const listCalls = (query: string, init?: RequestInit) => aircallFetch(`/calls?${query}`, init);
/** POST /users/:id/calls — inicia un dial. Envio real. */
export const startCall = (userId: string | number, body: unknown, init?: RequestInit) =>
  aircallFetch(`/users/${userId}/calls`, {
    method: "POST",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
    body: JSON.stringify(body),
  });
