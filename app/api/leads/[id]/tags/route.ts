// Tag teammates on a lead (any tenant user, not just sellers). GET lists tagged
// users; POST tags one (and notifies them); DELETE removes a tag. Tenant-scoped
// via the lead's bio.

import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { createNotifications } from "@/lib/notify";
import { NextRequest, NextResponse } from "next/server";

async function userName(svc: ReturnType<typeof getSupabaseService>, userId: string): Promise<string> {
  try {
    const { data } = await svc.auth.admin.getUserById(userId);
    const m = data?.user?.user_metadata ?? {};
    return (m.full_name as string) ?? (m.display_name as string) ?? (m.name as string)
      ?? (data?.user?.email as string | undefined)?.split("@")[0] ?? "Teammate";
  } catch { return "Teammate"; }
}

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
    .from("lead_tags")
    .select("user_id, reason, created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: true });
  const tags = await Promise.all((data ?? []).map(async t => ({
    userId: t.user_id,
    name: await userName(svc, t.user_id),
    reason: t.reason ?? null,
  })));
  return NextResponse.json({ tags });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { userId, reason } = await req.json().catch(() => ({}));
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const reasonText = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 280) : null;

  const svc = getSupabaseService();
  const lead = await loadLead(svc, id);
  if (!lead || !lead.company_bio_id) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await svc.from("lead_tags").upsert({
    lead_id: id, user_id: userId, company_bio_id: lead.company_bio_id, tagged_by: scope.userId, reason: reasonText,
  }, { onConflict: "lead_id,user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const leadLabel = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.company || "a lead";
  await createNotifications({
    companyBioId: lead.company_bio_id,
    recipientUserIds: [userId],
    actorUserId: scope.userId,
    actorName: await actorName(),
    type: "tag",
    leadId: id,
    body: `tagged you on ${leadLabel}${reasonText ? ` — ${reasonText}` : ""}`,
    link: `/leads/${id}`,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const svc = getSupabaseService();
  const lead = await loadLead(svc, id);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await svc.from("lead_tags").delete().eq("lead_id", id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
