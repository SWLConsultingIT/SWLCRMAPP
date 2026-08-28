import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { requireUser } from "@/lib/require-scope";
import { selectByIds, chunkIds } from "@/lib/supabase-bulk";

type Action = "pause" | "resume" | "cancel";

export async function POST(req: NextRequest) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const { ids, action } = await req.json() as { ids: string[]; action: Action };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (!["pause", "resume", "cancel"].includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Tenant isolation: a scoped user may only act on campaigns in their own
  // tenant. campaigns has no company_bio_id → scope via the owning lead.
  // super_admin / all-tenant viewers and local preview keep the full set.
  // Every `.in()` below is chunked. Pausing a whole flow sends ~1 136 ids and
  // that filter travels in the query string — a ~36 KB URL that Supabase
  // answers 400 to. The route returned 500, and the client swallowed it in a
  // bare `catch {}`, so Pause looked like it did nothing at all
  // (Fran 2026-08-27). Cancel had the same shape, on DELETEs.
  const bioId = g.scope?.isScoped ? g.scope.companyBioId : null;
  let allowedIds = ids;
  if (bioId) {
    try {
      const owned = await selectByIds<{ id: string }>("campaigns", ids, chunk =>
        svc.from("campaigns")
          .select("id, leads!inner(company_bio_id)")
          .in("id", chunk)
          .eq("leads.company_bio_id", bioId)
          .order("id", { ascending: true }),
      );
      allowedIds = owned.map(r => r.id);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
    if (allowedIds.length === 0) {
      return NextResponse.json({ ok: true, count: 0, action });
    }
  }

  let affected = 0;
  if (action === "cancel") {
    // Deletes, so a chunk that fails must stop the run rather than carry on
    // and leave the flow half-removed.
    for (const chunk of chunkIds(allowedIds)) {
      const m = await svc.from("campaign_messages").delete().in("campaign_id", chunk);
      if (m.error) return NextResponse.json({ error: m.error.message, deletedSoFar: affected }, { status: 500 });
      const r = await svc.from("lead_replies").delete().in("campaign_id", chunk);
      if (r.error) return NextResponse.json({ error: r.error.message, deletedSoFar: affected }, { status: 500 });
      const { error, count } = await svc.from("campaigns").delete({ count: "exact" }).in("id", chunk);
      if (error) return NextResponse.json({ error: error.message, deletedSoFar: affected }, { status: 500 });
      affected += count ?? chunk.length;
    }
  } else {
    const status = action === "pause" ? "paused" : "active";
    for (const chunk of chunkIds(allowedIds)) {
      const { error, count } = await svc.from("campaigns")
        .update({ status }, { count: "exact" }).in("id", chunk);
      if (error) return NextResponse.json({ error: error.message, updatedSoFar: affected }, { status: 500 });
      affected += count ?? chunk.length;
    }
  }

  return NextResponse.json({ ok: true, count: affected, action });
}
