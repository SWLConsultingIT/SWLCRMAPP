# Llamadas inline a proveedores — estado tras las Fases 3B y 3C

> Actualizado al cerrar la Fase 3B acelerada. La versión anterior de este
> archivo era el mapa previo; esto es el resultado.

## Antes → después

| Proveedor | Antes | Después | Estado |
|---|---:|---:|---|
| **Maps** | 2 archivos | **0** | ✅ `integrations/maps/places.ts` |
| **Aircall** | 13 archivos | **0** | ✅ `integrations/aircall/client.ts` |
| **Instantly** | 8 archivos | **0** | ✅ `integrations/instantly/client.ts` |
| **n8n** | 9 archivos | **0** | ✅ `integrations/n8n/call-webhook.ts` |
| **Supabase REST** | 17 archivos | **4** | ✅ `integrations/supabase/rest.ts` — los 4 restantes son zona diferida |
| **AI** | 17 archivos | **0** | ✅ `integrations/ai/{anthropic,openai}.ts` |
| **WhatsApp** | 1 archivo | **0** | ✅ `integrations/whatsapp/client.ts` |
| **Unipile** | 11 archivos | 11 → **0** | ✅ Fase 3C · `integrations/unipile/{client,chats,accounts,linkedin}` |

**81 → 15 (3B) → 0 (3C).**

Cero llamadas HTTP a proveedores fuera de `integrations/` en todo el árbol.

## Primitives nuevos

```
integrations/
  maps/places.ts        nearbySearch · placeDetails · findPlaceFromText
                        photoUrl · streetViewUrl · staticMapUrl
  aircall/client.ts     aircallFetch + listNumbers · getNumber · listUsers
                        getUser · getCall · getCallTranscription · listCalls
                        startCall  (el POST de dial)
  instantly/client.ts   instantlyFetch · instantlyGet · listAccounts
                        INSTANTLY_BASE
  n8n/call-webhook.ts   N8N_BASE · n8nWebhookUrl · callWebhook
  supabase/rest.ts      SB_REST_URL · restHeaders · restFetch · restGet
  ai/anthropic.ts       getAnthropic
  ai/openai.ts          OPENAI_CHAT_URL · OPENAI_TRANSCRIPTIONS_URL
                        openaiChat · getOpenAI
  whatsapp/client.ts    WA_BASE · sendWhatsAppMessage
```

## Excepciones de runtime: ninguna

`proxy.ts` se había anotado como posible excepción. **No lo es**: su única
mención de Unipile es la cadena `"/api/unipile/webhook"` dentro de
`PUBLIC_PATHS`, la allowlist del middleware. Es una ruta propia, no una llamada
al proveedor. No hubo que contaminar ningún cliente para llegar a cero.

Los 3 REST que quedaban "en zona Unipile" (`hosted-link`,
`unlinked-accounts`, `webhook`) resultaron ser transporte legítimo y se
migraron a `integrations/supabase/rest.ts` junto con el resto.

## Cómo quedó Unipile

```
integrations/unipile/
  client.ts     UNIPILE_BASE · unipileFetch · unipileGet · unipilePost
                unipileDelete · unipileMultipartPost · hasUnipileCreds
  linkedin.ts   CANON — getUserProfile · getRelationState · isFirstDegree
                sendInvite · withdrawInvitation · sendDm · extractLinkedinSlug
  chats.ts      createChat(Raw) · sendChatMessage(Raw) · listChats(Raw)
                getChatMessages(Raw) · getMessageRaw · deleteChat
                createChatMultipart · sendChatMessageMultipart
  accounts.ts   listAccountsRaw · createHostedAuthLink
  linkedin-profile.ts · name-signing.ts   (ya estaban)
  tests/        49 asserts de contrato
```

**Tres formas de llamar, a propósito.** Los call sites no comparten semántica de
error: `unipileFetch` devuelve el Response crudo para quien mira el status,
`unipileGet`/`unipilePost` tiran con el detalle del proveedor (que es lo que el
dispatcher convierte en `failMessage`), y `unipileDelete` devuelve crudo porque
un 404 significa cosas distintas según el caller. Unificarla habría cambiado
comportamiento.

