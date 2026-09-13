// Shared Unipile LinkedIn primitives. Extracted so LinkedIn Recovery reuses the
// EXACT same contracts the dispatcher / expire-invites already use in prod
// (v1 API, X-API-KEY, api21 fallback host) instead of inventing a fourth copy.
//
// This module makes real external HTTP calls; callers gate them behind the
// recovery feature flag + execute mode. GET is read-only (preflight); withdraw
// (DELETE) and invite/DM (POST) are the only mutating calls.

export const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
export const UNIPILE_KEY = process.env.UNIPILE_API_KEY ?? "";

export function hasUnipileCreds(): boolean {
  return !!UNIPILE_KEY;
}

// Pure: pull the /in/<slug> handle from a LinkedIn profile URL. Mirrors the
// dispatcher's extractor so recovery resolves the same provider.
export function extractLinkedinSlug(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/in\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

export type WithdrawResult =
  | { ok: true; status: "withdrawn" }
  | { ok: true; status: "already_gone" }
  | { ok: false; status: "failed"; reason: string };

// DELETE a pending SENT invitation. 404 = already gone (accepted/declined/
// withdrawn elsewhere) — reported distinctly so recovery does NOT start a
// cooldown it can't anchor.
export async function withdrawInvitation(invitationId: string, accountId: string): Promise<WithdrawResult> {
  if (!UNIPILE_KEY) return { ok: false, status: "failed", reason: "UNIPILE_API_KEY missing" };
  const url = `${UNIPILE_BASE}/api/v1/users/invite/sent/${encodeURIComponent(invitationId)}?account_id=${encodeURIComponent(accountId)}`;
  try {
    const res = await fetch(url, { method: "DELETE", headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" } });
    if (res.ok) return { ok: true, status: "withdrawn" };
    if (res.status === 404) return { ok: true, status: "already_gone" };
    const body = await res.text().catch(() => "");
    return { ok: false, status: "failed", reason: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, status: "failed", reason: e?.message ?? String(e) };
  }
}

export type RelationState = {
  providerId: string | null;
  networkDistance: string | null;   // FIRST_DEGREE / DISTANCE_1 / DISTANCE_2 / ...
  invitationStatus: string | null;  // PENDING / null
  firstName: string;
  lastName: string;
};

// GET the live relation state for a lead's profile from the sending account.
// The read-only preflight recovery runs before every external write.
export async function getRelationState(slug: string, accountId: string): Promise<RelationState> {
  if (!UNIPILE_KEY) throw new Error("UNIPILE_API_KEY missing");
  const url = `${UNIPILE_BASE}/api/v1/users/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(accountId)}`;
  const res = await fetch(url, { headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" } });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = parsed?.detail || parsed?.message || text || `HTTP ${res.status}`;
    throw new Error(`Unipile GET ${url} → ${res.status}: ${err}`);
  }
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

// POST a connection request. Returns the new invitation_id.
export async function sendInvite(accountId: string, providerId: string, note: string | undefined): Promise<{ invitationId: string | null }> {
  const parsed = await unipilePost(`${UNIPILE_BASE}/api/v1/users/invite`, {
    account_id: accountId,
    provider_id: providerId,
    message: note || undefined,
  });
  return { invitationId: parsed?.invitation_id ?? null };
}

// POST a first DM to a (now first-degree) connection via a fresh chat.
export async function sendDm(accountId: string, providerId: string, text: string): Promise<{ chatId: string | null; messageId: string | null }> {
  const parsed = await unipilePost(`${UNIPILE_BASE}/api/v1/chats`, {
    account_id: accountId,
    attendees_ids: [providerId],
    text,
  });
  return {
    chatId: parsed?.chat_id ?? parsed?.id ?? null,
    messageId: parsed?.message_id ?? parsed?.id ?? null,
  };
}

async function unipilePost(url: string, body: any): Promise<any> {
  if (!UNIPILE_KEY) throw new Error("UNIPILE_API_KEY missing");
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = parsed?.detail || parsed?.title || parsed?.message || text || `HTTP ${res.status}`;
    throw new Error(`Unipile POST ${url} → ${res.status}: ${err}`);
  }
  return parsed;
}
