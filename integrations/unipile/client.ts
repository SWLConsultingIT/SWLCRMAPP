// Transporte de Unipile.
//
// Extraido en la Fase 3C. Nueve archivos declaraban su propio
//
//   const UNIPILE_BASE = process.env.UNIPILE_DSN
//     ? `https://${process.env.UNIPILE_DSN}`
//     : "https://api21.unipile.com:15107";
//
// y su propio helper de fetch. Una sola definicion del host, del fallback y de
// la API key.
//
// TRES FORMAS, a proposito. Los call sites NO comparten semantica de error y
// unificarla cambiaria comportamiento:
//
//   unipileFetch   Response cruda, nunca tira. Para quien mira el status
//                  (dispatch-telegram, resolve-telegram-users, hosted-link).
//   unipileGet /   Parsea y TIRA con el detalle del proveedor si no es 2xx.
//   unipilePost    Es lo que espera el dispatcher, que convierte esa excepcion
//                  en failMessage con su razon.
//   unipileDelete  Response cruda: 404 significa cosas distintas segun el
//                  caller (ya retirada vs error) y esa decision es del feature.
//
// El que necesita fail-soft (recover-replies devuelve { items: [] } y sigue)
// lo arma sobre unipileFetch en su propio call site.
//
// API v1 y X-API-KEY: no migrar a v2 ni cambiar el DSN. Los contratos estan
// probados en produccion.

export const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";

export const UNIPILE_KEY = process.env.UNIPILE_API_KEY ?? "";

export function hasUnipileCreds(): boolean {
  return !!UNIPILE_KEY;
}

/** `path` arranca con "/" e incluye el `/api/v1/...`. */
function url(path: string): string {
  return path.startsWith("http") ? path : `${UNIPILE_BASE}${path}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- respuesta cruda del proveedor
function parse(text: string): any {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** Response cruda. No tira. Para quien decide segun el status. */
export function unipileFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "X-API-KEY": UNIPILE_KEY,
    accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(url(path), { ...init, headers });
}

/** GET parseado. Tira con el detalle del proveedor si no es 2xx. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- el shape lo define el endpoint que pide el caller
export async function unipileGet(path: string): Promise<any> {
  const res = await unipileFetch(path);
  const body = await res.text();
  const parsed = parse(body);
  if (!res.ok) {
    const err = parsed?.detail || parsed?.message || body || `HTTP ${res.status}`;
    throw new Error(`Unipile GET ${url(path)} → ${res.status}: ${err}`);
  }
  return parsed;
}

/** POST JSON parseado. Tira con el detalle del proveedor si no es 2xx. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem unipileGet
export async function unipilePost(path: string, body: unknown): Promise<any> {
  if (!UNIPILE_KEY) throw new Error("UNIPILE_API_KEY missing");
  const res = await unipileFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = parse(text);
  if (!res.ok) {
    const err = parsed?.detail || parsed?.title || parsed?.message || text || `HTTP ${res.status}`;
    throw new Error(`Unipile POST ${url(path)} → ${res.status}: ${err}`);
  }
  return parsed;
}

/** DELETE crudo. 404 lo interpreta el feature, no esto. */
export function unipileDelete(path: string): Promise<Response> {
  return unipileFetch(path, { method: "DELETE" });
}

export type UnipileFile = { name: string; mimeType: string; data: Buffer };

/**
 * POST multipart para los endpoints de chat que llevan adjuntos. Unipile espera
 * multipart/form-data nativo con un campo `attachments` por archivo mas los
 * campos de texto; el POST JSON no puede expresar eso.
 */
export async function unipileMultipartPost(
  path: string,
  fields: Record<string, string>,
  files: { name: string; file: UnipileFile }[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem unipileGet
): Promise<any> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const { name, file } of files) {
    // Blob es la forma cross-runtime de adjuntar binario a un FormData en fetch
    // moderno (Node 18+ / Edge / browser). Se pasa el filename original para
    // que LinkedIn se lo muestre al destinatario.
    fd.append(name, new Blob([file.data as unknown as ArrayBuffer], { type: file.mimeType }), file.name);
  }
  const res = await unipileFetch(path, { method: "POST", body: fd });
  const text = await res.text();
  const parsed = parse(text);
  if (!res.ok) {
    const err = parsed?.detail || parsed?.title || parsed?.message || text || `HTTP ${res.status}`;
    throw new Error(`Unipile POST ${url(path)} → ${res.status}: ${err}`);
  }
  return parsed;
}
