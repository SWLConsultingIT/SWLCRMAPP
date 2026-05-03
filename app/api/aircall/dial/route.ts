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

  // Aircall requires strict E.164: leading "+" then digits only, no spaces,
  // dashes or parens. Lead records often have human-formatted numbers
  // ("+54 9 11 3394 2012") — strip everything except digits and the leading
  // plus before sending or Aircall returns 400 "Number needs to be E164".
  const normalizedPhone = "+" + String(phone).replace(/[^\d]/g, "");
  if (normalizedPhone.length < 8) {
    return NextResponse.json({ error: `phone "${phone}" did not normalize to a valid number` }, { status: 400 });
  }

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

  // Resolve which Aircall user makes the call.
  //
  // Aircall has TWO availability fields and they look similar but mean
  // different things:
  //   - `available` (boolean): is the user actually signed into the Aircall
  //     app right now? This is what matters for dialing — if false, the call
  //     gets queued by the API but no device will ever ring.
  //   - `availability_status` (string): a soft status like "available",
  //     "do_not_disturb", "in_call", "after_call". Even users who are NOT
  //     signed in have availability_status='available' (it's their default
  //     state). Filtering by this field is wrong — it matches everyone.
  //
  // Pick the first user with `available === true`. If none, the dial would
  // fail silently (queued but never rung), so return an explicit 503.
  let resolvedUserId: number | null = aircallUserId ? Number(aircallUserId) : null;
  if (!resolvedUserId) {
    try {
      const usersRes = await fetch("https://api.aircall.io/v1/users", {
        headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
      });
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        const candidate = (usersData?.users ?? []).find(
          (u: any) => u?.available === true,
        );
        if (candidate?.id) resolvedUserId = Number(candidate.id);
      }
    } catch {
      // fall through to error below
    }
  }
  if (!resolvedUserId) {
    return NextResponse.json({
      error: "no Aircall user is signed into the app right now — open Aircall on a device first",
    }, { status: 503 });
  }

  // Aircall outbound endpoint: POST /v1/users/{user_id}/calls
  // (Old /v1/calls returns 404 — that's a deprecated path.)
  // Returns 204 No Content on success — body is empty, the actual call_id
  // comes later via webhook (call.created).
  const res = await fetch(`https://api.aircall.io/v1/users/${resolvedUserId}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${AIRCALL_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ number_id: resolvedNumberId, to: normalizedPhone }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err || `Aircall ${res.status}` }, { status: res.status });
  }

  // 204 No Content — no body, no call_id yet. The webhook fills it in.
  const callId: string | null = null;

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
