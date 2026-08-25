// Returns the leads attached to a specific ICP profile, decrypted
// server-side via hydrateClientLeads, and pre-split into
// withCampaign vs unassigned buckets so the UI can render the boss-
// requested split without re-deriving it on the client.
//
// Boss feedback 2026-05-28: the /icp Lead Miner detail accordion was
// fetching leads directly from supabase-browser (no decryption →
// "Unknown" everywhere) and didn't surface the with/without campaign
// distinction. This endpoint fixes both.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: icpId } = await params;
  if (!icpId) return NextResponse.json({ error: "missing icp id" }, { status: 400 });

  const supabase = await getSupabaseServer();
  const { data: rawLeads, error } = await supabase
    .from("leads")
    .select("id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, status, lead_score, current_channel")
    .eq("icp_profile_id", icpId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const leads = await hydrateClientLeads((rawLeads ?? []) as Record<string, unknown>[]) as any[];

  if (leads.length === 0) {
    return NextResponse.json({ leads: [], withCampaign: [], unassigned: [] });
  }

  // Pull campaigns to know which leads are assigned + carry the active
  // campaign name + status on each lead for the inline pill.
  const leadIds = leads.map(l => l.id);
  // Pull EVERY campaign row (all statuses) for these leads — we need to know
  // both whether a lead is in an ACTIVE/paused flow right now AND whether it
  // ever went through one at all (a lead whose only flow ended closed_lost was
  // previously invisible here and leaked into the "unassigned" bucket).
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, lead_id, name, status, channel")
    .in("lead_id", leadIds);
  const campByLead = new Map<string, { id: string; name: string; status: string; channel: string | null }>();
  const hasActiveFlow = new Set<string>();  // active | paused
  const everInFlow = new Set<string>();      // any campaign row at all
  for (const c of campaigns ?? []) {
    const lid = (c as any).lead_id as string | null;
    if (!lid) continue;
    const st = (c as any).status as string | null;
    everInFlow.add(lid);
    if (st === "active" || st === "paused") hasActiveFlow.add(lid);
    const cur = campByLead.get(lid);
    // Prefer active > paused > completed > closed_lost > closed_won for the
    // pill so we surface the most "current" campaign context.
    const rank = (s: string | null) => s === "active" ? 5 : s === "paused" ? 4 : s === "completed" ? 3 : s === "closed_lost" ? 2 : s === "closed_won" ? 1 : 0;
    if (!cur || rank(st) > rank(cur.status)) {
      campByLead.set(lid, { id: (c as any).id, name: (c as any).name, status: st ?? "", channel: (c as any).channel ?? null });
    }
  }

  const enriched = leads.map(l => {
    const camp = campByLead.get(l.id) ?? null;
    return {
      id: l.id,
      firstName: l.primary_first_name ?? null,
      lastName: l.primary_last_name ?? null,
      company: l.company_name ?? null,
      role: l.primary_title_role ?? null,
      email: l.primary_work_email ?? null,
      linkedinUrl: l.primary_linkedin_url ?? null,
      status: l.status ?? null,
      score: l.lead_score ?? null,
      channel: l.current_channel ?? null,
      campaign: camp,
    };
  });

  // Bucket each lead by where it sits in its lifecycle. Priority order matters:
  // an ACTIVE flow always wins, then terminal outcomes by lead status, then
  // "went through a flow but no outcome yet", and finally truly-untouched leads.
  //   - inFlow      : active/paused campaign right now
  //   - won         : closed_won
  //   - lost        : closed_lost  (→ Renurture reopens them)
  //   - renurture   : nurturing
  //   - completed   : flow ended, no outcome marked yet
  //   - unassigned  : never entered a flow → the ONLY bucket you can bulk-assign
  const buckets = {
    unassigned: [] as typeof enriched,
    inFlow: [] as typeof enriched,
    won: [] as typeof enriched,
    lost: [] as typeof enriched,
    renurture: [] as typeof enriched,
    completed: [] as typeof enriched,
  };
  for (const l of enriched) {
    if (hasActiveFlow.has(l.id)) buckets.inFlow.push(l);
    else if (l.status === "closed_won") buckets.won.push(l);
    else if (l.status === "closed_lost") buckets.lost.push(l);
    else if (l.status === "nurturing") buckets.renurture.push(l);
    else if (everInFlow.has(l.id)) buckets.completed.push(l);
    else buckets.unassigned.push(l);
  }

  const counts = {
    total: enriched.length,
    unassigned: buckets.unassigned.length,
    inFlow: buckets.inFlow.length,
    won: buckets.won.length,
    lost: buckets.lost.length,
    renurture: buckets.renurture.length,
    completed: buckets.completed.length,
  };

  return NextResponse.json({
    leads: enriched,
    buckets,
    counts,
    // Back-compat: some callers still read these two.
    withCampaign: enriched.filter(l => l.campaign !== null),
    unassigned: buckets.unassigned,
  });
}
