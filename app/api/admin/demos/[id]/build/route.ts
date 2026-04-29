import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import { populateDemo, autoIndustryPreset, DEFAULT_SHAPE, type DemoShapeConfig } from "@/lib/demo-populate";
import type { DemoIndustryKey } from "@/lib/demo-seeds";

// POST /api/admin/demos/[id]/build
// One-shot population for an existing demo tenant: ICPs + leads + campaigns
// + opportunities (won/lost). Refuses any bio that isn't is_demo=true so a
// stale URL can never inject synthetic data into a real client.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (scope.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: bioId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<DemoShapeConfig>;

  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("id, company_name, industry, target_market, value_proposition, main_services, location, is_demo")
    .eq("id", bioId)
    .eq("is_demo", true)
    .maybeSingle();
  if (!bio?.id) {
    return NextResponse.json({ error: "Not a demo tenant" }, { status: 404 });
  }

  const config: DemoShapeConfig = {
    totalLeads: clamp(body.totalLeads ?? DEFAULT_SHAPE.totalLeads, 0, 50),
    icps: clamp(body.icps ?? DEFAULT_SHAPE.icps, 0, 4),
    campaigns: clamp(body.campaigns ?? DEFAULT_SHAPE.campaigns, 0, 4),
    wonLeads: clamp(body.wonLeads ?? DEFAULT_SHAPE.wonLeads, 0, 10),
    lostLeads: clamp(body.lostLeads ?? DEFAULT_SHAPE.lostLeads, 0, 10),
    industryPreset: (body.industryPreset as DemoIndustryKey) ?? autoIndustryPreset(bio.industry),
  };

  // Won + lost can't exceed the total — silently cap them so the UI doesn't
  // need to enforce the constraint client-side.
  if (config.wonLeads + config.lostLeads > config.totalLeads) {
    const overflow = config.wonLeads + config.lostLeads - config.totalLeads;
    config.lostLeads = Math.max(0, config.lostLeads - overflow);
  }

  const result = await populateDemo(svc, bio.id, {
    industry: bio.industry,
    target_market: bio.target_market,
    value_proposition: bio.value_proposition,
    main_services: bio.main_services,
    location: bio.location,
  }, config);

  return NextResponse.json({ ok: true, ...result });
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}
