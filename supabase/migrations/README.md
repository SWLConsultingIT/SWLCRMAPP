# Migraciones

56 archivos SQL. Se aplican **a mano** contra el proyecto Supabase
`uljoengwmmwdqpcxnbjs` por la Management API:

```bash
curl -s -X POST \
  https://api.supabase.com/v1/projects/uljoengwmmwdqpcxnbjs/database/query \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H 'Content-Type: application/json' \
  -d "{\"query\": $(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' 020_foo.sql)}"
```

La service key **no puede hacer DDL** — hace falta el PAT de la Management API.

## ⚠️ Lo que este directorio NO tiene

**No hay runner ni ledger.** No existe `supabase/config.toml`, no se usa el CLI
de Supabase, y no hay tabla de migraciones aplicadas. Es decir: **no hay forma
de saber, mirando el repo, qué está aplicado en producción.** Un archivo acá
puede estar aplicado, a medio aplicar, o nunca haberse corrido.

Casos conocidos de drift al 2026-09-10:
- `edit_flow_step_messages()` — la función se usa pero la migración nunca se aplicó.
- `calls.coach_locale` — la columna hace falta y la migración está pendiente.

Mientras no haya runner, **anotar cada aplicación en `APPLIED.md`** en el mismo
commit que agrega la migración. Es un ledger a mano, pero es mejor que nada.

## Convención de nombres

Hay dos, y conviven mal:

| Convención | Rango | Cantidad |
|---|---|---|
| `NNN_descripcion_YYYY-MM-DD.sql` | `001_…2026-04-21` → `047_…2026-06-19` | 46 |
| `YYYYMMDD_descripcion.sql` | `20260505_…` → `20260910_…` | 10 |

Dos problemas concretos:

1. **Corrieron en paralelo.** `20260505_multi_company_memberships.sql` se creó
   más de un mes *antes* que `047_referral_capture_2026-06-19.sql`, pero ordena
   *después* alfabéticamente. **El orden del directorio no es el orden de
   aplicación.** Si alguna vez se replaya el directorio de cero contra una base
   nueva, va a fallar.
2. **Falta el `014`.** La secuencia va 001→047 con un hueco. No se sabe si
   existió y se perdió, o si nunca se usó ese número.

**De acá en adelante: `YYYYMMDD_descripcion.sql`.** La fecha ordena bien, no
requiere coordinar un contador entre ramas (que fue lo que produjo el hueco), y
es lo que ya se venía usando desde junio. No renombrar las viejas: los nombres
están referenciados en docs y en memoria.

## Reglas

- Toda migración es **idempotente**: `IF NOT EXISTS`, `DROP … IF EXISTS`, `ON CONFLICT`.
- Toda tabla nueva con datos de tenant necesita **RLS con política explícita**.
  RLS activado sin políticas no bloquea al service role pero deja la tabla
  invisible para los usuarios — trampa conocida.
- Las políticas de admin necesitan `is_auth_admin() OR …`, no sólo el check de tenant.
- Antes de agregar una FK a una tabla que ya tiene una hacia el mismo destino:
  PostgREST tira `PGRST201` (ambigüedad de embed) y deja páginas en blanco.
  Si pasa, borrar la FK sobrante y `NOTIFY pgrst, 'reload schema'`.
