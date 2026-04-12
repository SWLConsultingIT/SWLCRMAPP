import { NextRequest, NextResponse } from "next/server";

const N8N_WEBHOOK_URL = "https://n8n.srv949269.hstgr.cloud/webhook/generate-campaign-field";

export async function POST(req: NextRequest) {
  const body = await req.json();

  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `n8n error: ${err}` }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to generate" }, { status: 500 });
  }
}
