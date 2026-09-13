# scripts/

Dos cosas distintas, separadas a propósito.

## `scripts/*` — herramientas vivas

Se corren de nuevo, forman parte del flujo de trabajo.

| Archivo | Qué hace |
|---|---|
| `test-*.mts` (8) | Suites de lógica pura. Las corre `npm test`. **Gate duro de CI.** Las 2 de Activities viven en `features/activities/tests/`, junto al dominio que pinean. |
| `ci-ratchet.mts` · `ci-baseline.json` | Mide tipos y lint contra un baseline congelado; falla si la deuda crece. `npm run ratchet` |
| `verify-*.mts` | Verificadores de consistencia de datos (llamadas, métricas del dashboard). Lectura, no escriben. |
| `consistency-calls.mts` · `shadow-calls.mts` · `calls-visible-snapshot.mts` | Diagnóstico del modelo de identidad de llamadas. |
| `qa-console.mts` · `_console-contract.mts` | Contrato de datos del dashboard console. |
| `render-reconcile.mts` · `run-reconciler.mts` · `_render-harness/` | Validación visual de renderizado. |
| `capture-authenticated.mts` | Screenshots con sesión autenticada. `npm run capture:auth` |
| `audit-placeholder-drift.mjs` | Audita drift de placeholders en mensajes. |
| `backfill-3a2.mts` · `backfill-calls-identity-dryrun.mts` | Backfills con dry-run. |

Los `test-*.mts` **no** son cobertura general: pinean las reglas que ya rompieron
producción (nombres ajenos en outbound, i18n, lifecycle del lead, identidad de
llamadas, sender pool). Si tocás una de esas reglas, el test es la especificación.

## `scripts/ops/` — operaciones one-shot, ya ejecutadas

53 archivos. Cada uno se escribió para arreglar o migrar datos de **un cliente
específico en una fecha específica**, se corrió una vez, y no se vuelve a correr.
Están acá para dejar constancia de qué se le hizo a los datos de quién, no para
reutilizarse.

**No correr nada de `ops/` sin leerlo entero primero.** Varios hacen borrados
masivos (`arqy-full-delete-flows`, `remove-devera-relost-readds`,
`close-pathway-locked`). Los `*.backup.json` al lado de un script son el estado
previo a esa operación: **no borrarlos**, son la única forma de revertir.

Clientes que aparecen: Pathway (ex-cliente, offboardeado), De Vera Grill,
Gruppo Everest, Arqy, Cacer, SWL PE&VC Spain.

### Si tenés que escribir uno nuevo

1. Nombrarlo `<accion>-<cliente>-<YYYY-MM-DD>.mjs` y ponerlo en `ops/`.
2. Dry-run primero, siempre. Imprimir qué va a tocar antes de tocarlo.
3. Volcar el estado previo a `<mismo-nombre>.backup.json`.
4. Escrituras multi-lead: pedir OK por batch. Hay clientes vivos en esta base.
5. Los leads entran **sólo por la app**. Un script no importa leads.

⚠️ El `.env.local` de los worktrees apunta al Supabase **local**. Un script que
lo lea da ECONNREFUSED o 401 contra prod: pasar host hosted + service key a mano.
