import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
).toString("base64");
const DEFAULT_NUMBER_ID = Number(process.env.AIRCALL_DEFAULT_NUMBER_ID);

export async function POST(req: NextRequest) {
  // Resolve tenant first — without this, any authenticated user could pass
  // ANY numberId or leadId and place a call using another tenant's Aircall
  // number, or log a phantom outbound call against another tenant's lead.
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  const { phone, leadId, sellerId, aircallUserId, numberId } = await req.json();
  if (!phone) return NextResponse.json({ error: "Phone number required" }, { status: 400 });

  const svc = getSupabaseService();

  // Validate numberId belongs to this tenant (or fall back to tenant's first
  // claimed number, or the global default if the tenant has none claimed).
  const { data: bio } = await svc
    .from("company_bios")
    .select("aircall_number_ids")
    .eq("id", scope.companyBioId)
    .maybeSingle();
  const allowedNumbers = ((bio as any)?.aircall_number_ids as number[] | null) ?? [];
  let resolvedNumberId: number | null = null;
  if (numberId !== undefined && numberId !== null) {
    const requested = Number(numberId);
    if (!allowedNumbers.includes(requested)) {
      return NextResponse.json({ error: "numberId not in tenant's aircall pool" }, { status: 403 });
    }
    resolvedNumberId = requested;
  } else if (allowedNumbers.length > 0) {
    resolvedNumberId = allowedNumbers[0];
  } else {
    // Tenant has no claimed numbers — only allow SWL admins to use the global
    // default. Clients must claim a number via /accounts first.
    if (scope.role !== "admin") {
      return NextResponse.json({ error: "Tenant has no Aircall numbers claimed" }, { status: 403 });
    }
    resolvedNumberId = DEFAULT_NUMBER_ID;
  }

  // Validate leadId belongs to this tenant (admin can dial across tenants
  // for support reasons; clients are strictly scoped).
  if (leadId && scope.role !== "admin") {
    const { data: lead } = await svc
      .from("leads")
      .select("id, company_bio_id")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead || (lead as any).company_bio_id !== scope.companyBioId) {
      return NextResponse.json({ error: "lead not in your tenant" }, { status: 403 });
    }
  }

  const payload: Record<string, unknown> = {
    number_id: resolvedNumberId,
    to: phone,
  };
  if (aircallUserId) payload.user_id = Number(aircallUserId);

  const res = await fetch("https://api.aircall.io/v1/calls", {
    method: "POST",
    headers: {
      Authorization: `Basic ${AIRCALL_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const data = await res.json();
  const callId = data.call?.id ?? null;

  if (leadId) {
    await svc.from("calls").insert({
      aircall_call_id: callId,
      lead_id: leadId,
      seller_id: sellerId ?? null,
      direction: "outbound",
      status: "initiated",
      phone_number: phone,
      started_at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ success: true, callId });
}
