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
    .select("id, name, sequence_steps, seller_id, call_advance_mode, sellers(company_bio_id)")
    .eq("id", campaignId)
    .single();
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const sellerRel = (campaign.sellers as { company_bio_id?: string | null } | { company_bio_id?: string | null }[] | null);
  const tenantBioId =
    Array.isArray(sellerRel) ? sellerRel[0]?.company_bio_id ?? null : sellerRel?.company_bio_id ?? null;
  if (!tenantBioId) return NextResponse.json({ error: "Campaign has no tenant" }, { status: 400 });

  const { data: leads } = await supabase
    .from("leads")
    .select("id, company_bio_id, status")
    .in("id", leadIds);
  const tenantLeads = (leads ?? []).filter(l => l.company_bio_id === tenantBioId);
  const rejected = leadIds.filter(id => !tenantLeads.some(l => l.id === id));
  if (tenantLeads.length === 0) {
    return NextResponse.json({ error: "All leads belong to a different tenant", rejected }, { status: 403 });
  }

  // Never re-outreach a closed lead. A lost lead lives in the Results →
  // Re-nurture bucket, and "Add all compatible" happily pulled the 2 De Vera
  // closed_lost leads back into the active flow (and queued LinkedIn invites to
  // them). Terminal-status leads are skipped here and hidden from the eligible
  // list in page.tsx.
  const TERMINAL = new Set(["closed_lost", "closed_won", "won"]);
  const valid = tenantLeads.filter(l => !TERMINAL.has(l.status)).map(l => l.id);
  const closedSkipped = tenantLeads.filter(l => TERMINAL.has(l.status)).map(l => l.id);
  if (valid.length === 0) {
    return NextResponse.json({ ok: true, added: 0, skipped: closedSkipped, rejected });
  }

  // De-dupe on two axes: (a) a lead already in ANY active/paused flow, and
  // (b) a lead that ALREADY HAS A ROW IN THIS FLOW regardless of status —
  // re-adding a completed/cancelled lead to the same flow created a second row
  // (the funnel showed it twice). Together these keep one row per lead per flow.
  const [{ data: existingActive }, { data: inThisFlow }] = await Promise.all([
    supabase.from("campaigns").select("lead_id").in("status", ["active", "paused"]).in("lead_id", valid),
    supabase.from("campaigns").select("lead_id").eq("name", campaign.name).in("lead_id", valid),
  ]);
  const alreadyIn = new Set([...(existingActive ?? []), ...(inThisFlow ?? [])].map(e => e.lead_id).filter(Boolean));
  const toAdd = valid.filter(id => !alreadyIn.has(id));
  const skipped = [...valid.filter(id => alreadyIn.has(id)), ...closedSkipped];
  if (toAdd.length === 0) {
    return NextResponse.json({ ok: true, added: 0, skipped, rejected });
  }

  const sequence = (campaign.sequence_steps as { channel: string; daysAfter: number }[] | null) ?? [];
  const firstChannel = sequence[0]?.channel ?? "linkedin";

  // Pull the flow's message templates from a sibling lead already enrolled in
  // the same flow. A campaign row alone never dispatches — the cron selects
  // from `campaign_messages` (status=queued, channel=linkedin), so a lead with
  // no message rows sits dead in the funnel forever (this is exactly what the
  // old add-leads did: 216 De Vera leads enrolled with zero messages). Copy
  // ONLY the per-step template (step_number / channel / content / subject) and
  // assign fresh statuses below — never copy a sibling's sent/queued state.
  const now = new Date().toISOString();
  const { data: siblingIds } = await supabase
    .from("campaigns").select("id").eq("name", campaign.name).neq("id", campaignId).limit(50);
  const refIds = [campaignId, ...(siblingIds ?? []).map(s => s.id)];
  const { data: tmplRows } = await supabase
    .from("campaign_messages")
    .select("step_number, channel, content, metadata")
    .in("campaign_id", refIds)
    .order("step_number", { ascending: true });
  const templateByStep = new Map<number, { step_number: number; channel: string; content: string; subject: string | null }>();
  for (const m of (tmplRows ?? [])) {
    if (m.step_number == null || templateByStep.has(m.step_number)) continue;
    const subject = (m.metadata as { subject?: string } | null)?.subject ?? null;
    templateByStep.set(m.step_number, { step_number: m.step_number, channel: m.channel, content: m.content, subject });
  }
  const templates = Array.from(templateByStep.values());

  // Insert the campaign rows, capturing each new id so we can attach its
  // messages. Mirror the wizard enrollment fields (created_at, call_advance_mode).
  const rows = toAdd.map(leadId => ({
    lead_id: leadId,
    seller_id: campaign.seller_id,
    name: campaign.name,
    channel: firstChannel,
    status: "active",
    current_step: 0,
    sequence_steps: sequence,
    call_advance_mode: campaign.call_advance_mode ?? "auto",
    started_at: now,
    created_at: now,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("campaigns").insert(rows).select("id, lead_id");
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  // Seed campaign_messages per new lead from the template. Step 0 (the LinkedIn
  // CR) and a non-LinkedIn step 1 start `queued` so the dispatcher fires them
  // now (throttled by the per-seller daily limit + 3-min min-spacing — they do
  // NOT all send at once). LinkedIn steps 1+ stay `draft` until the connection
  // is accepted, exactly like wizard enrollment.
  if (templates.length > 0) {
    const messageInserts = (inserted ?? []).flatMap(c => templates.map(t => {
      const isFirstNonLinkedin = t.step_number === 1 && t.channel !== "linkedin";
      const startQueued = t.step_number === 0 || isFirstNonLinkedin;
      return {
        campaign_id: c.id,
        lead_id: c.lead_id,
        step_number: t.step_number,
        channel: t.channel,
        content: t.content,
        status: startQueued ? "queued" : "draft",
        created_at: now,
        ...(t.subject ? { metadata: { subject: t.subject } } : {}),
      };
    }));
    if (messageInserts.length > 0) {
      const { error: msgErr } = await supabase.from("campaign_messages").insert(messageInserts);
      if (msgErr) return NextResponse.json({ error: `Leads added but messages failed: ${msgErr.message}` }, { status: 500 });
    }
  }

  // Set the channel only — let the dispatcher flip the lead to `contacted` once
  // Unipile confirms the invite actually sent (matches approve/route.ts; setting
  // contacted up-front produced ghost-contacted leads on Pathway).
  await supabase.from("leads").update({ current_channel: firstChannel }).in("id", toAdd);

  return NextResponse.json({ ok: true, added: toAdd.length, skipped, rejected, seededMessages: templates.length > 0 });
}
