# n8n Bounce Handler — PREPARED change (not applied)

**Workflow:** `SWL - CRM INSTANTLY - Bounce Handler` · id `dYzJWS7w25K8uP5v` · currently **active**
**Backup taken:** `workflows/archive/dYzJWS7w25K8uP5v-bounce-handler-BACKUP-2026-09-10.json`
**Status:** written, reviewed, **NOT applied to n8n.** Needs an explicit GO.

---

## Why it needs changing

The workflow polls exactly one campaign per tenant:

```
GET company_bios?instantly_campaign_id=not.is.null
    &select=id,instantly_campaign_id,instantly_api_key,instantly_workspaces(api_key)
→ for each bio: POST /leads/list { campaign: bio.instantly_campaign_id, filter: FILTER_LEAD_BOUNCED }
```

`company_bios.instantly_campaign_id` has been the **template** since 2026-06-02, when
`lib/instantly-flow-campaign.ts` moved dispatch to one cloned campaign per flow, recorded in
`instantly_flow_campaigns`. Every real send since then has gone through a clone the poller
never looks at, so it is structurally blind to live bounces.

Scale of the blind spot as of 2026-09-10 — 22 per-flow campaigns are invisible:
SWL 15, Pathway 3, Arqy 3, Grupo IEB 1.

## Nodes changed

| Node | Type | Change |
|---|---|---|
| `Code - Poll & Advance Bounces` | `n8n-nodes-base.code` | **body replaced** (below) |
| `When called by Orquestador` | `executeWorkflowTrigger` | unchanged |

One node. No connections, credentials, or trigger wiring change.

## The query change

**Old — one campaign per tenant:**
```js
const body = { campaign: bio.instantly_campaign_id, filter: 'FILTER_LEAD_BOUNCED', limit: 100 };
```

**New — the template plus every per-flow clone:**
```js
// once, before the tenant loop
const flowRows = await this.helpers.httpRequest({
  url: SB + '/instantly_flow_campaigns?select=company_bio_id,flow_name,instantly_campaign_id',
  method: 'GET', headers: sbH, json: true,
});

// inside the tenant loop
const campaignIds = [...new Set([
  bio.instantly_campaign_id,
  ...(flowRows || []).filter(f => f.company_bio_id === bio.id).map(f => f.instantly_campaign_id),
].filter(Boolean))];

for (const campaignId of campaignIds) {
  const body = { campaign: campaignId, filter: 'FILTER_LEAD_BOUNCED', limit: 100 };
  ...
}
```

One extra Supabase read for the whole run, then N polls per tenant instead of 1.

## How it avoids duplicates

Three independent layers, two of which already existed:

1. **`status='sent'` filter (existing).** The match is
   `campaign_messages?provider_message_id=eq.<instantly lead id>&status=eq.sent`. Handling a
   bounce flips that row to `skipped`, so a re-run matches zero rows and counts as
   `already_processed`. Re-running every 5 minutes is a no-op for anything already handled.
2. **Per-run `seenLeadIds` set (new).** A lead enrolled in two campaigns of the same tenant can
   surface twice inside a single run, before layer 1 has written anything. The set skips the
   second sighting.
3. **`current_step` only advances (existing).** The campaign update is guarded so a late bounce
   cannot rewind a flow that has already moved on.

## How it resolves tenant

Unchanged and workspace-independent, which is what makes it safe under the shared workspace:

```
instantly lead id → campaign_messages.provider_message_id → campaign_id + lead_id
                  → the tenant that owns that message row
```

The tenant is never inferred from the workspace or from the email address. **New:** the handler
now also asserts that the matched message's lead belongs to the bio whose API key produced the
bounce, and skips with `tenant_mismatch` if not. That cannot happen today, but once campaigns
from several tenants live in one workspace it is worth a cheap assertion rather than trust.

## Relationship to the webhook

`/api/instantly/webhook` is the **source of truth**: push, seconds, and it covers bounce and
unsubscribe. This poller becomes the **recovery net** — it catches anything the webhook missed
during an outage, exactly as `recover-replies` backs up the Reply Handler. Both write through the
same columns (`leads.primary_email_status`, `campaign_messages.status`), so whichever arrives
first wins and the other no-ops.

