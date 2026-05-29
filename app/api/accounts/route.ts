// Tenant-scoped seller (account) management. Sellers belong to a tenant via
// company_bio_id — pre-2026-05-29 the POST didn't even set it, leaving
// sellers tenant-less and globally pickable by every dispatcher.
//
// Auth: owners, managers, and super_admins in the tenant. Sellers always
// inherit the caller's scope.companyBioId on create.

import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canEditTenantSettings } from "@/lib/scope";
import { NextRequest, NextResponse } from "next/server";

function canManageSellers(tier: "super_admin" | "owner" | "manager" | "seller" | "viewer" | null): boolean {
  return canEditTenantSettings(tier) || tier === "manager";
}

// POST — Create new account (seller)
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageSellers(scope.tier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!scope.companyBioId) {
    return NextResponse.json({ error: "missing tenant scope" }, { status: 400 });
  }

  const supabase = getSupabaseService();
  const body = await req.json();
  const { name, unipile_account_id, email_account, linkedin_daily_limit, email_daily_limit } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const { data, error } = await supabase.from("sellers").insert({
    name: name.trim(),
    company_bio_id: scope.companyBioId,
    unipile_account_id: unipile_account_id?.trim() || null,
    email_account: email_account?.trim() || null,
    linkedin_daily_limit: linkedin_daily_limit ?? 15,
    email_daily_limit: email_daily_limit ?? 50,
    active: true,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE — Deactivate account (soft delete)
export async function DELETE(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageSellers(scope.tier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseService();
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

  const { data: seller, error: readErr } = await supabase
    .from("sellers")
    .select("id, company_bio_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!seller) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (scope.isScoped && seller.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await supabase.from("sellers").update({ active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
