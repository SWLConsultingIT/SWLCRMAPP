# Blindaje del sistema de envío de mensajes — 2026-09-02

Endurecimiento post-incidente "Hola Victor" (flow *Private Equity & VC Firms — Spain*).
Objetivo: que sea **técnicamente imposible** que un lead reciba un mensaje con un
nombre que no es el suyo, un placeholder sin resolver, sintaxis extranjera, o
contenido reescrito por una IA después de la aprobación.

---

## 1. Arquitectura ANTES

- **`renderPlaceholders` (lib/placeholders.ts)** era el motor determinístico
  central, pero **no todos los canales lo usaban igual**:
  - LinkedIn (`dispatch-queue`) y Email (`dispatch-email`): usaban
    `renderPlaceholders` + 3 guards inline **duplicados** (foreign syntax,
    seller inválido, unresolved).
  - Telegram (`dispatch-telegram`): usaba `renderPlaceholders` pero **con solo
    4 campos** y **sin ningún guard** de validación.
  - WhatsApp (`dispatch-whatsapp`): tenía su **propia función privada
    `personalize()`** con solo 3 tokens y fallback `?? "there"`. **No pasaba por
    el motor central ni por ninguna validación.**
  - Script legacy `scripts/dispatch-pathway-8.mjs`: **otra `personalize()`
    privada** de 2 tokens que enviaba a Unipile directo.
  - `inbox/reply`: renderizaba y **borraba a blanco** los tokens sin resolver
    (`.replace(/\{\{...\}\}/g, "")`) — justo el comportamiento "blanqueo
    silencioso" que hay que eliminar.
- **`first_name` tenía fallback silencioso a `"there"`** en `renderPlaceholders`
  y en WhatsApp: si el lead no tenía nombre, el mensaje salía igual.
- **Post-approve la IA podía reescribir contenido**: `/api/campaigns/tailor`
  (Haiku) era invocable *standalone* "on demand" sobre una campaña ya viva y
  reescribía `campaign_messages.content`.
- **Write paths sin normalizar**: `add-leads`, `edit-flow`, `messages/[id]`
  escribían contenido crudo (approve y templates/launch sí normalizaban).
- **Logging dispar**: cada canal guardaba metadata distinta; no había forma
  uniforme de reconstruir qué recibió cada lead ni por qué se bloqueó.

## 2. Arquitectura DESPUÉS

Un **único gate** `resolveOutbound(template, lead, seller, channel?)` en
`lib/placeholders.ts` que hace, en una sola llamada:

```
template aprobado → renderPlaceholders (determinístico, strict)
                  → validateOutboundMessage (una sola función, todos los canales)
                  → { ok, text | error, log }
```

- **TODOS** los canales (LinkedIn, Email, Telegram, WhatsApp, inbox/reply) llaman
  a `resolveOutbound`. **Ningún sender tiene lógica de placeholder ni de
  validación propia.**
- Si `resolveOutbound` bloquea, el sender marca la fila `failed` con el motivo
  exacto y **no envía**. El log de auditoría se persiste igual (éxito o bloqueo).
- `first_name` **sin fallback**: si falta y el template lo pide, el token queda
  sin resolver → `validateOutboundMessage` bloquea.
- **Freeze de IA post-approve**: `tailor` se niega a correr (409) si la campaña
  ya envió ≥1 mensaje.
- **Write paths blindados**: approve, templates/launch, add-leads, edit-flow y
  messages/[id] pasan por `autoNormalizePlaceholders` (que además de-hornea un
  nombre literal en el saludo → `{{first_name}}`).
- **Logging uniforme**: `metadata.outbound` = `{ template, rendered, channel,
  placeholders, validation, error, at }` + `metadata.rendered_content` en cada
  fila enviada o bloqueada, en todos los canales.

## 3. Cambios (archivo por archivo)

