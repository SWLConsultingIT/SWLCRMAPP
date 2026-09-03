import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";
import { selectByIds, chunkIds } from "@/lib/supabase-bulk";

// Reassign the HUMAN owner/caller (campaigns.assigned_user_id) across a flow's
// leads. This is decoupled from seller_id (the LinkedIn/channel SENDING
// identity) and does NOT touch the dispatcher, so it is SAFE to run on an
// ACTIVE flow — no sends are paused or changed.
//
// Distributes the given campaign ids among the given users by quota, sequential
// slices in id order (the same shape as the flow-creation seller split: 300
// leads / 3 people = 100 each). Any leftover goes to the last assignee.
//
// Safety: campaigns are filtered to the caller's tenant (scope via the owning
// lead), and every assignee must be a MEMBER of that tenant — you cannot assign
// a user from another company. Only team-wide roles (super_admin/owner/manager)
// may reassign others' work.
//
// Body: { ids: string[], assignments: { userId: string; quota: number }[] }

type Assignment = { userId: string; quota: number };

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewAllTenantData(scope.tier)) {
    return NextResponse.json({ error: "Only owners, managers and admins can reassign flows" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; assignments?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  const assignments: Assignment[] = Array.isArray(body.assignments)
    ? (body.assignments as unknown[])
        .map(a => a as Assignment)
        .filter(a => a && typeof a.userId === "string" && a.userId && Number.isFinite(a.quota) && a.quota > 0)
        .map(a => ({ userId: a.userId, quota: Math.floor(a.quota) }))
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });
  if (assignments.length === 0) return NextResponse.json({ error: "assignments required" }, { status: 400 });

  const svc = getSupabaseService();
  const scopedBioId = scope.isScoped ? scope.companyBioId : null;

  // Tenant isolation + deterministic ordering. Scope campaigns to the caller's
  // tenant via the owning lead; keep id order so the quota slices are stable.
  // super_admin keeps the full set (bio derived below to validate assignees).
  let owned: { id: string; leads?: { company_bio_id?: string | null } | null }[];
  try {
    owned = await selectByIds<{ id: string; leads?: { company_bio_id?: string | null } | null }>(
      "campaigns",
      ids,
      chunk => {
        let q = svc.from("campaigns").select("id, leads!inner(company_bio_id)").in("id", chunk).order("id", { ascending: true });
        if (scopedBioId) q = q.eq("leads.company_bio_id", scopedBioId);
        return q as never;
      },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const allowedIds = owned.map(r => r.id);
  if (allowedIds.length === 0) return NextResponse.json({ ok: true, count: 0 });

  // The flow's tenant — used to validate assignees are members of THIS company.
  const flowBioId = scopedBioId
    ?? owned.map(r => r.leads?.company_bio_id ?? null).find(Boolean)
    ?? null;

  // Assignees must be members of the flow's tenant (guards cross-tenant assign).
  if (flowBioId) {
    const { data: mems } = await svc
      .from("user_company_memberships")
      .select("user_id")
      .eq("company_bio_id", flowBioId);
    const memberSet = new Set((mems ?? []).map(m => m.user_id as string));
    const outsiders = assignments.filter(a => !memberSet.has(a.userId));
    if (outsiders.length > 0) {
      return NextResponse.json(
        { error: `These users are not members of this tenant: ${outsiders.map(o => o.userId).join(", ")}` },
        { status: 400 },
      );
    }
  }

  // Distribute ids among assignees by quota (sequential slices), leftover → last.
  const perUser = new Map<string, string[]>();
  let offset = 0;
  for (const a of assignments) {
    const slice = allowedIds.slice(offset, offset + a.quota);
    if (slice.length) perUser.set(a.userId, (perUser.get(a.userId) ?? []).concat(slice));
    offset += a.quota;
  }
  if (offset < allowedIds.length) {
    const last = assignments[assignments.length - 1].userId;
    perUser.set(last, (perUser.get(last) ?? []).concat(allowedIds.slice(offset)));
  }

  // Write per assignee, chunked (a whole flow can be >1k ids and the filter
  // travels in the URL — chunkIds keeps each request small; see cancel route).
  let total = 0;
  const perUserCount: Record<string, number> = {};
  for (const [userId, uids] of perUser) {
    for (const chunk of chunkIds(uids)) {
      const { error, count } = await svc.from("campaigns").update({ assigned_user_id: userId }, { count: "exact" }).in("id", chunk);
      if (error) return NextResponse.json({ error: error.message, updatedSoFar: total }, { status: 500 });
      total += count ?? chunk.length;
    }
    perUserCount[userId] = uids.length;
  }

  return NextResponse.json({ ok: true, count: total, perUser: perUserCount });
}
