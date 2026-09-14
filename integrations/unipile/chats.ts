// Primitives de chat de Unipile — compartidas por LinkedIn y Telegram.
//
// Son transporte con nombre: arman el path y devuelven lo que el proveedor
// contesta. QUE mandar, a quien, cuando, y que hacer con un chat que ya existe
// lo decide el feature.

import { unipileFetch, unipileGet, unipilePost, unipileDelete, unipileMultipartPost, type UnipileFile } from "./client";

/** POST /chats — crea un chat. Con `text` manda el primer mensaje. */
export function createChat(body: Record<string, unknown>) {
  return unipilePost("/api/v1/chats", body);
}

/** POST /chats — version cruda, para quien mira el status (Telegram). */
export function createChatRaw(body: Record<string, unknown>): Promise<Response> {
  return unipileFetch("/api/v1/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** POST /chats/{chatId}/messages — mensaje en un chat existente. */
export function sendChatMessage(chatId: string, body: Record<string, unknown>) {
  return unipilePost(`/api/v1/chats/${encodeURIComponent(chatId)}/messages`, body);
}

/** POST /chats/{chatId}/messages — version cruda (Telegram). */
export function sendChatMessageRaw(chatId: string, body: Record<string, unknown>): Promise<Response> {
  return unipileFetch(`/api/v1/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** POST /chats con adjuntos (multipart). */
export function createChatMultipart(fields: Record<string, string>, files: { name: string; file: UnipileFile }[]) {
  return unipileMultipartPost("/api/v1/chats", fields, files);
}

/** POST /chats/{chatId}/messages con adjuntos (multipart). */
export function sendChatMessageMultipart(chatId: string, fields: Record<string, string>, files: { name: string; file: UnipileFile }[]) {
  return unipileMultipartPost(`/api/v1/chats/${encodeURIComponent(chatId)}/messages`, fields, files);
}

/** GET /chats?account_id=…&limit=… */
export function listChatsPath(accountId: string, limit: number): string {
  return `/api/v1/chats?account_id=${encodeURIComponent(accountId)}&limit=${limit}`;
}
export function listChats(accountId: string, limit: number) {
  return unipileGet(listChatsPath(accountId, limit));
}
export function listChatsRaw(accountId: string, limit: number): Promise<Response> {
  return unipileFetch(listChatsPath(accountId, limit));
}

/** GET /chats/{chatId}/messages con query opcional. */
export function chatMessagesPath(chatId: string, params?: { accountId?: string; limit?: number }): string {
  const q = new URLSearchParams();
  if (params?.accountId) q.set("account_id", params.accountId);
  if (params?.limit != null) q.set("limit", String(params.limit));
  const qs = q.toString();
  return `/api/v1/chats/${encodeURIComponent(chatId)}/messages${qs ? `?${qs}` : ""}`;
}
export function getChatMessages(chatId: string, params?: { accountId?: string; limit?: number }) {
  return unipileGet(chatMessagesPath(chatId, params));
}
export function getChatMessagesRaw(chatId: string, params?: { accountId?: string; limit?: number }): Promise<Response> {
  return unipileFetch(chatMessagesPath(chatId, params));
}

/** GET /messages/{id}?account_id=… */
export function getMessageRaw(messageId: string, accountId: string): Promise<Response> {
  return unipileFetch(`/api/v1/messages/${encodeURIComponent(messageId)}?account_id=${encodeURIComponent(accountId)}`);
}

/** DELETE /chats/{chatId} — usado para limpiar el chat sonda de Telegram. */
export function deleteChat(chatId: string): Promise<Response> {
  return unipileDelete(`/api/v1/chats/${chatId}`);
}
