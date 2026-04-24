import { NextRequest, NextResponse } from "next/server";

const N8N_WEBHOOK_URL = "https://n8n.srv949269.hstgr.cloud/webhook/generate-campaign-messages-v2";

export async function POST(req: NextRequest) {
  const { sequence, companyBio, icpProfile, lead, language, signals } = await req.json();

  // Build the payload for n8n
  // n8n will fetch fresh data from Supabase using the IDs
  const payload: Record<string, any> = {
    sequence: sequence ?? [],
    language: language ?? "es",
    signals: Array.isArray(signals) ? signals : [],
  };

  // Pass IDs so n8n fetches fresh data from Supabase
  if (lead?.id) payload.lead_id = lead.id;
  if (lead?.icp_profile_id) payload.icp_profile_id = lead.icp_profile_id;
  if (lead?.company_bio_id) payload.company_bio_id = lead.company_bio_id;
  if (icpProfile?.id) payload.icp_profile_id = icpProfile.id;
  if (companyBio?.id) payload.company_bio_id = companyBio.id;

  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `n8n error: ${err}` }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to generate messages" }, { status: 500 });
  }
}
