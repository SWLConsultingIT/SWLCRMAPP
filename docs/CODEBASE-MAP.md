# Mapa del código — SWL Growth Engine

> Generado contra `chore/repo-architecture-activities`, base `swlcrm/main 1a41e69a`.
> 790 archivos versionados · 547 `.ts/.tsx` · 251 URLs vivas.

## Estado de la migración

| Dominio | Archivos | Estado | Ubicación |
|---|---:|---|---|
| **integrations** | 19 | ✅ **wrappers migrados** (Fase 3a) | `integrations/` |
| **shared** | 30 | ✅ **migrado** (Fase 2) | `shared/` |
| **Activities** | 14 | ✅ **migrado** (Fase 1) | `features/activities/` |
| Leads | ~64 | pendiente | `app/leads/`, `components/lead/`, `components/Lead*`, `lib/lead-*` |
| Companies | ~22 | pendiente | `app/companies/`, `components/company/` |
| Inbox | ~18 | pendiente | `components/Inbox*`, `app/api/inbox/` |
| Outreach / Campaigns | ~77 | pendiente | `app/campaigns/`, `app/queue/`, `app/icp/`, `lib/flow-metrics-*` |
| Calls | ~32 | pendiente | `components/Call*`, `app/api/aircall/`, `lib/metrics/calls-*` |
| Results | ~14 | pendiente | `app/results/`, `app/opportunities/`, `lib/lead-outcome.ts` |
| Sellers | ~7 | pendiente | `app/dashboard/seller/`, `app/api/sellers/` |
| Dashboard / Metrics | ~87 | pendiente | `app/dashboard*/`, `components/dashboard/`, `lib/*-data.ts` |
| Admin / Auth | ~98 | pendiente | `app/admin/`, `app/api/admin/`, `lib/scope.ts` |
| Notifications | ~4 | pendiente | `components/Notification*`, `lib/web-push.ts` |
| i18n | 5 | ✅ → `shared/i18n/` | 201 consumidores |

## features/activities/ — el módulo de referencia

```
features/activities/
├── components/
│   ├── ActivitiesWorkspace.tsx   contenedor de /activities (lista + board + composer)
│   ├── ActivitiesList.tsx        vista lista
│   ├── ActivitiesBoard.tsx       vista kanban por bucket
│   ├── ActivityComposer.tsx      ÚNICO composer del repo. 4 consumidores.
│   ├── WhenScheduler.tsx         selector de vencimiento + recordatorio
│   ├── LeadActivitiesPanel.tsx   las activities de un lead (lead detail)
│   └── HeroNextAction.tsx        la próxima acción, dentro del Lead Hero
├── lib/
│   ├── activities.ts             tokens canónicos, bucket, wall-time ↔ UTC, ACTIVITY_SELECT
│   ├── activity-presets.ts       presets de "cuándo" (hoy 17h, mañana 9h, …)
│   └── create-activity.ts        wrapper de transporte del POST
├── server/
│   ├── activities-server.ts      logActivityEvent → activity_events
│   └── reminders.ts              runActivityReminders (el cron)
└── tests/
    ├── test-activities.mts       37 asserts — bucket, timezone, validación
    └── test-activity-presets.mts 24 asserts — presets, DST, timezone de vencimiento
```

### Rutas que sirve (sin cambios)

| URL | Archivo en `app/` | Delega en |
|---|---|---|
| `/activities` | `app/activities/page.tsx` | `ActivitiesWorkspace`, `lib/activities` |
| `GET/POST /api/activities` | `app/api/activities/route.ts` | `lib/activities`, `server/activities-server` |
| `PATCH /api/activities/[id]` | `app/api/activities/[id]/route.ts` | idem |
| `GET/POST /api/cron/activity-reminders` | `app/api/cron/activity-reminders/route.ts` | `server/reminders` |

### Quién consume el feature desde afuera

```
app/activities/page.tsx                   ─┐
app/api/activities/**                      │
app/api/leads/[id]/call-outcome/route.ts   ├─► features/activities/
app/leads/[id]/page.tsx                    │
app/companies/[name]/page.tsx              │
components/lead/LeadHero.tsx               │   (leads → activities)
components/lead/LeadOverview.tsx           │   (leads → activities)
components/CallOutcomePrompt.tsx          ─┘   (calls → activities)
```

### Qué importa el feature hacia afuera

| Destino | Qué es | Futuro |
|---|---|---|
| `shared/design/tokens`, `shared/i18n/*`, `shared/ui/toast` | tokens, traducción, toasts | ✅ ya en shared |
| `lib/supabase-service.ts` | cliente service-role | → `integrations/supabase/` |
| `lib/web-push.ts` | push del navegador | → `integrations/push/` |
| `shared/lib/timezone` | timezone del prospect | ✅ ya en shared |
| `lib/lead-label.ts` | label del lead | → `features/leads/` |
| `shared/lib/business-time` | `businessToday`, `businessDayStartMs` | ✅ extraído de metric-defs en la Fase 2 |
| `integrations/supabase/service` | cliente service-role | ✅ ya en integrations |
| `components/CallButton.tsx` | botón de llamar | → `features/calls/` |

## Archivos que el nombre sugiere Activities y NO lo son

| Archivo | Dominio real |
|---|---|
| `components/ActivityWidget.tsx` | Admin — presencia de usuarios (`last_seen_at`) |
| `components/dashboard/ActivityStrip.tsx` | Dashboard — sparkline de outreach 30d |
| `lib/overdue.ts` | Outreach — lo usan CampaignDetail y Queue |

## Deuda conocida

- `next.config.ts` tiene `typescript: { ignoreBuildErrors: true }`: el build de
  Vercel no valida tipos. El gate real es `npm test` + `npm run ratchet` en CI.
- Baseline congelado: **42** errores de tipo, **1183** de lint, **306** warnings.
- Las migraciones de `supabase/migrations/` se aplican a mano; ver `APPLIED.md`.
- `npm run boundaries` reporta 1 warning conocido: `scripts/qa-console.mts`
  importa `app/dashboard-console/tabs-data.ts`. Se resuelve con Dashboard.
- 3 lugares leen/escriben la tabla `activities` fuera del feature:
  `app/leads/[id]/page.tsx`, `app/companies/[name]/page.tsx` y
  `app/api/leads/[id]/call-outcome/route.ts`.
