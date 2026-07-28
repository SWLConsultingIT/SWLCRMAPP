import { getSupabaseService } from "@/lib/supabase-service";
import { requireUser, assertTenant } from "@/lib/require-scope";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const { id } = await params;
  const { content } = await request.json();

  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  const supabase = getSupabaseService();
  // Only allow editing pending messages (not sent ones). campaign_messages
  // carries no company_bio_id, so scope via the owning lead.
  const { data: msg } = await supabase
    .from("campaign_messages")
    .select("id, status, leads!inner(company_bio_id)")
    .eq("id", id)
    .single();

  if (!msg) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  {
    const lj = (msg as { leads?: { company_bio_id?: string | null } | Array<{ company_bio_id?: string | null }> | null }).leads;
    const bio = Array.isArray(lj) ? lj[0]?.company_bio_id : lj?.company_bio_id;
    const denied = assertTenant(g.scope, bio ?? null);
    if (denied) return denied;
  }

  if (msg.status === "sent") {
    return NextResponse.json({ error: "Cannot edit a sent message" }, { status: 403 });
  }

  const { error } = await supabase
    .from("campaign_messages")
    .update({ content: content.trim() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
