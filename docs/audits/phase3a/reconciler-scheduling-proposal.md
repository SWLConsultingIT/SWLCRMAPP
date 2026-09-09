# reconcile-calls — scheduling proposal (Phase 3A.2 §9)

**Status: NOT IMPLEMENTED.** Project rules require a backup and explicit
approval before touching an n8n workflow, so this documents exactly what to
build. Nothing was created or modified.

## What is being scheduled

`GET /api/cron/reconcile-calls` on `https://swlcrmapp.vercel.app`.

It sweeps the last 48 h of `calls`, applies only HIGH-confidence Mutual
Unique Best Matches, and writes **one column** (`calls.canonical_call_id`)
plus an audit row in `calls_recon_log`. It is idempotent: a pair already
sharing an identity is not a candidate, so a re-run links nothing.

Query parameter: `?hours=<n>` overrides the 48 h lookback.

## Auth

The route accepts **either** an admin session **or**
`Authorization: Bearer $CRON_SECRET`. It denies when neither is present, and
denies outright if `CRON_SECRET` is unset — it is never open.

The scheduler must send:

```
Authorization: Bearer {{$env.CRON_SECRET}}
```

Never hardcode the secret in the workflow JSON.

---

## Option A — Vercel cron (recommended)

`vercel.json` already exists in this repo (added by the Activities work) and
already carries a cron. Vercel injects the `Authorization: Bearer
$CRON_SECRET` header automatically, which is exactly what the route expects,
so there is no secret to wire by hand and nothing to keep in sync.

```json
{
  "crons": [
    { "path": "/api/cron/activity-reminders", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/reconcile-calls",    "schedule": "0 * * * *" }
  ]
}
```

Caveats: the route's `maxDuration` is 60 s (enough — the 48 h sweep scans
~160 rows), and Vercel cron gives no retry. Given idempotency, a missed hour
is simply picked up by the next one, so retry is not needed for correctness.

## Option B — n8n (as requested)

Workflow name must start with `SWL - CRM` per project rules. Suggested:
`SWL - CRM SUPABASE - Reconcile Calls`.

| Node | Type | Configuration |
|---|---|---|
| 1. Schedule | Schedule Trigger | Cron `0 * * * *` (hourly, on the hour) |
| 2. Call reconciler | HTTP Request | `GET https://swlcrmapp.vercel.app/api/cron/reconcile-calls`<br>Header `Authorization: Bearer {{$env.CRON_SECRET}}`<br>Timeout **55000 ms** (under the route's 60 s `maxDuration`)<br>Retry on fail: **2 attempts, 60 s apart**<br>`neverError: false` so a non-2xx reaches the error branch |
| 3. Log | Set / NoOp | Keep `linked`, `already_linked`, `high_confidence_pairs`, `rows_scanned`, `failed`, `window_hours` from the JSON body |
| 4. Alert on failure | Error Trigger branch | Notify when `failed > 0` or the HTTP node errors |

Retry is safe **because the endpoint is idempotent** — a retry after a
partial run re-links nothing already linked.

### Response shape to log

```json
{
  "ok": true,
  "window_hours": 48,
  "rows_scanned": 160,
  "high_confidence_pairs": 3,
  "linked": 0,
  "already_linked": 3,
  "failed": 0
}
```

### What to watch

- `linked` — steady low single digits is healthy. A sudden spike means the
  live webhook linking regressed.
- `failed > 0` — alert. Should always be 0.
- `high_confidence_pairs` growing while `linked` stays 0 — impossible unless
  the same pairs keep failing; alert.
- **Ambiguous count is NOT in this response.** It is deliberately not acted
  on by the sweep. To track it, run
  `npx tsx scripts/backfill-3a2.mts` (dry, read-only), which reports
  ambiguous / not-mutual / MEDIUM counts.

## Frequency

Hourly, as requested. The webhook links in real time, so the sweep is a
safety net for out-of-order arrivals; the 48 h lookback means an hourly
cadence re-examines each call ~48 times before it ages out. That is
comfortably redundant and costs ~160 rows scanned per run.
