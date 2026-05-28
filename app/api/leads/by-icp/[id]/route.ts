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
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, lead_id, name, status, channel")
    .in("lead_id", leadIds)
    .in("status", ["active", "paused", "completed"]);
  const campByLead = new Map<string, { id: string; name: string; status: string; channel: string | null }>();
  for (const c of campaigns ?? []) {
    const lid = (c as any).lead_id as string | null;
    if (!lid) continue;
    const cur = campByLead.get(lid);
    // Prefer active > paused > completed.
    const rank = (s: string | null) => s === "active" ? 3 : s === "paused" ? 2 : s === "completed" ? 1 : 0;
    if (!cur || rank((c as any).status) > rank(cur.status)) {
      campByLead.set(lid, { id: (c as any).id, name: (c as any).name, status: (c as any).status, channel: (c as any).channel ?? null });
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

  const withCampaign = enriched.filter(l => l.campaign !== null);
  const unassigned = enriched.filter(l => l.campaign === null);

  return NextResponse.json({
    leads: enriched,
    withCampaign,
    unassigned,
  });
}
