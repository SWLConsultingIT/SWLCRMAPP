// Transporte de OpenAI.
//
// Cuatro archivos armaban a mano la URL de chat/completions o de
// audio/transcriptions y el header Bearer. Aca queda la base URL, el auth y el
// POST. El body —modelo, mensajes, temperature, response_format— lo sigue
// armando el call site, porque es la decision del feature.

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

/** POST a chat/completions. `body` va tal cual. Devuelve el Response crudo:
 *  los call sites miran res.ok y arman su propio fallback. */
export function openaiChat(apiKey: string, body: unknown, init?: RequestInit): Promise<Response> {
  return fetch(OPENAI_CHAT_URL, {
    method: "POST",
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
  });
}
