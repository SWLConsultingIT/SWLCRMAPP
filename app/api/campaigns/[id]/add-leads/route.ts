import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

// Server-side defense for the "Add Leads" tab. Browser INSERTs bypassed RLS for
// admins, so a super-admin viewing a SWL campaign could attach Pathway leads.
// This endpoint resolves the campaign's tenant (campaign → seller → company_bio)
// and rejects any lead that doesn't share the same company_bio_id.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabaseService();
  const { id: campaignId } = await params;
  const body = await req.json() as { leadIds?: string[] };
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.filter(x => typeof x === "string") : [];
  if (leadIds.length === 0) return NextResponse.json({ error: "No leads provided" }, { status: 400 });

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, sequence_steps, seller_id, sellers(company_bio_id)")
    .eq("id", campaignId)
    .single();
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const sellerRel = (campaign.sellers as { company_bio_id?: string | null } | { company_bio_id?: string | null }[] | null);
  const tenantBioId =
    Array.isArray(sellerRel) ? sellerRel[0]?.company_bio_id ?? null : sellerRel?.company_bio_id ?? null;
  if (!tenantBioId) return NextResponse.json({ error: "Campaign has no tenant" }, { status: 400 });

  const { data: leads } = await supabase
    .from("leads")
    .select("id, company_bio_id")
    .in("id", leadIds);
  const valid = (leads ?? []).filter(l => l.company_bio_id === tenantBioId).map(l => l.id);
  const rejected = leadIds.filter(id => !valid.includes(id));
  if (valid.length === 0) {
    return NextResponse.json({ error: "All leads belong to a different tenant", rejected }, { status: 403 });
  }

  // De-dupe: skip any lead already enrolled in an active/paused flow. Without
  // this guard, re-clicking "+ Add" on a lead that the eligible list wrongly
  // still showed (or a double click) inserted a second campaign row — De Vera
  // accumulated 225 duplicate rows this way. Mirrors the eligible-leads query
  // in page.tsx so the two never disagree.
  const { data: existing } = await supabase
    .from("campaigns").select("lead_id")
    .in("status", ["active", "paused"]).in("lead_id", valid);
  const alreadyIn = new Set((existing ?? []).map(e => e.lead_id).filter(Boolean));
  const toAdd = valid.filter(id => !alreadyIn.has(id));
  const skipped = valid.filter(id => alreadyIn.has(id));
  if (toAdd.length === 0) {
    return NextResponse.json({ ok: true, added: 0, skipped, rejected });
  }

  const sequence = (campaign.sequence_steps as { channel: string; daysAfter: number }[] | null) ?? [];
  const firstChannel = sequence[0]?.channel ?? "linkedin";
  const rows = toAdd.map(leadId => ({
    lead_id: leadId,
    seller_id: campaign.seller_id,
    name: campaign.name,
    channel: firstChannel,
    status: "active",
    current_step: 0,
    sequence_steps: sequence,
    started_at: new Date().toISOString(),
  }));

  const { error: insertError } = await supabase.from("campaigns").insert(rows);
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  await supabase.from("leads").update({ status: "contacted", current_channel: firstChannel }).in("id", toAdd);

  return NextResponse.json({ ok: true, added: toAdd.length, skipped, rejected });
}
