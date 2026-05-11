// Delete a single call row. Used by the "trash" button on each CallCard in
// the lead detail Calls tab. Soft-deletes are unnecessary here — Aircall
// keeps the source of truth, and the user can re-sync if they remove the
// wrong row.
//
// Auth: super_admin / owner / manager. Sellers can't delete (they could
// hide their own missed-call history).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!canViewAllTenantData(scope.tier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const svc = getSupabaseService();
  const { error } = await svc.from("calls").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
