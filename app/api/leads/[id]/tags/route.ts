// Multi-seller tags on a lead. GET lists tagged sellers; POST tags a seller
// (and notifies them); DELETE removes a tag. Tenant-scoped via the lead's bio.

import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { createNotifications } from "@/lib/notify";
import { NextRequest, NextResponse } from "next/server";

async function actorName(): Promise<string> {
  try {
    const sb = await getSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const m = (user?.user_metadata ?? {}) as Record<string, unknown>;
    return (m.full_name as string) ?? (m.display_name as string) ?? (m.name as string)
      ?? (user?.email as string | undefined)?.split("@")[0] ?? "A teammate";
  } catch { return "A teammate"; }
}

async function loadLead(svc: ReturnType<typeof getSupabaseService>, id: string) {
  const { data } = await svc.from("leads").select("company_bio_id, first_name, last_name, company").eq("id", id).maybeSingle();
  return data as { company_bio_id: string | null; first_name: string | null; last_name: string | null; company: string | null } | null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ tags: [] });
  const { id } = await params;
  const svc = getSupabaseService();
  const lead = await loadLead(svc, id);
  if (!lead) return NextResponse.json({ tags: [] });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) return NextResponse.json({ tags: [] });

  const { data } = await svc
    .from("lead_seller_tags")
    .select("seller_id, created_at, sellers(name)")
    .eq("lead_id", id)
    .order("created_at", { ascending: true });
  const tags = (data ?? []).map(t => ({
    sellerId: t.seller_id,
    name: Array.isArray(t.sellers) ? (t.sellers[0] as { name?: string })?.name ?? "Seller" : (t.sellers as { name?: string } | null)?.name ?? "Seller",
  }));
  return NextResponse.json({ tags });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { sellerId } = await req.json().catch(() => ({}));
  if (!sellerId) return NextResponse.json({ error: "sellerId required" }, { status: 400 });

  const svc = getSupabaseService();
  const lead = await loadLead(svc, id);
  if (!lead || !lead.company_bio_id) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await svc.from("lead_seller_tags").upsert({
    lead_id: id, seller_id: sellerId, company_bio_id: lead.company_bio_id, tagged_by: scope.userId,
  }, { onConflict: "lead_id,seller_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify the tagged seller's linked user.
  const { data: seller } = await svc.from("sellers").select("user_id, name").eq("id", sellerId).maybeSingle();
  const leadLabel = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.company || "a lead";
  if (seller?.user_id) {
    await createNotifications({
      companyBioId: lead.company_bio_id,
      recipientUserIds: [seller.user_id],
      actorUserId: scope.userId,
      actorName: await actorName(),
      type: "tag",
      leadId: id,
      body: `tagged you on ${leadLabel}`,
      link: `/leads/${id}`,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const sellerId = new URL(req.url).searchParams.get("sellerId");
  if (!sellerId) return NextResponse.json({ error: "sellerId required" }, { status: 400 });

  const svc = getSupabaseService();
  const lead = await loadLead(svc, id);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await svc.from("lead_seller_tags").delete().eq("lead_id", id).eq("seller_id", sellerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
