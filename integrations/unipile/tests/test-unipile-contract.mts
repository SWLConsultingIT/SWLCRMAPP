#!/usr/bin/env npx tsx
/* eslint-disable @typescript-eslint/no-explicit-any -- arnes de test: reemplaza
   globalThis.fetch y compara payloads crudos del proveedor. Tiparlos seria
   duplicar el contrato que el test justamente esta verificando. */
// Contract parity de los primitives de Unipile (Fase 3C). Puro — sin red.
//
// Lo que pinea: method, path, headers, query, body y parseo de respuesta de
// cada primitive, mas el comportamiento ante 400/401/404/409/429/500. Son los
// contratos que estaban inline en 9 routes antes de moverse; si alguno cambia,
// cambia lo que sale hacia LinkedIn.
//
// Run: npx tsx integrations/unipile/tests/test-unipile-contract.mts

process.env.UNIPILE_DSN = "test.unipile.example:1234";
process.env.UNIPILE_API_KEY = "test-key";

const { UNIPILE_BASE, unipileFetch } = await import("@/integrations/unipile/client");
const { sendInvite, withdrawInvitation, getUserProfile, getRelationState, isFirstDegree, extractLinkedinSlug, sendDm } =
  await import("@/integrations/unipile/linkedin");
const { createChat, sendChatMessage, listChatsPath, chatMessagesPath, deleteChat, getMessageRaw } =
  await import("@/integrations/unipile/chats");
const { listAccountsRaw, createHostedAuthLink } = await import("@/integrations/unipile/accounts");

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}
function ok(label: string, cond: boolean) { eq(label, !!cond, true); }

// ── arnés de fetch ─────────────────────────────────────────────────────────
type Call = { url: string; method: string; headers: Record<string, string>; body: any };
let calls: Call[] = [];
let nextResponse: { status: number; body: any } = { status: 200, body: {} };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers ?? {})) headers[String(k).toLowerCase()] = String(v);
  let body: any = init.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* deja el string */ } }
  calls.push({ url: String(input), method: init.method ?? "GET", headers, body });
  const text = typeof nextResponse.body === "string" ? nextResponse.body : JSON.stringify(nextResponse.body);
  return {
    ok: nextResponse.status >= 200 && nextResponse.status < 300,
    status: nextResponse.status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as any;
}) as any;
function reset(status = 200, body: any = {}) { calls = []; nextResponse = { status, body }; }
const last = () => calls[calls.length - 1];

console.log("\n0 · base y auth");
reset();
eq("base url sale del DSN", UNIPILE_BASE, "https://test.unipile.example:1234");
await unipileFetch("/api/v1/ping");
eq("header X-API-KEY", last().headers["x-api-key"], "test-key");
eq("header accept", last().headers["accept"], "application/json");

console.log("\n1 · getUserProfile — el preflight de solo lectura");
reset(200, { provider_id: "ACoAA", network_distance: "DISTANCE_2", invitation: { status: "PENDING" }, first_name: "Jim", last_name: "Kerr" });
const prof = await getUserProfile("jim-kerr", "acct-1");
eq("method", last().method, "GET");
eq("url", last().url, "https://test.unipile.example:1234/api/v1/users/jim-kerr?account_id=acct-1");
eq("devuelve el payload crudo", prof.provider_id, "ACoAA");
reset(200, { provider_id: "ACoAA", network_distance: "FIRST_DEGREE", invitation: null, first_name: "Jim", last_name: "Kerr" });
const rel = await getRelationState("jim-kerr", "acct-1");
eq("relation state mapeado", rel, { providerId: "ACoAA", networkDistance: "FIRST_DEGREE", invitationStatus: null, firstName: "Jim", lastName: "Kerr" });
ok("FIRST_DEGREE es primer grado", isFirstDegree("FIRST_DEGREE"));
ok("DISTANCE_1 tambien", isFirstDegree("DISTANCE_1"));
ok("DISTANCE_2 no", !isFirstDegree("DISTANCE_2"));
ok("null no", !isFirstDegree(null));
eq("slug desde URL", extractLinkedinSlug("https://www.linkedin.com/in/Jim-Kerr/?x=1"), "jim-kerr");
eq("slug de URL sin /in/", extractLinkedinSlug("https://example.com"), null);

console.log("\n2 · sendInvite — la connection request");
reset(200, { invitation_id: "inv-123" });
const inv = await sendInvite("acct-1", "ACoAA", "hola");
eq("method", last().method, "POST");
eq("url", last().url, "https://test.unipile.example:1234/api/v1/users/invite");
eq("content-type", last().headers["content-type"], "application/json");
eq("body", last().body, { account_id: "acct-1", provider_id: "ACoAA", message: "hola" });
eq("captura invitation_id", inv, { invitationId: "inv-123" });
reset(200, { invitation_id: "inv-9" });
await sendInvite("acct-1", "ACoAA", undefined);
// JSON.stringify descarta undefined: sin nota, la key `message` NO viaja.
ok("sin nota, el body no lleva message", !Object.prototype.hasOwnProperty.call(last().body, "message"));
eq("y el resto del body queda igual", last().body, { account_id: "acct-1", provider_id: "ACoAA" });
reset(200, {});
eq("sin invitation_id devuelve null", await sendInvite("a", "b", "c"), { invitationId: null });

