// Voice — message_sequences writes (create/update + step relink, delete),
// relocated from direct browser writes so the View-As read-only block
// (proxy.ts) covers them server-side. RLS server client (user JWT) → tenant
// isolation stays enforced by the same Postgres policy as the old browser write.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/integrations/supabase/server";
import { getUserScope } from "@/shared/auth/scope";

type Step = { template_id?: string | null };
type Body = { id?: string; payload?: Record<string, unknown>; steps?: Step[] };

async function guard() {
  const scope = await getUserScope();
  if (!scope.userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!scope.companyBioId) return { error: NextResponse.json({ error: "No tenant" }, { status: 403 }) };
  return { scope };
}

// Clear the sequence's current steps, then re-assign from `steps` in order —
// the exact two-phase relink the page used to run client-side.
async function relink(sb: Awaited<ReturnType<typeof getSupabaseServer>>, seqId: string, steps: Step[]) {
  await sb.from("message_templates").update({ sequence_id: null, sequence_order: null }).eq("sequence_id", seqId);
  for (let i = 0; i < steps.length; i++) {
    const tid = steps[i]?.template_id;
    if (!tid) continue;
    await sb.from("message_templates").update({ sequence_id: seqId, sequence_order: i }).eq("id", tid);
  }
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;
  const { payload, steps } = (await req.json().catch(() => ({}))) as Body;
  if (!payload) return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  const sb = await getSupabaseServer();
  const { data, error } = await sb
    .from("message_sequences")
    .insert({ ...payload, company_bio_id: g.scope.companyBioId })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 400 });
  await relink(sb, data.id as string, steps ?? []);
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;
  const { id, payload, steps } = (await req.json().catch(() => ({}))) as Body;
  if (!id || !payload) return NextResponse.json({ error: "Missing id/payload" }, { status: 400 });
  const sb = await getSupabaseServer();
  const { error } = await sb
    .from("message_sequences")
    .update({ ...payload, company_bio_id: g.scope.companyBioId })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await relink(sb, id, steps ?? []);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;
  const { id } = (await req.json().catch(() => ({}))) as Body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const sb = await getSupabaseServer();
  const { error } = await sb.from("message_sequences").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
