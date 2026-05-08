import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewSwlAdmin } from "@/lib/scope";

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

  // Decide which tenant's Aircall pool to validate against:
  //   - super_admin dialing on behalf of a specific lead → use the LEAD's
  //     tenant. Without this, a super_admin viewing an Arqy lead would only
  //     be able to dial from SWL numbers (their own tenant) which defeats
  //     the per-tenant Aircall pool.
  //   - regular tenant user → always use viewer's tenant.
  let dialingBioId: string = scope.companyBioId;
  if (leadId && canViewSwlAdmin(scope.tier)) {
    const { data: leadForBio } = await svc
      .from("leads")
      .select("company_bio_id")
      .eq("id", leadId)
      .maybeSingle();
    const leadBio = (leadForBio as any)?.company_bio_id as string | null | undefined;
    if (leadBio) dialingBioId = leadBio;
  }

  // Validate numberId belongs to the dialing tenant's pool.
  const { data: bio } = await svc
    .from("company_bios")
    .select("aircall_number_ids")
    .eq("id", dialingBioId)
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
    if (!canViewSwlAdmin(scope.tier)) {
      return NextResponse.json({ error: "Tenant has no Aircall numbers claimed" }, { status: 403 });
    }
    resolvedNumberId = DEFAULT_NUMBER_ID;
  }

  // Validate leadId belongs to this tenant (admin can dial across tenants
  // for support reasons; clients are strictly scoped).
  if (leadId && !canViewSwlAdmin(scope.tier)) {
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
  // Resolution order:
  //   1. Caller passed aircallUserId explicitly (advanced case).
  //   2. Caller passed sellerId → use sellers.aircall_user_id (the binding
  //      configured by super_admin in /admin/[id] Aircall tab). Without
  //      this, when multiple sellers are signed in the call would ring on
  //      whichever Aircall user the API listed first — stealing calls.
  //   3. Fall back to "first user with available=true" globally.
  //
  // After resolving, validate the user is actually `available=true`. If
  // not, returning 503 makes the failure explicit instead of queuing a
  // call that nobody will ever pick up.
  let resolvedUserId: number | null = aircallUserId ? Number(aircallUserId) : null;
  // Resolution chain (first match wins):
  //   1. caller passed aircallUserId (advanced override)
  //   2. seller's aircall_user_id (per-seller binding)
  //   3. lead's tenant default (company_bios.aircall_user_id)
  //   4. fall back below to "first available globally"
  // (3) is the typical client setup: one shared inbox like sales@arqy.io
  // handles all calls for that tenant. Most tenants only need that.
  if (!resolvedUserId) {
    let lookupSellerId: string | null = sellerId ?? null;
    if (!lookupSellerId) {
      const { data: meSeller } = await svc
        .from("sellers")
        .select("id")
        .eq("user_id", scope.userId)
        .maybeSingle();
      lookupSellerId = (meSeller as { id?: string } | null)?.id ?? null;
    }
    if (lookupSellerId) {
      const { data: seller } = await svc
        .from("sellers")
        .select("aircall_user_id")
        .eq("id", lookupSellerId)
        .maybeSingle();
      const sellerAircall = (seller as { aircall_user_id?: string | null } | null)?.aircall_user_id ?? null;
      if (sellerAircall) {
        const parsed = Number(sellerAircall);
        if (Number.isFinite(parsed)) resolvedUserId = parsed;
      }
    }
  }
  // Step 3: lead's tenant default. The numbers picker already scopes by the
  // lead's company_bio_id; we use the same source of truth here. Falls back
  // to viewer's tenant if no leadId (manual queue dial without lead context).
  if (!resolvedUserId) {
    let dialingBio: string | null = scope.companyBioId;
    if (leadId) {
      const { data: leadForBio } = await svc
        .from("leads")
        .select("company_bio_id")
        .eq("id", leadId)
        .maybeSingle();
      dialingBio = ((leadForBio as { company_bio_id?: string | null } | null)?.company_bio_id) ?? dialingBio;
    }
    if (dialingBio) {
      const { data: bio } = await svc
        .from("company_bios")
        .select("aircall_user_id")
        .eq("id", dialingBio)
        .maybeSingle();
      const tenantUser = (bio as { aircall_user_id?: string | null } | null)?.aircall_user_id ?? null;
      if (tenantUser) {
        const parsed = Number(tenantUser);
        if (Number.isFinite(parsed)) resolvedUserId = parsed;
      }
    }
  }
  if (!resolvedUserId) {
    try {
      const usersRes = await fetch("https://api.aircall.io/v1/users?per_page=50", {
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
  } else {
    // The caller (or seller binding) gave us a specific user_id — verify
    // they're signed in. Otherwise the call queues forever.
    try {
      const userRes = await fetch(`https://api.aircall.io/v1/users/${resolvedUserId}`, {
        headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData?.user?.available !== true) {
          return NextResponse.json({
            error: `Aircall user ${resolvedUserId} is not signed in — open the Aircall app first.`,
          }, { status: 503 });
        }
      }
    } catch {
      // If availability check fails, proceed anyway — Aircall will reject
      // hard on the dial POST and we'll surface that error.
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
