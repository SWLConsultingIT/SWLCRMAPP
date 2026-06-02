import type { InstantlyConfig } from "@/lib/instantly-config";
import { getSupabaseService } from "@/lib/supabase-service";

// Per-FLOW Instantly campaign resolver (created + activated lazily on first use).
//
// Why per-flow instead of one campaign per tenant: Instantly auto-pauses a
// campaign when its bounce rate spikes (status -2, "Paused due to too many
// recent bounces"). With every flow sharing ONE tenant campaign, a single bad
// list takes down email for ALL flows — exactly what happened to Arqy on
// 2026-06-01 (the Architects list hit 39% bounce and paused Developers +
// Contractors + the Simone demo too). One campaign per flow isolates that:
// a bad list only pauses its own flow.
//
// The new campaign clones schedule + sending inboxes + the passthrough
// sequence ({{subject_line}} / {{personalization}}) from the tenant's template
// campaign (company_bios.instantly_campaign_id), so behaviour is identical —
// just split. Mapping lives in `instantly_flow_campaigns (company_bio_id,
// flow_name → instantly_campaign_id)`.

const BASE = "https://api.instantly.ai/api/v2";

async function inst(apiKey: string, method: string, path: string, body?: unknown) {
  // Instantly v2 returns 400 ("Body cannot be empty when content-type is
  // application/json") on a bodyless request that still carries the JSON
  // content-type — so only set it when we actually send a body. This bit the
  // POST /campaigns/{id}/activate (no body) + DELETE paths.
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const json = await res.json().catch(() => ({} as any));
  return { status: res.status, json };
}

export async function resolveFlowCampaignId(
  config: InstantlyConfig,
  companyBioId: string,
  flowName: string,
  tenantLabel: string,
): Promise<{ campaignId: string | null; error?: string; created?: boolean }> {
  const svc = getSupabaseService();

  // 1. Existing mapping wins.
  const { data: existing } = await svc
    .from("instantly_flow_campaigns")
    .select("instantly_campaign_id")
    .eq("company_bio_id", companyBioId)
    .eq("flow_name", flowName)
    .maybeSingle();
  if ((existing as any)?.instantly_campaign_id) {
    return { campaignId: (existing as any).instantly_campaign_id as string };
  }

  // 2. Need a template campaign to clone schedule + inboxes + sequence from.
  if (!config.campaignId) {
    return { campaignId: null, error: "tenant has no template instantly_campaign_id to clone from" };
  }
  const tmpl = await inst(config.apiKey, "GET", `/campaigns/${config.campaignId}`);
  if (tmpl.status >= 300 || !tmpl.json?.campaign_schedule) {
    return { campaignId: null, error: `template campaign fetch failed: HTTP ${tmpl.status}` };
  }

  // 3. Create the per-flow campaign (name = "<Tenant> — <Flow>").
  const created = await inst(config.apiKey, "POST", "/campaigns", {
    name: `${tenantLabel} — ${flowName}`,
    campaign_schedule: tmpl.json.campaign_schedule,
    sequences: tmpl.json.sequences,
    email_list: tmpl.json.email_list,
    open_tracking: tmpl.json.open_tracking ?? false,
    link_tracking: tmpl.json.link_tracking ?? false,
  });
  if (created.status >= 300 || !created.json?.id) {
    return { campaignId: null, error: `create campaign failed: HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 200)}` };
  }
  const newId = created.json.id as string;

  // 4. Activate so it actually sends (per-flow bounce-protection applies here).
  await inst(config.apiKey, "POST", `/campaigns/${newId}/activate`);

  // 5. Persist the mapping. If a concurrent dispatch tick already created one
  //    (unique violation on company_bio_id+flow_name), defer to the winner and
  //    delete our orphan campaign so we don't leave a duplicate in Instantly.
  const { error: insErr } = await svc
    .from("instantly_flow_campaigns")
    .insert({ company_bio_id: companyBioId, flow_name: flowName, instantly_campaign_id: newId });
  if (insErr) {
    const { data: winner } = await svc
      .from("instantly_flow_campaigns")
      .select("instantly_campaign_id")
      .eq("company_bio_id", companyBioId)
      .eq("flow_name", flowName)
      .maybeSingle();
    const winnerId = (winner as any)?.instantly_campaign_id as string | undefined;
    if (winnerId && winnerId !== newId) {
      await inst(config.apiKey, "DELETE", `/campaigns/${newId}`);
      return { campaignId: winnerId };
    }
  }
  return { campaignId: newId, created: true };
}