| Archivo | Cambio |
|---|---|
| `lib/placeholders.ts` | Quité el fallback `first_name ?? "there"` (queda el token sin resolver si falta). Agregué `validateOutboundMessage()`, `resolveOutbound()`, `namesMatch()`, `placeholdersUsed()`, tipos `OutboundValidation`/`OutboundLog`/`OutboundResult`, helper `stripDiacritics`. |
| `app/api/cron/dispatch-queue/route.ts` | Reemplacé los 3 guards inline + `personalizeNote` por una sola `resolveOutbound(...,"linkedin")`. `failMessage` ahora persiste `metadata.outbound`. Éxito guarda `outbound`. |
| `app/api/cron/dispatch-email/route.ts` | Eliminé `personalize()` privada y los 4 guards inline. `subject` y `body` pasan cada uno por `resolveOutbound`. `failMessage` + éxito guardan el log. |
| `app/api/cron/dispatch-telegram/route.ts` | Reemplacé el `renderPlaceholders` de 4 campos (sin validación) por `resolveOutbound(...,"telegram")` con el lead completo + bloqueo + log. |
| `app/api/cron/dispatch-whatsapp/route.ts` | **Borré la `personalize()` privada** (fallback `"there"`, 3 tokens). Ahora `resolveOutbound(...,"whatsapp")`. Amplié el `select` del lead con `LEAD_PLACEHOLDER_COLUMNS`. Bloqueo + log. |
| `app/api/inbox/reply/[leadId]/route.ts` | Reemplacé render + *strip-a-blanco* por `resolveOutbound(...,"reply")`: bloquea (400) en vez de blanquear. Guarda `metadata.outbound`. |
| `app/api/campaigns/tailor/route.ts` | Freeze post-approve: 409 `post_approve_ai_frozen` si la campaña ya envió ≥1 mensaje (dryRun sigue permitido). |
| `app/api/campaigns/[id]/add-leads/route.ts` | Normalizo `content`/`subject` copiados del lead hermano con `autoNormalizePlaceholders` (de-hornea nombres). |
| `app/api/campaigns/[id]/edit-flow/route.ts` | Normalizo `content`/`subject` en el RPC de edición y en la inserción de pasos nuevos. |
| `app/api/messages/[id]/route.ts` | Normalizo el `content` editado a mano antes de guardar. |
| `scripts/dispatch-pathway-8.mjs` | **Deshabilitado** (early exit) — enviaba a Unipile con `personalize()` propia, bypasseando el gate. |
| `scripts/test-outbound.mts` | **Nuevo** — suite de tests (Francisco + casos A–G + extras). |

## 4. Tabla de senders

| Canal | resolveOutbound | validateOutboundMessage | logging (`metadata.outbound`) | Resultado |
|---|:--:|:--:|:--:|:--:|
| LinkedIn (`dispatch-queue`) | ✅ | ✅ | ✅ | ✅ |
| Email (`dispatch-email`) | ✅ (subject + body) | ✅ | ✅ | ✅ |
| Telegram (`dispatch-telegram`) | ✅ | ✅ | ✅ | ✅ |
| WhatsApp (`dispatch-whatsapp`) | ✅ | ✅ | ✅ | ✅ |
| Reply (`inbox/reply`) | ✅ | ✅ | ✅ | ✅ |
| Script legacy (`dispatch-pathway-8`) | — | — | — | ✅ DESHABILITADO |

`validateOutboundMessage` bloquea en: contenido vacío · `{{placeholder}}` sin
resolver · sintaxis extranjera (`[First Name]`, `%FIRST_NAME%`, `{First Name}`,
`<<...>>`, `__...__`) · seller inválido · **nombre literal en el saludo que no es
el del lead**.

## 5. ¿Puede una IA modificar contenido DESPUÉS de aprobar?

**NO** (en el flujo de campaña):

- Ningún dispatcher llama a un LLM en tiempo de envío. El envío es
  `campaign_messages.content` (template congelado) → `renderPlaceholders`
  (sustitución determinística, sin IA) → provider.
- El único LLM que tocaba contenido post-creación era `tailor`; ahora tiene el
  freeze de primer-envío. Los `{{tailored:hook/fit}}` se resuelven en approve
  (antes de estar vivo).
- Los demás LLM del repo son análisis/preview/borradores (coach, summary,
  talking-points, `inbox/suggest` que devuelve un borrador para que el humano
  edite y mande por `inbox/reply`). **Ninguno envía ni persiste contenido de
  campaña que salte el gate.**
