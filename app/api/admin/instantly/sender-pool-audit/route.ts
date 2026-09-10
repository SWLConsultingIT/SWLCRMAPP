// Sender-pool audit — the cross-tenant view of "is every campaign still sending
// from mailboxes its tenant actually owns?"
//
// The dispatch-time guard blocks a bad send, and the provisioning guard stops a
// bad campaign from ever activating. Neither tells you the state of the whole
// workspace, and neither runs at all for a tenant that isn't currently
// dispatching. This route sweeps everything: every tenant with an Instantly
// configuration, its template campaign, and every per-flow clone.
//
// Read-only. Nothing here mutates a campaign, a mapping or a lead. Never returns
// an API key — the responses carry addresses and counts only.
//
// GET /api/admin/instantly/sender-pool-audit
//   ?tenant=<company_bio_id>   optional, audit one tenant
//   ?live=1                    bypass the 10-minute pool cache

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-admin";
import { getSupabaseService } from "@/lib/supabase-service";
import { getInstantlyConfig } from "@/lib/instantly-config";
import { verifyCampaignSenderPool } from "@/lib/instantly-campaign-pool";
import { normalizeAddressList } from "@/lib/sender-pool";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Row = {
  tenant: string;
  tenantBioId: string;
  campaignId: string;
  campaignName: string | null;
  flow: string;
  role: "template" | "flow";
  expectedCount: number;
  actualCount: number;
  status: "pass" | "block" | "warn";
  unexpectedSenders: string[];
  reason: string;
};

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const onlyTenant = url.searchParams.get("tenant");
  const live = url.searchParams.get("live") === "1";

  const svc = getSupabaseService();

  let bioQuery = svc
    .from("company_bios")
    .select("id, company_name, email_accounts, instantly_campaign_id")
    .not("instantly_campaign_id", "is", null)
    .order("company_name");
  if (onlyTenant) bioQuery = bioQuery.eq("id", onlyTenant);
  const { data: bios, error: bioErr } = await bioQuery;
  if (bioErr) return NextResponse.json({ error: bioErr.message }, { status: 500 });

  const rows: Row[] = [];
  const skipped: Array<{ tenant: string; reason: string }> = [];

  for (const bio of (bios ?? []) as Array<{
    id: string; company_name: string | null; email_accounts: unknown; instantly_campaign_id: string;
  }>) {
    const tenantName = bio.company_name ?? bio.id;
    const config = await getInstantlyConfig(bio.id);
    if (!config?.apiKey) {
      skipped.push({ tenant: tenantName, reason: "no Instantly credential resolves for this tenant" });
      continue;
    }

    // The template plus every per-flow clone. Auditing the template matters as
    // much as the clones: it is what every future clone inherits.
    const { data: flows } = await svc
      .from("instantly_flow_campaigns")
      .select("flow_name, instantly_campaign_id")
      .eq("company_bio_id", bio.id)
      .order("created_at");

    const targets: Array<{ campaignId: string; flow: string; role: "template" | "flow" }> = [
      { campaignId: bio.instantly_campaign_id, flow: "(template)", role: "template" },
      ...((flows ?? []) as Array<{ flow_name: string; instantly_campaign_id: string }>).map((f) => ({
        campaignId: f.instantly_campaign_id,
        flow: f.flow_name,
        role: "flow" as const,
      })),
    ];

    for (const target of targets) {
      const { verdict, campaignName } = await verifyCampaignSenderPool({
        apiKey: config.apiKey,
        campaignId: target.campaignId,
        declared: bio.email_accounts,
        force: live,
      });
      rows.push({
        tenant: tenantName,
        tenantBioId: bio.id,
        campaignId: target.campaignId,
        campaignName,
        flow: target.flow,
        role: target.role,
        expectedCount: normalizeAddressList(bio.email_accounts).length,
        actualCount: verdict.actualCount,
        status: verdict.status,
        unexpectedSenders: verdict.violations,
        reason: verdict.reason,
      });
    }
  }

  const summary = {
    campaigns: rows.length,
    pass: rows.filter((r) => r.status === "pass").length,
    warn: rows.filter((r) => r.status === "warn").length,
    block: rows.filter((r) => r.status === "block").length,
  };

  // Sort worst-first so a real violation is the first thing on screen.
  const weight: Record<Row["status"], number> = { block: 0, warn: 1, pass: 2 };
  rows.sort((a, b) => weight[a.status] - weight[b.status] || a.tenant.localeCompare(b.tenant) || a.flow.localeCompare(b.flow));

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    cache: live ? "bypassed" : "10-minute pool cache",
    summary,
    rows,
    skipped,
  });
}
