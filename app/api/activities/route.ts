// Activities collection endpoint.
//   GET  → list activities for the consolidated "My Activities" view + the Lead
//          Detail section. Filters: scope(mine|all), seller, type, status,
//          leadId, from/to (due_at range).
//   POST → create an activity.
//
// Tenant isolation + ownership are enforced HERE in code: getSupabaseService()
// is service-role and bypasses RLS, so every query is explicitly scoped to the
// caller's company (mirrors app/api/notifications/route.ts). Sellers only ever
// see/assign their own activities; managers/owners/super_admin see the tenant.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";
import { ACTIVITY_SELECT, normalizeActivityCreate, isActivityType, isActivityStatus } from "@/lib/activities";

export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = getSupabaseService();
  const sp = req.nextUrl.searchParams;
  const seesAll = canViewAllTenantData(scope.tier);

  let q = svc.from("activities").select(ACTIVITY_SELECT);

  // Tenant scope — never rely on RLS through the service client.
  if (scope.isScoped && scope.companyBioId) q = q.eq("company_bio_id", scope.companyBioId);

  // Ownership: a seller only sees their own. Managers/owners/super_admin may
  // request scope=all (tenant-wide) or scope=mine; default mine everywhere.
  const wantScope = sp.get("scope") === "all" && seesAll ? "all" : "mine";
  if (wantScope === "mine") {
    q = q.eq("assigned_to", scope.userId);
  } else {
    const seller = sp.get("seller");
    if (seller) q = q.eq("assigned_to", seller);
  }

  const leadId = sp.get("leadId");
  if (leadId) q = q.eq("lead_id", leadId);

  const type = sp.get("type");
  if (type && isActivityType(type)) q = q.eq("type", type);

  const status = sp.get("status");
  if (status && isActivityStatus(status)) q = q.eq("status", status);

  const from = sp.get("from");
  const to = sp.get("to");
  if (from) q = q.gte("due_at", from);
  if (to) q = q.lte("due_at", to);

  // Open work first, soonest due first; nulls (no date) last. Cap generously —
  // the consolidated view is per-seller so this stays small.
  const { data, error } = await q
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ activities: data ?? [] });
}

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = normalizeActivityCreate(body ?? {});
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const svc = getSupabaseService();

  // Resolve the owning tenant. If a lead is attached, the tenant is the lead's
  // (and we verify it matches the caller's scope → no cross-tenant writes). If
  // no lead, fall back to the caller's active tenant.
  let companyBioId = scope.isScoped ? scope.companyBioId : null;
  if (v.lead_id) {
    const { data: lead } = await svc
      .from("leads")
      .select("company_bio_id")
      .eq("id", v.lead_id)
      .maybeSingle();
    if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
    const leadBio = (lead as { company_bio_id: string }).company_bio_id;
    if (scope.isScoped && scope.companyBioId && leadBio !== scope.companyBioId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    companyBioId = leadBio;
  }
  if (!companyBioId) {
    return NextResponse.json({ error: "no tenant in scope — attach a lead or switch tenant" }, { status: 422 });
  }

  // Ownership on assignment: sellers can only assign to themselves; managers+
  // may assign to any teammate. Default to the creator.
  const seesAll = canViewAllTenantData(scope.tier);
  const assignedTo = seesAll ? (v.assigned_to ?? scope.userId) : scope.userId;

  const nowIso = new Date().toISOString();
  const row = {
    company_bio_id: companyBioId,
    lead_id: v.lead_id,
    type: v.type,
    title: v.title,
    description: v.description,
    assigned_to: assignedTo,
    created_by: scope.userId,
    due_at: v.due_at,
    status: "pending" as const,
    priority: v.priority,
    source: v.source,
    source_reference_id: v.source_reference_id,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const { data, error } = await svc.from("activities").insert(row).select(ACTIVITY_SELECT).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ activity: data }, { status: 201 });
}
