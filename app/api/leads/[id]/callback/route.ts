import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// PATCH /api/leads/[id]/callback   body: { callbackAt: string|null, note?: string }
// Sets or clears the lead's call-back reminder (L-9). Used by the "Volver a
// llamar" list: "✓ Hecho" sends callbackAt=null; "Reprogramar" sends a new ISO
// datetime. The post-call popup (call-outcome route) also maintains this field;
// this endpoint is the lightweight standalone edit.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: leadId } = await params;
  let body: { callbackAt?: string | null; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const svc = getSupabaseService();
  const { data: lead } = await svc.from("leads").select("id, company_bio_id").eq("id", leadId).maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let callbackAt: string | null = null;
  if (typeof body.callbackAt === "string" && body.callbackAt.trim()) {
    const d = new Date(body.callbackAt);
    if (isNaN(d.getTime())) return NextResponse.json({ error: "invalid callbackAt" }, { status: 400 });
    callbackAt = d.toISOString();
  }

  const patch: Record<string, unknown> = { callback_at: callbackAt, updated_at: new Date().toISOString() };
  // Only touch the note when clearing (drop it) or when the caller sends one.
  if (callbackAt === null) patch.callback_note = null;
  else if (typeof body.note === "string") patch.callback_note = body.note.trim() || null;

  const { error } = await svc.from("leads").update(patch).eq("id", leadId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, callbackAt });
}
