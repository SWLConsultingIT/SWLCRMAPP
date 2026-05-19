import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope, canApproveCampaigns } from "@/lib/scope";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Creates a campaign_request and immediately approves it for a single lead.
// Uses service key to bypass RLS — needed because super_admin has no tenant
// binding and would be blocked by the campaign_requests tenant-isolation policy.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!canApproveCampaigns(scope.tier)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await req.json();
  const { leadId, name, sequence, channelMessages, language, timezone, sellerId } = body;

  if (!leadId || !sequence?.length) {
    return NextResponse.json({ error: "leadId and sequence are required" }, { status: 400 });
  }

  const { data: lead } = await supabase.from("leads").select("company_bio_id, primary_first_name, primary_last_name, icp_profile_id").eq("id", leadId).single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const companyBioId = lead.company_bio_id;
  if (!companyBioId) return NextResponse.json({ error: "Lead has no tenant assigned" }, { status: 400 });

  const channels: string[] = [...new Set(sequence.map((s: any) => s.channel as string))];
  const leadName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim();
  const campaignName = name?.trim() || `${leadName} — ${channels.join(" + ")} Renurture`;

  const { data: request, error: reqErr } = await supabase.from("campaign_requests").insert({
    name: campaignName,
    icp_profile_id: lead.icp_profile_id ?? null,
    company_bio_id: companyBioId,
    lead_id: leadId,
    channels,
    sequence_length: sequence.length,
    frequency_days: 0,
    target_leads_count: 1,
    message_prompts: { sequence, channelMessages, language, timezone, selectedLeadIds: [leadId], sellerId: sellerId ?? null },
    status: "pending_review",
  }).select("id").single();

  if (reqErr || !request) {
    return NextResponse.json({ error: reqErr?.message ?? "Failed to create request" }, { status: 500 });
  }

  // Inline approve — same logic as /api/campaigns/approve but without the
  // HTTP round-trip and without the RLS constraint on the browser client.
  const approveRes = await fetch(new URL("/api/campaigns/approve", req.url).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") ?? "" },
    body: JSON.stringify({ requestId: request.id }),
  });

  if (!approveRes.ok) {
    const { error: approveErr } = await approveRes.json().catch(() => ({ error: "Approve failed" }));
    return NextResponse.json({ error: `Request created but auto-approve failed: ${approveErr ?? "unknown"}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, requestId: request.id });
}
