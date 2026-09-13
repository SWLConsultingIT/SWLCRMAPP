# Fase 3B — inventario de llamadas inline a proveedores

> Generado al cerrar la Fase 3A. **Nada de esto se tocó todavía.** Es el mapa
> para decidir el orden de extracción, no una lista de tareas aprobadas.

La Fase 3A movió los **17 wrappers que ya existían**. Lo que queda son llamadas
armadas a mano dentro de route handlers: base URL, headers de auth, parseo de
respuesta y manejo de error, repetidos en cada sitio.

## Clasificación

| Clase | Qué significa |
|---|---|
| **ALREADY WRAPPED** | Ya hay un primitive en `integrations/` que hace esto |
| **EASY EXTRACTION** | El fetch está aislado; se extrae sin tocar lógica de negocio |
| **INTERLEAVED** | El fetch está entremezclado con decisiones de dominio |
| **HIGH RISK** | Toca envíos reales a clientes vivos |

## Por proveedor

### MAPS · 2 archivos — `EASY EXTRACTION`
`leads/[id]/nearby-companies`, `leads/[id]/place-detail`. Google Places, 2 fetch
cada uno, sin estado. **El mejor primer candidato**: si el patrón de extracción
falla acá, no se perdió nada.

### WHATSAPP · 1 archivo — `EASY EXTRACTION`
`cron/dispatch-whatsapp`, 1 fetch a graph.facebook.com. Ojo: es envío real.

### AIRCALL · 13 archivos — `EASY` + `INTERLEAVED`
Los pesados son `aircall/webhook` (16 fetch) y `aircall/sync` (9), que mezclan
llamadas a Aircall con lecturas REST a Supabase y reconciliación. Los livianos
(`numbers`, `admin/aircall-*`, `settings/aircall-pool`, 1 fetch cada uno) son
extracción directa. `components/CallButton` y `CampaignDetailClient` llaman
desde el cliente: ahí el primitive tiene que quedar del lado del server.

### INSTANTLY · 8 archivos — `ALREADY WRAPPED` en su mayoría
`integrations/instantly/` ya tiene config, campaign-pool, flow-campaign y el
guard. Lo que queda inline (`inbox/reply` 6 fetch, `cron/recover-replies` 3,
`accounts/page` 3) debería poder usar esos primitives casi tal cual.
⚠️ `proxy.ts` tiene 1 fetch a Instantly: es middleware, va con cuidado propio.

### N8N · 9 archivos — `INTERLEAVED`
No hay cliente: cada sitio arma la URL del webhook y el header. Un
`integrations/n8n/callWebhook()` cubriría los 9. Pero acá adentro está la LEY de
que toda la generación con IA pasa por n8n, así que cada call site hay que
leerlo, no reemplazarlo mecánicamente.

### UNIPILE · 11 archivos — `HIGH RISK`
**Lo último que se toca.** Acá viven los envíos de LinkedIn.
`inbox/reply` (6 fetch), `cron/dispatch-queue` (4), `unipile/hosted-link` (4),
`cron/recover-replies` (3). `integrations/unipile/linkedin.ts` ya tiene los
contratos correctos (v1, X-API-KEY, fallback api21) y los usan expire-invites,
withdraw y linkedin-recovery: **ese es el modelo a seguir**, no inventar otro.
Mirar `resolveOutbound` y el blindaje de nombres antes de tocar nada.

### AI · 17 archivos — `INTERLEAVED`
No existe ningún wrapper. 13 archivos usan el SDK `@anthropic-ai/sdk` directo y
4 hacen fetch a `api.openai.com`. `callHaiku()` está reimplementada 3 veces en
los endpoints de tailoring. Extraer un `integrations/ai/` es viable, pero la
consolidación de las 3 implementaciones cambia retries y prompts: eso es una
decisión de producto, no un movimiento.

### SUPABASE REST · 17 archivos — `INTERLEAVED`
Fetch crudo a `/rest/v1` en vez del cliente. Es donde se cuela el techo de 1000
filas de PostgREST. `integrations/supabase/bulk.ts` ya resuelve la paginación;
migrar cada sitio es un archivo por commit, verificando el conteo antes y
después.

## Orden propuesto, de menor a mayor riesgo

1. **maps** (2) — ensayo del patrón
2. **aircall livianos** (5 archivos de 1 fetch)
3. **instantly restantes** (5) — ya hay primitives
4. **n8n** (9) — un `callWebhook()`, leyendo cada call site
5. **supabase REST** (17) — un archivo por commit
6. **aircall pesados** (webhook + sync)
7. **ai** (17) — mover primero, consolidar después
8. **unipile** (11) — al final, con el envío real de por medio
9. **whatsapp** (1) — envío real, suelto
