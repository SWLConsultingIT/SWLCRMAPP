// Soft-delete a tenant's company_bio + cascade-archive its leads/campaigns.
// All authorization happens inside the SQL RPC (super_admin OR owner of the
// tenant). The route only forwards the call.
//
// POST   /api/company-bios/[id]/archive    → archive
// DELETE /api/company-bios/[id]/archive    → restore (un-archive)

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("archive_company_bio", { target_bio_id: id });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("restore_company_bio", { target_bio_id: id });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
