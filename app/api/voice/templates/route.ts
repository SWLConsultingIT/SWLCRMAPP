// Voice — message_templates writes, relocated from direct browser writes so the
// View-As read-only block (proxy.ts) covers them server-side. Uses the RLS
// server client (the user's own JWT), so tenant isolation stays enforced by the
// SAME Postgres RLS policy as the old browser write — nothing about the security
// model changes, the call just now crosses a server boundary that knows about
// Seller Preview. company_bio_id is taken from server scope, never trusted from
// the body.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/integrations/supabase/server";
import { getUserScope } from "@/shared/auth/scope";

type Body = { id?: string; payload?: Record<string, unknown> };

async function guard() {
  const scope = await getUserScope();
  if (!scope.userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!scope.companyBioId) return { error: NextResponse.json({ error: "No tenant" }, { status: 403 }) };
  return { scope };
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;
  const { payload } = (await req.json().catch(() => ({}))) as Body;
  if (!payload) return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  const sb = await getSupabaseServer();
  const { data, error } = await sb
    .from("message_templates")
    .insert({ ...payload, company_bio_id: g.scope.companyBioId })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data?.id });
}

export async function PATCH(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;
  const { id, payload } = (await req.json().catch(() => ({}))) as Body;
  if (!id || !payload) return NextResponse.json({ error: "Missing id/payload" }, { status: 400 });
  const sb = await getSupabaseServer();
  // company_bio_id is pinned to the caller's tenant; RLS additionally guarantees
  // the row itself belongs to it.
  const { error } = await sb
    .from("message_templates")
    .update({ ...payload, company_bio_id: g.scope.companyBioId })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;
  const { id } = (await req.json().catch(() => ({}))) as Body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const sb = await getSupabaseServer();
  const { error } = await sb.from("message_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
