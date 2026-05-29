// Tenant-scoped bulk lead delete. Same cascade as DELETE /api/leads/[id].
//
// Auth: any authenticated user can bulk-delete leads inside their own tenant.
// Cross-tenant IDs in the payload abort the whole batch with 403 — never
// partially delete and report success.
//
// Pre-2026-05-29 this route had NO auth gate — anyone could mass-delete by
// posting an array of UUIDs.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

const MAX_BULK_DELETE = 500;

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }
  if (ids.length > MAX_BULK_DELETE) {
    return NextResponse.json({ error: `max ${MAX_BULK_DELETE} ids per request` }, { status: 400 });
  }
  if (!ids.every((x: unknown) => typeof x === "string" && x.length > 0)) {
    return NextResponse.json({ error: "ids must be non-empty strings" }, { status: 400 });
  }

  const svc = getSupabaseService();

  if (scope.isScoped) {
    const { data: leads, error: readErr } = await svc
      .from("leads")
      .select("id, company_bio_id")
      .in("id", ids);
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
    const foreign = (leads ?? []).filter(l => l.company_bio_id !== scope.companyBioId);
    if (foreign.length > 0 || (leads ?? []).length !== ids.length) {
      return NextResponse.json({ error: "forbidden — one or more ids belong to a different tenant or do not exist" }, { status: 403 });
    }
  }

  await svc.from("lead_replies").delete().in("lead_id", ids);
  await svc.from("campaign_messages").delete().in("lead_id", ids);
  await svc.from("campaigns").delete().in("lead_id", ids);
  await svc.from("lead_notes").delete().in("lead_id", ids);

  const { error } = await svc.from("leads").delete().in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: ids.length });
}
