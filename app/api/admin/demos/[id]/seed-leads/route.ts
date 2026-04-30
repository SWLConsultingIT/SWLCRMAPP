import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import { pickSeedLeads, emailFor, type DemoIndustryKey } from "@/lib/demo-seeds";

// POST /api/admin/demos/[id]/seed-leads
// body: { industry?: DemoIndustryKey, count?: number }
// Inserts N realistic-but-fictional leads into the demo tenant. Admin-only.
// Refuses if the target bio is not is_demo=true (defense-in-depth so a
// stale URL can't pollute a real client).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (scope.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: bioId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    industry?: DemoIndustryKey;
    count?: number;
  };
  const industry: DemoIndustryKey = body.industry ?? "mixed";
  const count = Math.min(Math.max(Number(body.count ?? 15), 1), 50);

  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("id, is_demo, company_name")
    .eq("id", bioId)
    .eq("is_demo", true)
    .maybeSingle();
  if (!bio?.id) {
    return NextResponse.json({ error: "Not a demo tenant" }, { status: 404 });
  }

  const seeds = pickSeedLeads(industry, count);
  const rows = seeds.map(s => ({
    company_bio_id: bio.id,
    primary_first_name: s.first,
    primary_last_name: s.last,
    primary_title_role: s.role,
    primary_seniority: s.seniority,
    primary_work_email: emailFor(s.first, s.last, s.company),
    primary_linkedin_url: s.linkedin,
    company_name: s.company,
    company_industry: s.industry,
    company_country: s.country,
    employees: s.employees,
    status: "new" as const,
    allow_linkedin: true,
    allow_email: true,
    source_tool: "demo_seed",
    source_universe: "demo",
  }));

  const { data, error } = await svc.from("leads").insert(rows).select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: data?.length ?? 0 });
}
