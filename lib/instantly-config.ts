import { getSupabaseService } from "@/lib/supabase-service";

// Per-tenant Instantly config resolver.
//
// Resolution order:
//   1. Tenant has `instantly_workspace_id` → look up workspace, use its api_key.
//   2. Tenant has legacy `instantly_api_key` set inline → use that.
//   3. Fall back to env var `INSTANTLY_API_KEY` (default SWL account).
//
// `apiKey` is the Bearer token used for every Instantly call related to
// this tenant. `campaignId` is the dispatch target — Instantly is
// campaign-based, so the campaign UUID is the per-tenant routing key
// inside the chosen workspace.

export type InstantlyConfig = {
  apiKey: string;
  campaignId: string | null;
  workspaceId: string | null;
  workspaceLabel: string | null;
  source: "workspace" | "tenant_legacy" | "env";
};

export async function getInstantlyConfig(companyBioId: string): Promise<InstantlyConfig | null> {
  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("instantly_api_key, instantly_campaign_id, instantly_workspace_id, instantly_workspaces(id, label, api_key)")
    .eq("id", companyBioId)
    .maybeSingle();

  const campaignId = ((bio as any)?.instantly_campaign_id as string | null | undefined) ?? null;
  const ws = (bio as any)?.instantly_workspaces as { id: string; label: string; api_key: string } | null | undefined;
  const legacyKey = (bio as any)?.instantly_api_key as string | null | undefined;
  const envKey = process.env.INSTANTLY_API_KEY ?? "";

  if (ws?.api_key && ws.api_key.trim().length > 0) {
    return {
      apiKey: ws.api_key,
      campaignId,
      workspaceId: ws.id,
      workspaceLabel: ws.label,
      source: "workspace",
    };
  }

  if (legacyKey && legacyKey.trim().length > 0) {
    return {
      apiKey: legacyKey,
      campaignId,
      workspaceId: null,
      workspaceLabel: null,
      source: "tenant_legacy",
    };
  }

  if (!envKey) return null;
  return {
    apiKey: envKey,
    campaignId,
    workspaceId: null,
    workspaceLabel: null,
    source: "env",
  };
}
