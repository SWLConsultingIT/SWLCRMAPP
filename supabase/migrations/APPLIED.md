# Ledger de migraciones aplicadas

Registro manual de qué migración se aplicó a producción y cuándo. Existe porque
no hay runner: sin esto no hay forma de saber el estado real de la base.

**Regla: agregar la fila en el mismo commit que agrega la migración.** Si la
aplicaste y no la anotaste, la próxima persona no tiene manera de saberlo.

| Migración | Aplicada en prod | Fecha | Notas |
|---|---|---|---|
| _(las 56 anteriores al 2026-09-10)_ | ❓ desconocido | — | Se aplicaron a mano sin registro. Estado no reconstruible desde el repo. |

## Drift conocido al 2026-09-10

| Qué | Estado |
|---|---|
| `edit_flow_step_messages()` | La función se usa en la app pero la migración **nunca se aplicó**. |
| `calls.coach_locale` | Columna necesaria para el locale del coaching. **Migración pendiente de escribir.** |

## Cómo reconstruir el estado real (pendiente, no hecho)

Comparar el schema vivo contra lo que las migraciones deberían haber producido:

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

Volcar eso a `supabase/schema-snapshot.sql` y diffearlo contra el resultado
esperado de replayar `migrations/`. Hasta que alguien haga ese trabajo, la
columna "Aplicada en prod" de arriba queda en ❓ y hay que verificar a mano
antes de asumir que algo existe.
