import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import { advanceCallStepForLead } from "@/lib/advance-call-step";

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

  const { phone, leadId, aircallUserId, numberId } = await req.json();
  if (!phone) return NextResponse.json({ error: "Phone number required" }, { status: 400 });

  // Aircall requires strict E.164: leading "+" then digits + a valid country
  // code. Lead records arrive in many shapes:
  //   "+54 9 11 3394 2012"   → already E.164, just strip formatting
  //   "(248) 296-7307"        → US local format, needs +1 prepended
  //   "0800 123 456"          → impossible to disambiguate, send and let Aircall reject
  // The pre-2026-05-18 normalizer prepended "+" verbatim → "(248) 296-7307"
  // became "+2482967307" (Seychelles country code 248) which Aircall rejected
  // with "Invalid number to call". Pathway lost dials to Kyle Cleland this way.
  //
  // Heuristic:
  //   - If the input starts with "+" → trust it, just strip formatting.
  //   - Exactly 10 digits + no "+" → assume US (NANP), prepend "+1".
  //   - Exactly 11 digits starting with "1" → prepend "+".
  //   - Everything else → fall back to "+" + digits and let Aircall judge.
  // Proper i18n via libphonenumber is the long-term fix; this covers the
  // 95% case (US/UK leads from Apollo / ZoomInfo) without the dep.
  const rawInput = String(phone);
  const digitsOnly = rawInput.replace(/[^\d]/g, "");
  let normalizedPhone: string;
  if (rawInput.trim().startsWith("+")) {
    normalizedPhone = "+" + digitsOnly;
  } else if (digitsOnly.length === 10) {
    normalizedPhone = "+1" + digitsOnly; // NANP fallback (US/Canada)
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    normalizedPhone = "+" + digitsOnly;
  } else {
    normalizedPhone = "+" + digitsOnly;
  }
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
  // Resolution order (refined 2026-05-15 after Pathway reported "the call
  // rings the wrong teammate" — both Andy and Graeme dialed against the
  // tenant-default Aircall user, so whoever had the Aircall Phone open in
  // foreground would pick up regardless of who clicked Call):
  //   1. Explicit aircallUserId from caller (advanced override / testing).
  //   2. sellers.aircall_user_id of the *calling user* in the dialing
  //      tenant. This is the per-seller binding configured in
  //      /admin/<tenant>/Aircall. Each teammate dials as their own Aircall
  //      user → only their device rings.
  //   3. company_bios.aircall_user_id of the dialing tenant — the legacy
  //      shared-user fallback for tenants that haven't migrated yet.
  //   4. "First user with available=true" globally (last-resort fallback).
  //
  // Note on availability fields: Aircall exposes `available` (boolean — is
  // the user signed in?) AND `availability_status` (soft string). Only
  // `available=true` indicates the device will actually ring; the soft
  // status defaults to "available" even for offline users.
  let resolvedUserId: number | null = aircallUserId ? Number(aircallUserId) : null;
  // Resolve dialingBio once — used by both the seller lookup (step 2)
  // and the tenant-default lookup (step 3) so super_admins dialing across
  // tenants pick the right Aircall identity.
  let dialingBio: string | null = scope.companyBioId;
  if (!resolvedUserId && leadId) {
    const { data: leadForBio } = await svc
      .from("leads")
      .select("company_bio_id")
      .eq("id", leadId)
      .maybeSingle();
    dialingBio = ((leadForBio as { company_bio_id?: string | null } | null)?.company_bio_id) ?? dialingBio;
  }
  // Step 2: per-seller binding. The user clicking Call may have a sellers
  // row in this tenant with their own aircall_user_id — prefer that.
  if (!resolvedUserId && dialingBio) {
    const { data: sellerRow } = await svc
      .from("sellers")
      .select("aircall_user_id")
      .eq("user_id", scope.userId)
      .eq("company_bio_id", dialingBio)
      .maybeSingle();
    const sellerUser = (sellerRow as { aircall_user_id?: string | null } | null)?.aircall_user_id ?? null;
    if (sellerUser) {
      const parsed = Number(sellerUser);
      if (Number.isFinite(parsed)) resolvedUserId = parsed;
    }
  }
  // Step 3: tenant default — used by tenants that share one Aircall user
  // across teammates, or as a fallback for users without a sellers row.
  if (!resolvedUserId && dialingBio) {
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
    // The caller (or tenant default) gave us a specific user_id — verify
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

  // Race condition fix (2026-05-15): INSERT the dial row BEFORE telling
  // Aircall to call. Aircall fires the call.created webhook within ~200ms
  // of the dial POST returning, and the webhook reconciliation in
  // app/api/aircall/webhook/route.ts looks for an existing dial row by
  // phone + recent time window. If the INSERT happens AFTER the POST,
  // Aircall can webhook us before our row exists → reconciliation finds 0
  // candidates → a duplicate row gets created. Inserting first guarantees
  // the dial row is queryable by the time Aircall fires.
  //
  // If Aircall later rejects the dial (rate limit, bad number), we clean
  // up the orphan dial row below. Acceptable failure mode — the user gets
  // the same error message either way.
  let insertedDialId: string | null = null;
  if (leadId) {
    const { data: inserted } = await svc.from("calls").insert({
      aircall_call_id: null,
      lead_id: leadId,
      seller_id: null,
      direction: "outbound",
      status: "initiated",
      phone_number: phone,
      started_at: new Date().toISOString(),
    }).select("id").single();
    insertedDialId = (inserted as { id?: string } | null)?.id ?? null;
  }

  // Aircall outbound endpoint: POST /v1/users/{user_id}/calls
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
    // Aircall rejected the dial — clean up the dial row we just inserted
    // so it doesn't sit in /queue forever as a phantom "initiated" entry.
    if (insertedDialId) {
      await svc.from("calls").delete().eq("id", insertedDialId);
    }
    const errBody = await res.text();
    // Parse Aircall's JSON error so the UI can show the actual reason
    // ("Invalid number to call") instead of a raw blob. Falls back gracefully.
    let friendly = `Aircall ${res.status}`;
    try {
      const parsed = JSON.parse(errBody);
      friendly = parsed?.troubleshoot ?? parsed?.message ?? errBody.slice(0, 200);
    } catch { friendly = errBody.slice(0, 200) || friendly; }
    return NextResponse.json({
      error: friendly,
      aircall_status: res.status,
      attempted_number: normalizedPhone,
    }, { status: res.status });
  }

  // Manual-dial step advance. When a seller dials from the Queue / lead
  // detail and the lead's active campaign is currently parked on a call
  // step (queued or skipped), this is what unblocks the sequence:
  //   1. mark the call campaign_message as sent
  //   2. advance campaigns.current_step + last_step_at
  //   3. queue the next draft step with its eligible_at
  // This is the symmetric op to what dispatch-call does for auto-mode and
  // is the ONLY path that advances a manual-mode campaign.
  if (leadId) {
    try {
      await advanceCallStepForLead(svc, leadId, "manual-dial-aircall");
    } catch (e) {
      // Don't fail the user-visible dial just because step bookkeeping
      // had a problem — log to console and let the webhook reconciler
      // or a follow-up dial pick up the slack.
      console.error("[aircall/dial] step advance failed:", e);
    }
  }

  // Return the just-inserted call row id (if any) so the UI can prompt the
  // seller to classify the outcome the moment the dial wraps. Aircall's own
  // call_id arrives later via webhook; we surface the Supabase row id which
  // is what /api/calls/<id>/classify accepts anyway.
  return NextResponse.json({ success: true, callId: insertedDialId });
}
