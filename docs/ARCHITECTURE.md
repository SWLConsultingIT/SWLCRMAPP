# Arquitectura — SWL Growth Engine

> Estado: **en migración**. `features/activities/` es el primer módulo migrado
> y es el ejemplo canónico. El resto del código sigue en `app/`, `components/`
> y `lib/` planos, y se migra por fases. Si algo de acá no matchea el disco,
> gana el disco — y corregí este archivo en el mismo commit.

## Las cuatro capas

```
app/            routing y composición de Next. Nada más.
features/       un módulo por dominio de negocio.
integrations/   todo lo que habla con un servicio externo.   (todavía no creada)
shared/         lo que usan 2+ dominios de verdad.           (todavía no creada)
```

Hoy `shared/` e `integrations/` viven de hecho en `lib/` y `components/`. Se
formalizan en fases posteriores; hasta entonces un feature importa de `lib/`
y eso es correcto, no deuda.

## Dirección de dependencias

```
app/  ──────────────►  features/  ──────────────►  shared/
                            │                          ▲
                            └──────►  integrations/ ────┘
```

Reglas, en orden de importancia:

1. **`shared/` nunca importa de `features/`.** Si algo en shared necesita un
   dominio, no era shared.
2. **`integrations/` no contiene UI.** Un wrapper de proveedor no renderiza.
3. **Un feature puede importar de `shared/` y de `integrations/`.**
4. **Entre features, una sola dirección por par.** Leads puede importar de
   Activities; entonces Activities no importa de Leads. Si hacen falta las dos,
   lo que se comparte sube a `shared/`.
5. **`app/` no tiene lógica de negocio.** Una page o un route handler hace
   auth, parseo, composición y respuesta. Las reglas viven en el feature.
6. **Sin barrels grandes.** `components/ui/index.ts` es la única excepción y no
   crece.

## Anatomía de un feature

`features/activities/` es el molde:

```
features/activities/
  components/    UI del dominio. Client components.
  lib/           reglas puras, sin DB ni framework. Es lo que testean los tests.
  server/        acceso a datos y efectos. Sin imports de Next.
  tests/         las suites que pinean las reglas de lib/.
```

Qué va en cada carpeta:

| Carpeta | Criterio | Ejemplo real |
|---|---|---|
| `lib/` | función pura, testeable sin DB | `bucketActivity()`, `wallTimeToUtcIso()` |
| `server/` | toca Supabase o dispara efectos | `runActivityReminders()`, `logActivityEvent()` |
| `components/` | React del dominio | `ActivityComposer`, `WhenScheduler` |
| `tests/` | pinea una regla de `lib/` | `test-activities.mts` |

`server/` no importa `next/server`. Devuelve datos o `{ status, body }` y la
ruta lo convierte en `Response`. Así el transporte cambia sin tocar las reglas.

## Dónde pongo cada cosa

**Una feature nueva** → `features/<dominio>/`, con las cuatro carpetas. No
crear `types/` salvo que haya tipos que no pertenezcan a un solo archivo.

**Una integración nueva** → `integrations/<proveedor>/`. Sin UI adentro. Si la
integración necesita un componente (un botón de "conectar"), el componente vive
en el feature que lo usa y llama al wrapper.

**UI compartida** → `shared/ui/` sólo cuando **2+ dominios ya la usan**. Uno
solo no alcanza. No se abstrae por anticipado: en esta migración
`WhenScheduler` se quedó en Activities justamente por esto — tiene cuatro
consumidores, pero los cuatro son consumidores de Activity.

**Una API route** → se queda en `app/api/...`, con la URL que ya tiene. El
cuerpo delega en `features/<dominio>/server/`. Las URLs no se mueven cuando se
ordenan carpetas.

## Ejemplo end-to-end: el cron de recordatorios

```ts
// app/api/cron/activity-reminders/route.ts  — 28 líneas
export const dynamic = "force-dynamic";   // el segment config NO se reexporta:
export const maxDuration = 60;            // tiene que quedarse en app/

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { status, body } = await runActivityReminders();
  return NextResponse.json(body, { status });
}
```

```ts
// features/activities/server/reminders.ts — las reglas, sin Next
export async function runActivityReminders(): Promise<ReminderRunResult> { … }
```

La ruta tiene el gate y el transporte. El feature tiene la regla de qué
activity está vencida, el claim que la hace disparar una sola vez, y qué dice
el recordatorio.

## Boundaries registradas

- **Notificaciones no son de Activities.** `reminders.ts` es *consumidor* de la
  tabla `notifications`, de `lib/web-push` y de SMTP. La infra de notificación
  no se mudó adentro del feature.
- **Activities ↔ Calls.** Hoy `LeadActivitiesPanel` y `HeroNextAction` importan
  `components/CallButton`, y `components/CallOutcomePrompt` importa
  `ActivityComposer`. Las dos direcciones existen. No es un ciclo a nivel
  archivo, pero sí a nivel dominio: se resuelve cuando se migre Calls, subiendo
  lo común o invirtiendo con composición.
- **Activities → Dashboard.** `activities.ts` importa `businessToday` y
  `businessDayStartMs` de `lib/metric-defs.ts`. Son primitivas de día hábil,
  no métricas: su lugar es `shared/lib/`, no el dominio Dashboard.

## Lo que NO cambió y no debe cambiar

- Las URLs. 251 rutas vivas (182 API + 69 páginas) antes y después.
- Los contratos de API: payloads, status codes, seguridad.
- El schema: `activities`, `activity_events`, `due_tz`,
  `reminder_offset_minutes`, `source`, `source_reference_id`.
- `npm test` como gate duro y el ratchet como gate blando.
