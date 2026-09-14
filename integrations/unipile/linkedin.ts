// Primitives de LinkedIn sobre Unipile. Este es el CANON: los contratos
// (API v1, X-API-KEY, host de fallback api21) estan probados en produccion por
// el dispatcher, expire-invites, withdraw y LinkedIn Recovery. No crear otro
// wrapper en paralelo — extender este.
//
// El transporte vive en ./client. Aca esta la SEMANTICA de LinkedIn: que
// significa una invitacion, una relacion, un primer DM. Las decisiones de
// negocio —a quien invitar, cuando, con que nota, que hacer con un 404— son
// del feature.
//
// Este modulo hace llamadas externas REALES. Los callers las gatean detras de
// su propio flag / execute mode. GET es de solo lectura (preflight); withdraw
// (DELETE) e invite/DM (POST) son las unicas mutantes.

import { unipileFetch, unipileGet, unipilePost, UNIPILE_BASE, UNIPILE_KEY, hasUnipileCreds } from "./client";

export { UNIPILE_BASE, UNIPILE_KEY, hasUnipileCreds };

// Pure: saca el handle /in/<slug> de una URL de perfil. Espeja el extractor del
// dispatcher para que recovery resuelva el mismo provider.
export function extractLinkedinSlug(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/in\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

export type WithdrawResult =
  | { ok: true; status: "withdrawn" }
  | { ok: true; status: "already_gone" }
  | { ok: false; status: "failed"; reason: string };

// DELETE de una invitacion SENT pendiente. 404 = ya no esta (aceptada/
// rechazada/retirada en otro lado) — se reporta distinto para que recovery NO
// arranque un cooldown que no puede anclar.
export async function withdrawInvitation(invitationId: string, accountId: string): Promise<WithdrawResult> {
  if (!UNIPILE_KEY) return { ok: false, status: "failed", reason: "UNIPILE_API_KEY missing" };
  const path = `/api/v1/users/invite/sent/${encodeURIComponent(invitationId)}?account_id=${encodeURIComponent(accountId)}`;
  try {
    const res = await unipileFetch(path, { method: "DELETE" });
    if (res.ok) return { ok: true, status: "withdrawn" };
    if (res.status === 404) return { ok: true, status: "already_gone" };
    const body = await res.text().catch(() => "");
    return { ok: false, status: "failed", reason: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, status: "failed", reason: e?.message ?? String(e) };
  }
}

/** GET crudo del perfil. El dispatcher necesita la respuesta entera (nombre,
 *  provider_id, internal id, distancia, estado de invitacion). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- el dispatcher necesita la respuesta entera del proveedor
export function getUserProfile(slug: string, accountId: string): Promise<any> {
  if (!UNIPILE_KEY) throw new Error("UNIPILE_API_KEY missing");
  return unipileGet(`/api/v1/users/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(accountId)}`);
}

export type RelationState = {
  providerId: string | null;
  networkDistance: string | null;   // FIRST_DEGREE / DISTANCE_1 / DISTANCE_2 / ...
  invitationStatus: string | null;  // PENDING / null
  firstName: string;
  lastName: string;
};

// Estado vivo de la relacion con el perfil, desde la cuenta que envia. Es el
// preflight de solo lectura que recovery corre antes de cada escritura externa.
export async function getRelationState(slug: string, accountId: string): Promise<RelationState> {
  const parsed = await getUserProfile(slug, accountId);
  return {
    providerId: parsed?.provider_id ?? null,
    networkDistance: parsed?.network_distance ?? null,
    invitationStatus: parsed?.invitation?.status ?? null,
    firstName: parsed?.first_name ?? "",
    lastName: parsed?.last_name ?? "",
  };
}

export function isFirstDegree(networkDistance: string | null): boolean {
  return networkDistance === "FIRST_DEGREE" || networkDistance === "DISTANCE_1";
}

// POST de una connection request. Devuelve el invitation_id nuevo.
export async function sendInvite(accountId: string, providerId: string, note: string | undefined): Promise<{ invitationId: string | null }> {
  const parsed = await unipilePost("/api/v1/users/invite", {
    account_id: accountId,
    provider_id: providerId,
    message: note || undefined,
  });
  return { invitationId: parsed?.invitation_id ?? null };
}

// POST del primer DM a una conexion (ya de primer grado) via un chat nuevo.
export async function sendDm(accountId: string, providerId: string, text: string): Promise<{ chatId: string | null; messageId: string | null }> {
  const parsed = await unipilePost("/api/v1/chats", {
    account_id: accountId,
    attendees_ids: [providerId],
    text,
  });
  return {
    chatId: parsed?.chat_id ?? parsed?.id ?? null,
    messageId: parsed?.message_id ?? parsed?.id ?? null,
  };
}
