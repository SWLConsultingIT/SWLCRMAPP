// Step 3 preview of the import wizard: same dedup logic as /commit, but
// returns the plan without writing. The Confirm step calls this to show
// the operator how many rows will insert / update / skip BEFORE pressing
// Import — duplicates inside the upload, leads already in active
// campaigns, rows with no name + no contact info, etc.

import { NextRequest, NextResponse } from "next/server";
import { getUserScope, canEditTenantSettings } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import { buildImportPlan } from "@/lib/lead-import-dedup";
import type { LeadMappingResult } from "@/lib/lead-csv-mapper";

export const runtime = "nodejs";
export const maxDuration = 60;

type DryRunBody = {
  rows: Array<Record<string, string>>;
  mapping: LeadMappingResult;
};

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canEditTenantSettings(scope.tier) && scope.tier !== "manager") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!scope.companyBioId) {
    return NextResponse.json({ error: "missing tenant scope" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as DryRunBody | null;
  if (!body || !Array.isArray(body.rows) || !body.mapping || !Array.isArray(body.mapping.mappings)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // buildImportPlan throws when it can't load the dedup index. Surface that as
  // a readable error: a preview computed against a partial index would claim
  // every row is new and talk the operator into duplicating the tenant.
  let plan: Awaited<ReturnType<typeof buildImportPlan>>;
  try {
    plan = await buildImportPlan({
      rows: body.rows,
      mapping: body.mapping,
      targetBioId: scope.companyBioId,
      // Type-cast: the helper takes a structurally-loose Supabase shape so
      // it doesn't drag the supabase-js types into lib/.
      supabase: getSupabaseService() as unknown as Parameters<typeof buildImportPlan>[0]["supabase"],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "dedup check failed" },
      { status: 502 },
    );
  }

  // Channel reachability across the NEW leads (inserts). The wizard shows
  // this so the operator catches a file with no phones / no emails BEFORE
  // importing, instead of discovering unreachable leads once they're in a
  // campaign. Computed from the real mapped output (so it reflects the phone
  // consolidation), and format-validates email/phone for a soft warning.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let email = 0, phone = 0, linkedin = 0, none = 0, badEmail = 0, badPhone = 0;
  const inserts = plan.outcomes.filter(o => o.status === "insert");
  for (const o of inserts) {
    const m = (o.mapped ?? {}) as Record<string, unknown>;
    const em = (m.primary_work_email ?? m.primary_personal_email) as string | undefined;
    const ph = m.primary_phone as string | undefined;
    const hasEmail = !!em, hasPhone = !!ph, hasLI = !!m.primary_linkedin_url;
    if (hasEmail) { email++; if (!EMAIL_RE.test(String(em).trim())) badEmail++; }
    if (hasPhone) { phone++; if (String(ph).replace(/\D/g, "").length < 7) badPhone++; }
    if (hasLI) linkedin++;
    if (!hasEmail && !hasPhone && !hasLI) none++;
  }
  const reach = { total: inserts.length, email, phone, linkedin, none, badEmail, badPhone };

  // Strip the heavy `mapped` / `patch` fields before returning — the
  // wizard only needs the outcome metadata to render the preview.
  const outcomes = plan.outcomes.map(o => ({
    rowIndex: o.rowIndex,
    status: o.status,
    existingLeadId: o.existingLeadId ?? null,
    reason: o.reason,
    display: o.display,
  }));

  return NextResponse.json({
    counts: plan.counts,
    outcomes,
    reach,
  });
}