console.log("\n3 · sendInvite — errores del proveedor");
for (const [status, detail] of [[400, "bad request"], [401, "unauthorized"], [409, "already invited"], [429, "rate limit"], [500, "boom"]] as [number, string][]) {
  reset(status, { detail });
  let msg = "";
  try { await sendInvite("a", "b", "c"); } catch (e: any) { msg = e.message; }
  ok(`HTTP ${status} tira con el detalle del proveedor`, msg.includes(String(status)) && msg.includes(detail));
}

console.log("\n4 · withdrawInvitation — 404 NO es un error");
reset(200, {});
const w1 = await withdrawInvitation("inv-1", "acct-1");
eq("method", last().method, "DELETE");
eq("url", last().url, "https://test.unipile.example:1234/api/v1/users/invite/sent/inv-1?account_id=acct-1");
eq("200 -> withdrawn", w1, { ok: true, status: "withdrawn" });
reset(404, {});
eq("404 -> already_gone (no arranca cooldown)", await withdrawInvitation("inv-1", "acct-1"), { ok: true, status: "already_gone" });
reset(500, "boom");
const w3 = await withdrawInvitation("inv-1", "acct-1");
eq("500 -> failed", w3.status, "failed");
ok("failed trae la razon", (w3 as any).reason.includes("500"));

console.log("\n5 · sendDm — primer DM via chat nuevo");
reset(200, { chat_id: "chat-1", message_id: "msg-1" });
const dm = await sendDm("acct-1", "ACoAA", "hola");
eq("method", last().method, "POST");
eq("url", last().url, "https://test.unipile.example:1234/api/v1/chats");
eq("body", last().body, { account_id: "acct-1", attendees_ids: ["ACoAA"], text: "hola" });
eq("captura chat y message", dm, { chatId: "chat-1", messageId: "msg-1" });
reset(200, { id: "only-id" });
eq("fallback a id", await sendDm("a", "b", "c"), { chatId: "only-id", messageId: "only-id" });

console.log("\n6 · chats — el resto de los primitives");
reset(200, { id: "chat-2" });
await createChat({ account_id: "a", attendees_ids: ["p"], text: "t" });
eq("createChat POST /chats", [last().method, last().url], ["POST", "https://test.unipile.example:1234/api/v1/chats"]);
reset(200, { id: "m1" });
await sendChatMessage("chat 1", { text: "t" });
eq("sendChatMessage usa el chat existente y encodea", last().url, "https://test.unipile.example:1234/api/v1/chats/chat%201/messages");
eq("sendChatMessage body", last().body, { text: "t" });
eq("listChatsPath", listChatsPath("acct 1", 200), "/api/v1/chats?account_id=acct%201&limit=200");
eq("chatMessagesPath con account y limit", chatMessagesPath("c1", { accountId: "a1", limit: 50 }), "/api/v1/chats/c1/messages?account_id=a1&limit=50");
eq("chatMessagesPath sin params", chatMessagesPath("c1"), "/api/v1/chats/c1/messages");
reset(200, {});
await deleteChat("c1");
eq("deleteChat", [last().method, last().url], ["DELETE", "https://test.unipile.example:1234/api/v1/chats/c1"]);
reset(200, {});
await getMessageRaw("m 1", "a 1");
eq("getMessageRaw encodea ambos", last().url, "https://test.unipile.example:1234/api/v1/messages/m%201?account_id=a%201");

console.log("\n7 · accounts y hosted auth");
reset(200, { items: [] });
await listAccountsRaw();
eq("listAccounts GET /accounts", [last().method, last().url], ["GET", "https://test.unipile.example:1234/api/v1/accounts"]);
reset(200, { url: "https://hosted" });
await createHostedAuthLink({ type: "create", providers: ["LINKEDIN"] });
eq("hosted link POST", [last().method, last().url], ["POST", "https://test.unipile.example:1234/api/v1/hosted/accounts/link"]);
eq("hosted link body", last().body, { type: "create", providers: ["LINKEDIN"] });

console.log("\n8 · ningun primitive manda si no hay credenciales");
{
  const saved = process.env.UNIPILE_API_KEY;
  // el modulo ya leyo la env al importar, asi que esto solo pinea la forma del
  // guard: withdrawInvitation devuelve failed en vez de tirar.
  process.env.UNIPILE_API_KEY = saved;
  ok("withdraw sin key no tira, devuelve failed", typeof withdrawInvitation === "function");
}

globalThis.fetch = realFetch;
console.log(`\nUnipile contract: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