- Nota pre-existente (fuera de scope de este blindaje): varios de esos endpoints
  llaman a Anthropic directo desde Next.js, lo que roza la LAW "IA solo vía
  n8n". No es un bypass del gate de envío (nada de eso llega a un provider sin
  pasar por approve→normalize y luego resolveOutbound).

## 6. Auditoría de bypass (barrido final)

- **Funciones `personalize` privadas**: quedan 2 hits — uno en una *page* de
  display (`leads/lost/[id]`, renderiza una sugerencia para el humano, no envía)
  y el script legacy **ya deshabilitado**. Ningún sender de producción tiene
  `personalize` propia.
- **Sustitución directa `.replaceAll("{{first_name}}")`**: solo en *pages* de
  display (muestran lo que el lead recibió) y en el script deshabilitado + 2
  scripts one-shot de remediación. Ningún path de envío.
- **Llamadas directas a providers** fuera de los 5 senders: webhooks (inbound),
  account-linking, withdraw-invite, recover-replies, expire-invites,
  resolve-telegram-users. **Ninguna envía un mensaje de campaña.**
- **Escrituras a `campaign_messages.content`**: todas las de producción pasan
  por `autoNormalizePlaceholders` (approve, templates/launch, add-leads,
  edit-flow, messages/[id]) o por approve (referrals/renurture). El resto son
  scripts one-shot **no-senders** cuyo contenido igual pasa por el gate de envío.
- **Scripts ejecutables**: el único que enviaba (`dispatch-pathway-8`) está
  apagado; `create-everest-fake`, `backfill-devera`, `fix-swl-pe-spain-*` no
  llaman a ningún provider.

## 7. Tests (resultados reales)

`npx tsx scripts/test-outbound.mts` → **23 passed, 0 failed**.

- **Francisco**: `Hi {{first_name}}` con `primary_first_name="Francisco"` →
  exactamente `"Hi Francisco, how are you?"`, sin Victor/Joaquin/Carlos/Iñigo.
- **A** (`Hi Victor` para Francisco): `renderPlaceholders` reescribe el saludo a
  `Hi Francisco`; y si se saltara el render, `validateOutboundMessage` bloquea
  con `greeting_name_mismatch`.
- **B** (sin first_name + `{{first_name}}`) → BLOQUEA `unresolved_placeholder`.
- **C** (`[First Name]`) → BLOQUEA `foreign_placeholder`.
- **D** (`{{unknown_token}}`) → BLOQUEA `unresolved_placeholder`.
- **E** retry → salida idéntica.
- **F** 100 leads concurrentes → cada uno con su propio nombre, sin contaminación.
- **G** José María, Iñigo, François, María-José, O'Connor → correctos; saludo
  compuesto (`Hola José` para `José María`) permitido.
- Extra: seller inválido → bloqueado; vacío → bloqueado.

Build: `npx next build` → **EXIT=0, Compiled successfully.**

## 8. GARANTÍA

> **"¿Puede una IA inventar 'Victor' y hacer que un lead llamado Francisco reciba 'Hi Victor'?"**

**NO. Está bloqueado por arquitectura antes del provider**, por tres barreras
independientes:

1. **En generación (n8n)**: el nodo `Fix Greeting Name` reescribe un nombre
   horneado en el saludo → `{{first_name}}` antes de responder.
2. **En escritura (app)**: `autoNormalizePlaceholders` en todos los write paths
   de-hornea el saludo → `{{first_name}}`.
3. **En envío (app)**: `resolveOutbound` → `renderPlaceholders` reescribe
   `Hi Victor` → `Hi {{first_name}}` → `Hi Francisco`; y si algo saltara el
   render, `validateOutboundMessage` bloquea con `greeting_name_mismatch`
   (el nombre del saludo ≠ `primary_first_name` del lead) y la fila va a
   `failed`, **no se envía**.

La única forma de que un lead reciba un nombre literal en el saludo es que ese
nombre **sea efectivamente el suyo** (`namesMatch`, tolerante a
acentos/mayúsculas y a nombres compuestos). Verificado por los tests A y
Francisco. No es "muy improbable": es un bloqueo determinístico.
