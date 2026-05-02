import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Server-side reader for campaign_messages. Browser-side queries return
// empty because campaign_messages has RLS enabled with NO policies (default
// deny). The edit page needs the messages to populate the editor cards —
// without this endpoint every "Edit campaign" view shows empty templates.
//
// Scope: admin sees any campaign; clients see only campaigns whose lead
// belongs to their tenant.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = getSupabaseService();

  // Tenant scope: admins see anything; clients only their bio's campaigns.
  if (scope.role !== "admin") {
    const { data: camp } = await svc
      .from("campaigns")
      .select("id, leads(company_bio_id)")
      .eq("id", id)
      .maybeSingle();
    const bio = (camp as any)?.leads?.company_bio_id;
    if (!bio || bio !== scope.companyBioId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const { data: messages, error } = await svc
    .from("campaign_messages")
    .select("id, step_number, channel, content, metadata, status, sent_at")
    .eq("campaign_id", id)
    .order("step_number", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: messages ?? [] });
}
