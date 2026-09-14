// Transporte de WhatsApp Cloud API (Meta Graph).
//
// Un solo call site hoy: app/api/cron/dispatch-whatsapp. Se extrae igual porque
// es ENVIO REAL a un cliente final y conviene que la base URL, la version de la
// API y el token esten en un lugar unico y visible.
//
// Lo que NO se movio: a quien se le manda, que plantilla, la ventana de sesion
// de 24h, el batch de 5 y el manejo de error. Eso es la LEY del canal y vive en
// el cron.
//
// La version de la API queda fija en v20.0, igual que estaba. Subirla es un
// cambio de comportamiento del proveedor, no un refactor.

const WA_API_VERSION = "v20.0";
export const WA_BASE = `https://graph.facebook.com/${WA_API_VERSION}`;

/** Token de sistema, compartido entre tenants. */
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? "";

export function hasWhatsAppCredentials(): boolean {
  return !!WA_TOKEN;
}

/** POST /{phoneNumberId}/messages. Envio real. Devuelve el Response crudo:
 *  el cron lee el body para sacar el message id y para loguear el error. */
export function sendWhatsAppMessage(
  phoneNumberId: string,
  payload: unknown,
  token: string = WA_TOKEN,
): Promise<Response> {
  return fetch(`${WA_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