### Lo anterior, para referencia histórica

### Unipile — 11 archivos · **cerrado en 3C**
`inbox/reply` (6 fetch) · `cron/dispatch-queue` (4) · `unipile/hosted-link` (4)
`sellers/[id]/connection-status` (4) · `cron/recover-replies` (3)
`cron/resolve-telegram-users` (2) · `unipile/unlinked-accounts` (2)
`unipile/webhook` (2) · `cron/dispatch-telegram` (1) · `inbox/thread` (1)
`unipile/telegram-hosted-link` (1)

Acá viven los connection requests, los DMs, la aceptación, el withdraw y el
enrichment de perfil. `integrations/unipile/linkedin.ts` ya tiene los contratos
correctos (v1, `X-API-KEY`, host de fallback api21) y lo usan expire-invites,
withdraw y linkedin-recovery: **ese es el modelo a seguir en 3C**, no inventar
un cuarto cliente.

### Supabase REST — 3 archivos · misma zona
`unipile/hosted-link`, `unipile/unlinked-accounts`, `unipile/webhook`. Son
llamadas a Supabase, pero viven en rutas de Unipile y se migran con ellas.

### `proxy.ts` — 1 archivo · legítimo
Es el middleware de Next: corre en otro runtime y no puede depender de módulos
del árbol de la app de la misma forma. Se deja donde está.

## Caminos de envío real: qué se tocó y qué no

| Camino | Qué se movió | Qué **no** se tocó |
|---|---|---|
| `cron/dispatch-email` | sólo la constante `INSTANTLY_BASE` | el helper de envío entero, incluido el `content-type` condicional que arregló el 400 de `DELETE /leads` |
| `inbox/reply` | las 2 **lecturas** (listado + verificación de entrega) | el `POST /emails/reply` |
| `aircall/dial` · `cron/dispatch-call` | el POST pasa por `startCall()` | a qué asiento dialar, qué número, la normalización del teléfono, el 204 sin body |
| `cron/dispatch-whatsapp` | el POST pasa por `sendWhatsAppMessage()` | destinatario, plantilla, ventana de 24h, batch de 5 |

No se ejecutó ningún envío de prueba: ni email, ni LinkedIn, ni WhatsApp, ni
llamadas.

## Dedupes anotados, no hechos

- **`callHaiku()` ×3** en `preview-tailor`, `tailor` y `wizard-batch-preview`:
  retries y manejo de error distintos. Unificarlos cambia comportamiento.
- **`bulkParallel()` ×2** idénticas en los mismos endpoints.

## Hallazgos de configuración (no son refactor)

1. **API key de Google Maps hardcodeada** como fallback, duplicada en los 2
   routes. Ahora está en un solo lugar, con el mismo comportamiento.
   **Conviene rotarla y dejarla sólo en env.**
2. **Id de proyecto Supabase hardcodeado** en 4 archivos
   (`inbox/suggest`, `leads/[id]/stage`, `sellers/[id]`, `sellers`): apuntaban a
   un proyecto fijo aunque `NEXT_PUBLIC_SUPABASE_URL` dijera otra cosa. En un
   preview apuntado a otro Supabase, esas 4 rutas seguían escribiendo a prod.
   Ya leen la env.

## El gate

`scripts/check-boundaries.mts` suma la **regla 8**: nadie instancia el SDK de un
proveedor (`@anthropic-ai/sdk`, `openai`) fuera de `integrations/`. Se chequean
SDKs con paquete propio porque ahí el import es evidencia directa; no se banea
`fetch()` global, que sería frágil y llenaría el gate de falsos positivos.

`import type` no cuenta: un tipo no llama a nadie.

La regla ya encontró uno real — `campaigns/generate-field` importaba `openai`
con un import dinámico que ningún grep de host hubiera visto.
