import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Per-ICP lead lifecycle counts for the Lead Miner list, so each ICP card can
// show where its leads sit (in-flow / lost / won / renurture / completed /
// unassigned) instead of a generic 4-step progress bar. Same bucketing as
// /api/leads/by-icp/[id] but tenant-wide and grouped by icp_profile_id, so the
// list makes ONE call instead of one per card. Scoped to the caller's active
// company_bio (super-admins get their own/switched tenant).
type Buckets = { total: number; unassigned: number; inFlow: number; won: number; lost: number; renurture: number; completed: number };
const empty = (): Buckets => ({ total: 0, unassigned: 0, inFlow: 0, won: 0, lost: 0, renurture: 0, completed: 0 });

export async function GET() {
  const scope = await getUserScope();
  const bioId = scope.companyBioId;
  if (!scope.userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!bioId) return NextResponse.json({ perIcp: {}, totals: empty() });

  const svc = getSupabaseService();

  // 1) All leads for the tenant (id, icp, status), paginated ≤1000/page (the
  //    PostgREST hard cap — never rely on a single unbounded read).
  type LeadRow = { id: string; icp_profile_id: string | null; status: string | null };
  const leads: LeadRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc
      .from("leads")
      .select("id, icp_profile_id, status")
      .eq("company_bio_id", bioId)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    leads.push(...(data as LeadRow[]));
    if (data.length < 1000) break;
  }
  if (leads.length === 0) return NextResponse.json({ perIcp: {}, totals: empty() });

  // 2) Campaign membership for those leads — active/paused (in-flow) + ever
  //    enrolled. Chunk the .in() so the URL never blows past the row cap.
  const leadIds = leads.map(l => l.id);
  const hasActiveFlow = new Set<string>();
  const everInFlow = new Set<string>();
  for (let i = 0; i < leadIds.length; i += 300) {
    const chunk = leadIds.slice(i, i + 300);
    const { data } = await svc.from("campaigns").select("lead_id, status").in("lead_id", chunk);
    for (const c of data ?? []) {
      const lid = (c as { lead_id: string | null }).lead_id;
      if (!lid) continue;
      everInFlow.add(lid);
      const st = (c as { status: string | null }).status;
      if (st === "active" || st === "paused") hasActiveFlow.add(lid);
    }
  }

  // 3) Bucket every lead into its ICP. Priority: active flow → terminal status
  //    → completed (ever flowed, no outcome) → unassigned (never flowed).
  const perIcp: Record<string, Buckets> = {};
  const totals = empty();
  for (const l of leads) {
    const key = l.icp_profile_id ?? "__none";
    if (!perIcp[key]) perIcp[key] = empty();
    const b = perIcp[key];
    const bump = (k: keyof Buckets) => { b[k]++; b.total++; totals[k]++; totals.total++; };
    if (hasActiveFlow.has(l.id)) bump("inFlow");
    else if (l.status === "closed_won") bump("won");
    else if (l.status === "closed_lost") bump("lost");
    else if (l.status === "nurturing") bump("renurture");
    else if (everInFlow.has(l.id)) bump("completed");
    else bump("unassigned");
  }

  return NextResponse.json({ perIcp, totals });
}
