import { getSupabaseService } from "@/lib/supabase-service";

// Per-tenant Instantly config resolver.
//
// Default behaviour: every tenant uses the SWL Instantly account (env var
// INSTANTLY_API_KEY). When a tenant has `company_bios.instantly_api_key`
// set, the dispatcher targets that account instead. This handles the case
// where a tenant's inboxes already live in a separate Instantly subscription
// (e.g. Arqy's emails were provisioned under a different Hypergrowth plan)
// and we don't want to migrate inboxes just to centralise the API key.
//
// `apiKey` is required to call Instantly. `campaignId` is the dispatch
// target — the same Instantly account can host multiple tenant campaigns,
// so the campaign is the per-tenant routing key inside the chosen account.

export type InstantlyConfig = {
  apiKey: string;
  campaignId: string | null;
  source: "tenant" | "env";
};

export async function getInstantlyConfig(companyBioId: string): Promise<InstantlyConfig | null> {
  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("instantly_api_key, instantly_campaign_id")
    .eq("id", companyBioId)
    .maybeSingle();

  const tenantKey = (bio as any)?.instantly_api_key as string | null | undefined;
  const campaignId = ((bio as any)?.instantly_campaign_id as string | null | undefined) ?? null;
  const envKey = process.env.INSTANTLY_API_KEY ?? "";

  const apiKey = tenantKey && tenantKey.trim().length > 0 ? tenantKey : envKey;
  if (!apiKey) return null;

  return {
    apiKey,
    campaignId,
    source: tenantKey && tenantKey.trim().length > 0 ? "tenant" : "env",
  };
}