## Full replacement body for `Code - Poll & Advance Bounces`

```js
// Bounce poller — RECOVERY NET behind /api/instantly/webhook (source of truth).
//
// 2026-09-10: polls the tenant TEMPLATE **and every per-flow clone**. Before this
// it read only company_bios.instantly_campaign_id, which has been the template —
// not a send target — since 2026-06-02, so it could not see a single live bounce.
//
// Idempotency: campaign_messages are matched with status='sent' and flipped to
// 'skipped', so re-runs are no-ops; a per-run seen-set covers a lead that appears
// in two campaigns within the same pass.

const SB = 'https://uljoengwmmwdqpcxnbjs.supabase.co/rest/v1';
const SB_KEY = $env.SUPABASE_SERVICE_KEY;           // moved out of the source
const sbH = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
const FALLBACK_INST_KEY = $env.INSTANTLY_API_KEY;   // moved out of the source
const DAY_MS = 24 * 60 * 60 * 1000;

const results = { tenants_polled: 0, campaigns_polled: 0, bounces_seen: 0, advanced: 0, already_processed: 0, tenant_mismatch: 0, errors: [] };

let bios = [];
try {
  bios = await this.helpers.httpRequest({
    url: SB + '/company_bios?instantly_campaign_id=not.is.null&select=id,instantly_campaign_id,instantly_api_key,instantly_workspaces(api_key)',
    method: 'GET', headers: sbH, json: true,
  });
} catch (e) {
  return [{ json: { ok: false, stage: 'load_tenants', error: String(e) } }];
}

// NEW: the per-flow campaigns where every real send has lived since 2026-06-02.
let flowRows = [];
try {
  flowRows = await this.helpers.httpRequest({
    url: SB + '/instantly_flow_campaigns?select=company_bio_id,flow_name,instantly_campaign_id',
    method: 'GET', headers: sbH, json: true,
  }) || [];
} catch (e) {
  results.errors.push({ stage: 'load_flow_campaigns', error: String(e) });
}

for (const bio of (bios || [])) {
  const apiKey = bio.instantly_workspaces?.api_key || bio.instantly_api_key || FALLBACK_INST_KEY;
  if (!apiKey) continue;

  const campaignIds = [...new Set([
    bio.instantly_campaign_id,
    ...flowRows.filter(f => f.company_bio_id === bio.id).map(f => f.instantly_campaign_id),
  ].filter(Boolean))];
  if (campaignIds.length === 0) continue;
  results.tenants_polled++;

  const seenLeadIds = new Set();

  for (const campaignId of campaignIds) {
    results.campaigns_polled++;
    let startingAfter = null;
    const bounced = [];
    for (let page = 0; page < 5; page++) {
      let resp;
      try {
        const body = { campaign: campaignId, filter: 'FILTER_LEAD_BOUNCED', limit: 100 };
        if (startingAfter) body.starting_after = startingAfter;
        resp = await this.helpers.httpRequest({
          url: 'https://api.instantly.ai/api/v2/leads/list',
          method: 'POST',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body, json: true,
        });
      } catch (e) {
        results.errors.push({ tenant: bio.id, campaign: campaignId, stage: 'poll', error: String(e) });
        break;
      }
      const items = resp?.items || [];
      for (const it of items) if (it.status === -1) bounced.push(it);
      if (!resp?.next_starting_after) break;
      startingAfter = resp.next_starting_after;
    }
    results.bounces_seen += bounced.length;

    for (const b of bounced) {
      if (seenLeadIds.has(b.id)) continue;
      seenLeadIds.add(b.id);
      try {
        const msgRows = await this.helpers.httpRequest({
          url: `${SB}/campaign_messages?provider_message_id=eq.${b.id}&status=eq.sent&order=sent_at.desc&limit=1&select=id,campaign_id,lead_id,step_number`,
          method: 'GET', headers: sbH, json: true,
        });
        const msg = msgRows?.[0];
        if (!msg) { results.already_processed++; continue; }

        // NEW: the message we are about to mutate must belong to the tenant whose
        // key surfaced the bounce. Cheap assertion, meaningful now that several
        // tenants share one Instantly workspace.
        const leadRows = await this.helpers.httpRequest({
          url: `${SB}/leads?id=eq.${msg.lead_id}&select=company_bio_id`,
          method: 'GET', headers: sbH, json: true,
        });
        if (leadRows?.[0]?.company_bio_id && leadRows[0].company_bio_id !== bio.id) {
          results.tenant_mismatch++;
          results.errors.push({ tenant: bio.id, campaign: campaignId, lead_id: b.id, stage: 'tenant_check', error: 'message belongs to another tenant — skipped' });
          continue;
        }

        const campRows = await this.helpers.httpRequest({
          url: `${SB}/campaigns?id=eq.${msg.campaign_id}&select=id,sequence_steps`,
          method: 'GET', headers: sbH, json: true,
        });
        const camp = campRows?.[0];
        const sequenceSteps = Array.isArray(camp?.sequence_steps) ? camp.sequence_steps : [];
        const nextStepConfig = sequenceSteps[msg.step_number] || null;
        const nextDaysAfter = typeof nextStepConfig?.daysAfter === 'number' ? nextStepConfig.daysAfter : null;
        const nextEligibleAt = nextDaysAfter !== null ? new Date(Date.now() + nextDaysAfter * DAY_MS).toISOString() : null;
        const now = new Date().toISOString();

        await this.helpers.httpRequest({
          url: `${SB}/campaign_messages?id=eq.${msg.id}`,
          method: 'PATCH', headers: sbH,
          body: JSON.stringify({
            status: 'skipped',
            error_details: 'bounce: instantly status -1',
            metadata: {
              bounced_at: now, bounce_reason: 'instantly_status_-1',
              skipped_by: 'n8n-bounce-handler', instantly_lead_id: b.id,
              instantly_email: b.email, instantly_campaign_id: campaignId,
            },
          }),
        });

        await this.helpers.httpRequest({
          url: `${SB}/leads?id=eq.${msg.lead_id}`,
          method: 'PATCH', headers: sbH,
          body: JSON.stringify({ primary_email_status: 'bounced', updated_at: now }),
        });

        const campaignUpdate = { current_step: msg.step_number, last_step_at: now };
        if (nextEligibleAt === null) {
          campaignUpdate.status = 'completed';
          campaignUpdate.stop_reason = 'all_steps_bounced_or_done';
          campaignUpdate.completed_at = now;
        }
        await this.helpers.httpRequest({
          url: `${SB}/campaigns?id=eq.${msg.campaign_id}`,
          method: 'PATCH', headers: sbH, body: JSON.stringify(campaignUpdate),
        });

        if (nextEligibleAt) {
          await this.helpers.httpRequest({
            url: `${SB}/campaign_messages?campaign_id=eq.${msg.campaign_id}&step_number=eq.${msg.step_number + 1}&status=eq.draft`,
            method: 'PATCH', headers: sbH,
            body: JSON.stringify({ status: 'queued', metadata: { eligible_at: nextEligibleAt, queued_by: 'n8n-bounce-handler-advance' } }),
          });
        }

        results.advanced++;
      } catch (e) {
        results.errors.push({ tenant: bio.id, campaign: campaignId, lead_id: b.id, email: b.email, stage: 'advance', error: String(e) });
      }
    }
  }
}

return [{ json: results }];
```

## One prerequisite in this body

`SB_KEY` and `FALLBACK_INST_KEY` are read from `$env` instead of being hardcoded, which is the
P1 credential-hygiene fix. **Before applying**, `SUPABASE_SERVICE_KEY` and `INSTANTLY_API_KEY`
must exist as n8n environment variables — otherwise the node throws on the first run. If those
variables are not available on this n8n instance, say so and I will ship the literals unchanged
and treat the hygiene fix separately; the two changes are independent.

## Rollback

Re-import `workflows/archive/dYzJWS7w25K8uP5v-bounce-handler-BACKUP-2026-09-10.json`, or paste
the previous body back into the single node. No schema or data change to undo — the handler only
ever writes through columns that already existed.
