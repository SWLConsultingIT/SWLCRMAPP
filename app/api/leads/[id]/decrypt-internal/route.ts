// Internal decrypt endpoint for the n8n agent. Returns the lead with PII
// hydrated from `encrypted_payload`. Requires Bearer auth against
// INTERNAL_DECRYPT_TOKEN — there is no user session here, n8n calls this
// directly. Every successful call inserts a row in data_access_log.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import {
  decryptLeadPayload,
  bufferFromSupabaseBytea,
  hydrateDecryptedLead,
  logDataAccess,
} from "@/lib/leads-crypto";

const TOKEN = process.env.INTERNAL_DECRYPT_TOKEN;

function unauthorized(reason: string) {
  return NextResponse.json({ error: "unauthorized", reason }, { status: 401 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!TOKEN) {
    return NextResponse.json(
      { error: "INTERNAL_DECRYPT_TOKEN not configured on server" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!presented || presented !== TOKEN) return unauthorized("bad-bearer");

  const { id } = await params;
  const reason = req.nextUrl.searchParams.get("reason") ?? "agent-process";

  const svc = getSupabaseService();
  const { data: lead, error } = await svc.from("leads").select("*").eq("id", id).single();
  if (error || !lead) {
    return NextResponse.json({ error: "lead not found" }, { status: 404 });
  }

  // SWL-uploaded leads are not encrypted — return verbatim.
  if (lead.source !== "client") {
    return NextResponse.json({ lead, decrypted: false });
  }

  if (!lead.encrypted_payload) {
    return NextResponse.json(
      { error: "client lead has no encrypted_payload", lead_id: id },
      { status: 422 },
    );
  }

  if (!lead.company_bio_id) {
    return NextResponse.json(
      { error: "client lead missing company_bio_id, cannot resolve key" },
      { status: 422 },
    );
  }

  try {
    const blob = bufferFromSupabaseBytea(lead.encrypted_payload);
    const payload = await decryptLeadPayload(blob, lead.company_bio_id);
    await logDataAccess({
      companyBioId: lead.company_bio_id,
      leadId: lead.id,
      caller: "agent-ai",
      reason,
      encryptionMode: "standard",
    });
    const hydrated = hydrateDecryptedLead(lead, payload);
    return NextResponse.json({ lead: hydrated, decrypted: true });
  } catch (err) {
    console.error("[decrypt-internal] failed", err);
    return NextResponse.json(
      { error: "decrypt failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
