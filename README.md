# SWL Growth Engine — CRM

CRM de prospección outbound multi-tenant. Los leads entran por CSV/XLSX, se
califican contra un ICP, y un orquestador en n8n decide qué canal usar y cuándo
(LinkedIn, email, llamada, WhatsApp). Cada respuesta del lead se clasifica con
AI: positiva → Odoo, negativa → `closed_lost`, pregunta → auto-respuesta.

- **Producción:** rama `main` del remote `swlcrm`, deployada en Vercel.
- **Contexto completo del proyecto:** `../CLAUDE.md` y `../PDFs/Source-Docs/PROYECTO_CRM_REGLAS.md`.
- **Antes de escribir código:** leer `AGENTS.md` — este Next.js es 16.x y tiene
  breaking changes respecto de lo que la mayoría conoce.

## Stack

| Capa | Qué |
|---|---|
| App | Next.js 16.2.2 (App Router) · React 19 · TypeScript · Tailwind CSS 4 |
| DB / Auth | Supabase (Postgres + RLS multi-tenant) |
| Automatizaciones | n8n self-hosted — toda la generación de AI para outreach pasa por acá |
| Envíos LinkedIn | Unipile · **Email** Instantly · **Llamadas** Aircall (manuales) |
| CRM destino | Odoo (sólo leads positivos) |

## Arrancar

```bash
npm ci
cp .env.example .env.local     # completar; ver comentarios del archivo
npm run dev                    # http://localhost:3000
```

⚠️ El `.env.local` que ya está en los worktrees apunta al Supabase **local**
(127.0.0.1), no a prod. Para levantar contra los datos hosted en modo lectura:

```bash
npm run dev:prod-readonly      # puerto 3002
```

## Estructura

```
app/            App Router. Una carpeta por sección + app/api/ (183 route handlers)
components/     ~132 componentes. Subcarpetas: ui/ wizard/ icp/ dashboard/
lib/            Lógica de dominio. Cada archivo con nombre de dominio es la
                ÚNICA definición de esa regla — ver "Fuentes de verdad" abajo
scripts/        Tests, verificadores y operaciones one-shot (ver scripts/README.md)
supabase/       Migraciones SQL (ver supabase/migrations/README.md)
public/         Assets estáticos
docs/           Docs técnicas, auditorías y reportes de la app
proxy.ts        Middleware de Next 16 (antes middleware.ts)
```

### Fuentes de verdad (no duplicar estas reglas en otro lado)

| Archivo | Regla que define |
|---|---|
| `lib/lead-outcome.ts` | Clasificación de resultado del lead. `/leads` y `/results` llaman a esta misma función |
| `lib/i18n-locale.ts` | Definición de locale. Agregar un idioma NO requiere migración |
| `lib/require-scope.ts` | Scoping por tenant en los route handlers. Sin esto → IDOR cross-tenant |
| `lib/metric-defs.ts` | Definición de cada métrica del dashboard |
| `lib/placeholders.ts` | Placeholders de mensajes |
| `lib/supabase-bulk.ts` | Lecturas/escrituras masivas — usar esto, no `.range()` a mano |
| `lib/console-data.ts` | Forma de los datos del dashboard nuevo |

## Tests y CI

```bash
npm test          # 10 suites de lógica pura. Gate duro: tienen que estar verdes
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run ratchet   # falla si crecieron los errores de tipo o de lint
```

Las suites de `npm test` no son cobertura general: pinean exactamente las reglas
que **ya rompieron producción** (nombres ajenos en outbound, i18n, lifecycle del
lead, identidad de llamadas, sender pool de Instantly). Si tocás una de esas,
el test es la especificación.

CI (`.github/workflows/ci.yml`) corre tests + ratchet + build en cada push y PR.

### Por qué hay un ratchet en vez de un gate duro

`next.config.ts` tiene `typescript: { ignoreBuildErrors: true }` — el build de
Vercel **no valida tipos** y nunca lo hizo. Hoy hay 42 errores de tipo y 1195 de
lint acumulados. Ponerlos como gate duro dejaría CI rojo para siempre.
`scripts/ci-ratchet.mts` congela esos números en `scripts/ci-baseline.json` y
falla sólo si crecen. Cuando arreglás errores, bajá el baseline:

```bash
npm run ratchet:update
```

## Deploy

```bash
git push swlcrm <sha>:main     # PROD
```

- **Nunca** deployar a prod sin aprobación explícita del usuario.
- Un concern por commit. Hay clientes vivos con datos reales en esta base.
- `/api/health` dice qué commit está corriendo.
- Los crons están declarados en `vercel.json`, no en un scheduler externo.

## Base de datos

Migraciones en `supabase/migrations/`. **Se aplican a mano** por la Management
API; no hay runner ni ledger de qué está aplicado en prod. Leer
`supabase/migrations/README.md` antes de agregar una.

⚠️ **PostgREST corta en 1000 filas** con `max_rows=1000`. Un `.range(0, 49999)`
trunca en silencio y te da métricas subcontadas — ya pasó, subcontaba 95%.
Paginar de a ≤1000 con `ORDER BY` estable, o usar `lib/supabase-bulk.ts`.

## Worktrees

Este directorio es uno de varios worktrees del mismo repo, todos bajo `../`.
**Otras sesiones pueden estar trabajando en ellos al mismo tiempo**: nunca
hacer `stash`, `checkout` ni cambio de rama en un worktree que no sea el propio.
Ver `../README.md` para el mapa.

## Leyes del proyecto

- La generación de AI para outreach va **por n8n**, nunca Next.js → Anthropic/OpenAI directo.
- Las campañas se crean **sólo** desde `/campaigns`. Un ICP por campaña.
- Las llamadas son **manuales**. No hay auto-dial.
- Los leads entran **sólo por la app**, nunca por SQL directo.
- Datos no informados van **en blanco**. Nada de rellenar con valores inventados.
- Cualquier respuesta del lead **corta** el flujo. No hay reanudación automática.
