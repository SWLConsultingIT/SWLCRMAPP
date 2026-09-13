// Transporte de webhooks de n8n.
//
// Extraido en la Fase 3B. Cinco archivos declaraban su propio
//
//   const N8N_BASE = (process.env.N8N_API_BASE_URL ?? "https://n8n.srv949269.hstgr.cloud").replace(/\/+$/, "");
//
// y armaban `${N8N_BASE}/webhook/<nombre>` a mano. Una sola definicion del host
// y del fallback, y una sola forma de armar la URL.
//
// LO QUE ESTO **NO** ES: no es una capa de generacion. La LEY del proyecto
// sigue igual — toda la generacion con IA pasa por n8n, y el prompt, el corpus,
// el payload y que hacer con la respuesta siguen viviendo en la route. Aca solo
// esta el POST.
//
// Devuelve el Response crudo: cada call site tiene su propio manejo de timeout,
// de reintentos y de error (generate-field reintenta una vez, qa tiene su
// propio timeout, recovery-copy lee el body en el error). Normalizar eso seria
// cambiar comportamiento.

export const N8N_BASE = (process.env.N8N_API_BASE_URL ?? "https://n8n.srv949269.hstgr.cloud").replace(/\/+$/, "");

/** URL de un webhook por nombre. `name` va sin barra inicial. */
export function n8nWebhookUrl(name: string): string {
  return `${N8N_BASE}/webhook/${name}`;
}

export type CallWebhookOptions = {
  /** Se serializa a JSON. Omitir para un GET. */
  payload?: unknown;
  method?: "POST" | "GET";
  /** Se mergean sobre content-type: application/json. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

/**
 * POST a un webhook de n8n. Acepta el nombre del webhook o una URL absoluta
 * (algunos call sites resuelven su URL desde su propia env var).
 */
export function callWebhook(nameOrUrl: string, opts: CallWebhookOptions = {}): Promise<Response> {
  const url = nameOrUrl.startsWith("http") ? nameOrUrl : n8nWebhookUrl(nameOrUrl);
  const method = opts.method ?? "POST";
  const init: RequestInit = { method, signal: opts.signal };
  if (method !== "GET") {
    init.headers = { "Content-Type": "application/json", ...opts.headers };
    if (opts.payload !== undefined) init.body = JSON.stringify(opts.payload);
  } else if (opts.headers) {
    init.headers = opts.headers;
  }
  return fetch(url, init);
}
