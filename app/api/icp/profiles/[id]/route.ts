// Lead Miner (/icp) — icp_profiles UPDATE / DELETE, relocated from the direct
// browser writes in app/icp/page.tsx so the View-As read-only block (proxy.ts)
// covers them server-side. RLS server client (real user JWT): the SAME
// icp_profiles policies decide whether the row is the caller's to change, so a
// real seller keeps exactly their current access and a row outside their scope
// simply matches nothing. Only whitelisted profile fields are writable.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/integrations/supabase/server";
import { getUserScope } from "@/shared/auth/scope";
import { pickEditable } from "@/shared/icp/editable-fields";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const form = pickEditable(body);
  if (Object.keys(form).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const sb = await getSupabaseServer();
  const { error } = await sb.from("icp_profiles").update(form).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  const sb = await getSupabaseServer();
  const { error } = await sb.from("icp_profiles").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
