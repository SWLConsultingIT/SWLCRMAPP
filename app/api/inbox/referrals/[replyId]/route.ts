// POST /api/inbox/referrals/[replyId]
// body: {
//   contactIndex: number,         // which lead_replies.metadata.referred_contacts[i]
//   enrol: boolean,               // true = create lead + add to flow; false = create only
//   overrides?: { firstName?, lastName?, email?, role? },  // seller edits in the modal
//   language?: string, timezone?: string
// }
//
// Referral capture. A lead replied "I left / I'm on vacation, talk to X". The
// n8n reply handler (Haiku) extracted the referred contacts into
// `lead_replies.metadata.referred_contacts`. From the Inbox the seller turns
// one of those into a real lead and (optionally) drops it into the SAME flow
// the original lead was in.
//
// Laws honored:
//  - Leads are created through the importer's crypto path (encrypt for client
//    tenants, allow_* flags), never inserted raw. (LEY "leads solo por la app")
//  - The new lead inherits the original lead's icp_profile_id; the cloned flow
//    is the original campaign → same ICP. (LEY one-ICP-per-campaign)
//  - We clone the FULL original sequence but keep only the steps whose channel
//    the new lead can actually use (email-only until enrichment adds LinkedIn/
//    phone), so a LinkedIn/call step never freezes the flow.
//  - Enrolment reuses /api/campaigns/approve (same battle-tested seeding of
//    campaign_messages, CR handling, tailor pass) exactly like the renurture
//    route — so we never re-implement message seeding.
//
// Enrichment is a stub today (lib/referral-enrich.ts → email-only). When Apollo
// is approved, that single function starts returning title/LinkedIn/phone and
// the new lead automatically becomes multichannel — nothing here changes.

import { NextRequest, NextResponse } from "next/server";
import { getUserScope, canApproveCampaigns } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import {
  resolveTenantKey,
  encryptWithResolvedKey,
  splitLeadForEncryption,
  hydrateClientLeads,
  logDataAccess,
} from "@/lib/leads-crypto";
import { enrichReferral } from "@/lib/referral-enrich";

export const runtime = "nodejs";
export const maxDuration = 60;

type ReferredContact = {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  reason?: string | null;
  is_decision_maker?: boolean;
  is_generic_inbox?: boolean;
  status?: string | null;          // "created" once actioned
  created_lead_id?: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ replyId: string }> },
) {
  const { replyId } = await params;
  const scope = await getUserScope();
  // Creating a lead + launching outbound is an admin-level action (same gate as
  // renurture/approve). Sellers route their replies but don't spin up flows.
  if (!canApproveCampaigns(scope.tier)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    contactIndex?: number;
    enrol?: boolean;
    overrides?: { firstName?: string; lastName?: string; email?: string; role?: string };
    language?: string;
    timezone?: string;
  } | null;

  const contactIndex = body?.contactIndex;
  if (typeof contactIndex !== "number" || contactIndex < 0) {
    return NextResponse.json({ error: "contactIndex is required" }, { status: 400 });
  }
  const enrol = body?.enrol === true;

  const svc = getSupabaseService();

  // 1. Load the reply + its lead + the campaign the reply came in on (the flow
  //    we'll clone). lead_replies has no company_bio_id of its own, so the
  //    tenant guard goes through the leads join.
  const { data: reply, error: replyErr } = await svc
    .from("lead_replies")
    .select(`
      id, metadata, lead_id, campaign_id,
      leads!inner(
        id, source, encrypted_payload, company_bio_id, icp_profile_id,
        primary_first_name, primary_last_name,
        company_name, company_website, company_country, company_city,
        company_state, company_industry, company_sub_industry, company_linkedin,
        company_phone
      ),
      campaigns(id, name, sequence_steps, seller_id)
    `)
    .eq("id", replyId)
    .maybeSingle();

  if (replyErr) return NextResponse.json({ error: replyErr.message }, { status: 500 });
  if (!reply) return NextResponse.json({ error: "reply not found" }, { status: 404 });

  const origLeadRaw = (reply as unknown as { leads: Record<string, unknown> }).leads;
  const companyBioId = origLeadRaw.company_bio_id as string | null;
  if (!companyBioId) {
    return NextResponse.json({ error: "original lead has no tenant" }, { status: 400 });
  }
  // Tenant guard: a scoped user can only act on their own tenant's replies.
  if (scope.isScoped && scope.companyBioId && companyBioId !== scope.companyBioId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 2. Decrypt the original lead so we can inherit company fields (for client
  //    tenants the company_* columns live in the encrypted blob, not the row).
  const [origLead] = await hydrateClientLeads([origLeadRaw as Record<string, unknown> & {
    id?: string; source?: string | null; encrypted_payload?: unknown; company_bio_id?: string | null;
  }]);

  // 3. Resolve the chosen referred contact + apply the seller's modal edits.
  const referred = ((reply as { metadata: { referred_contacts?: ReferredContact[] } | null }).metadata?.referred_contacts) ?? [];
  const contact = referred[contactIndex];
  if (!contact) {
    return NextResponse.json({ error: "referred contact not found at index" }, { status: 404 });
  }
  if (contact.status === "created") {
    return NextResponse.json({ error: "this contact was already created", leadId: contact.created_lead_id }, { status: 409 });
  }

  const email = (body?.overrides?.email ?? contact.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "a valid email is required for the referral" }, { status: 400 });
  }
  const role = body?.overrides?.role ?? contact.role ?? null;
  let first = body?.overrides?.firstName ?? "";
  let last = body?.overrides?.lastName ?? "";
  if (!first && !last) {
    const s = splitName(contact.name ?? "");
    first = s.first; last = s.last;
  }
  const leadName = `${first} ${last}`.trim() || email;

  // 4. Best-effort dedup on the email column. NOTE: for client (encrypted)
  //    tenants the email lives in the blob, not the column, so this only
  //    catches plaintext tenants — referral volume is low and human-reviewed,
  //    so a rare dupe is acceptable. (TODO: encrypted-aware dedup if needed.)
  const { data: existing } = await svc
    .from("leads")
    .select("id")
    .eq("company_bio_id", companyBioId)
    .or(`primary_work_email.ilike.${email},primary_personal_email.ilike.${email}`)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      ok: false,
      alreadyExisted: true,
      leadId: (existing as { id: string }).id,
      message: "A lead with this email already exists in this tenant.",
    });
  }

  // 5. Enrichment (stubbed → email-only). Never throws.
  const domain = email.split("@")[1] ?? null;
  const enrich = await enrichReferral({
    firstName: first, lastName: last, email, domain,
    companyName: (origLead.company_name as string | null) ?? null,
  });

  // 6. Build the new lead, inheriting company + ICP from the original lead.
  const shouldEncrypt = (origLead.source as string | null) === "client";
  const COMPANY_INHERIT = [
    "company_name", "company_website", "company_country", "company_city",
    "company_state", "company_industry", "company_sub_industry",
    "company_linkedin", "company_phone",
  ] as const;
  const inheritedCompany: Record<string, unknown> = {};
  for (const c of COMPANY_INHERIT) {
    const v = (origLead as Record<string, unknown>)[c];
    if (v !== undefined && v !== null && v !== "") inheritedCompany[c] = v;
  }

  const leadFields: Record<string, unknown> = {
    ...inheritedCompany,
    primary_first_name: first || null,
    primary_last_name: last || null,
    primary_work_email: email,
    primary_title_role: role ?? enrich.title ?? null,
    primary_linkedin_url: enrich.linkedinUrl ?? null,
    primary_phone: enrich.phone ?? null,
    company_bio_id: companyBioId,
    icp_profile_id: (origLead.icp_profile_id as string | null) ?? null,
    referred_by_lead_id: (origLead.id as string) ?? reply.lead_id ?? null,
    referral_source_reply_id: replyId,
    // Channel opt-ins follow what we actually have. Email always; LinkedIn/call
    // only once enrichment provides the handle/number.
    allow_email: true,
    allow_linkedin: !!enrich.linkedinUrl,
    allow_call: !!enrich.phone,
    allow_whatsapp: false,
    allow_sms: false,
    allow_telegram: false,
    sync_status: "synced",
    lead_score: 0,
  };

  // Encrypt PII for client tenants (mirror the import-commit path).
  let insertRow: Record<string, unknown>;
  let encryptionMode: "standard" | "sovereign" | null = null;
  if (shouldEncrypt) {
    let key: Buffer;
    try {
      const resolved = await resolveTenantKey(companyBioId);
      key = resolved.key; encryptionMode = resolved.mode;
    } catch (err) {
      return NextResponse.json({ error: `Encryption key unavailable: ${err instanceof Error ? err.message : "unknown"}` }, { status: 500 });
    }
    const { operational, encrypted } = splitLeadForEncryption(leadFields);
    const { ciphertext, version } = encryptWithResolvedKey(encrypted, key);
    insertRow = {
      ...operational,
      source: "client",
      // Force Postgres bytea hex literal — supabase-js would otherwise JSON-encode
      // the Buffer and corrupt the ciphertext (see import/commit comment).
      encrypted_payload: "\\x" + ciphertext.toString("hex"),
      encryption_version: version,
    };
  } else {
    insertRow = { ...leadFields, source: "swl" };
  }

  // 7. Insert the lead.
  const { data: created, error: insErr } = await svc
    .from("leads")
    .insert(insertRow)
    .select("id")
    .single();
  if (insErr || !created) {
    return NextResponse.json({ error: `Failed to create lead: ${insErr?.message ?? "unknown"}` }, { status: 500 });
  }
  const newLeadId = (created as { id: string }).id;

  await logDataAccess({
    companyBioId,
    caller: shouldEncrypt ? "client-app" : "swl-admin",
    reason: `referral:lead created from reply ${replyId} (referred_by ${origLead.id})`,
    encryptionMode: encryptionMode ?? undefined,
  });

  // Helper to stamp the referred contact as actioned on the reply.
  async function markActioned(enrolled: boolean) {
    const md = ((reply as { metadata: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>;
    const list = (md.referred_contacts as ReferredContact[] | undefined) ?? [];
    if (list[contactIndex!]) {
      list[contactIndex!] = { ...list[contactIndex!], status: "created", created_lead_id: newLeadId };
    }
    await svc.from("lead_replies").update({ metadata: { ...md, referred_contacts: list, last_referral_action: { lead_id: newLeadId, enrolled } } }).eq("id", replyId);
  }

  // 8. Create-only path.
  if (!enrol) {
    await markActioned(false);
    return NextResponse.json({ ok: true, leadId: newLeadId, enrolled: false });
  }

  // 9. Enrol: clone the original flow, keeping only steps the lead can use.
  const origCampaign = (reply as unknown as { campaigns: { id: string; name: string | null; sequence_steps: unknown; seller_id: string | null } | null }).campaigns;
  if (!origCampaign?.id) {
    await markActioned(false);
    return NextResponse.json({ ok: true, leadId: newLeadId, enrolled: false, reason: "no_source_flow", message: "Lead created — the reply has no source campaign to clone, enrol it manually." });
  }

  // Which channels the new lead can actually run right now.
  const availableChannels = new Set<string>(["email"]);
  if (enrich.linkedinUrl) availableChannels.add("linkedin");
  if (enrich.phone) availableChannels.add("call");

  // Pull the original campaign's per-step templates (content keeps the
  // {{placeholders}} — dispatcher substitutes at send time).
  const { data: origMsgs } = await svc
    .from("campaign_messages")
    .select("step_number, channel, content, metadata")
    .eq("campaign_id", origCampaign.id)
    .order("step_number", { ascending: true });

  const seqSteps = (Array.isArray(origCampaign.sequence_steps) ? origCampaign.sequence_steps : []) as { channel?: string; daysAfter?: number }[];

  // Keep only steps whose channel the lead can use; re-sequence contiguously.
  // (No CR slot — that's LinkedIn, unavailable email-only.)
  const sequence: { channel: string; daysAfter: number }[] = [];
  const steps: { subject: string | null; body: string }[] = [];
  for (const m of (origMsgs ?? []) as { step_number: number; channel: string; content: string | null; metadata: { subject?: string } | null }[]) {
    if (m.step_number === 0) continue; // step-0 is the LinkedIn CR
    if (!availableChannels.has(m.channel)) continue;
    // daysAfter from the original sequence config for this step; first kept step starts at 0.
    const cfg = seqSteps[m.step_number - 1];
    sequence.push({ channel: m.channel, daysAfter: sequence.length === 0 ? 0 : (cfg?.daysAfter ?? 0) });
    steps.push({ subject: m.metadata?.subject ?? null, body: m.content ?? "" });
  }

  if (sequence.length === 0) {
    await markActioned(false);
    return NextResponse.json({ ok: true, leadId: newLeadId, enrolled: false, reason: "no_usable_channel", message: "Lead created (email-only) — the original flow has no email steps to clone." });
  }

  // Build the campaign_request the same shape approve consumes, then approve it
  // inline (cookie-forwarded) exactly like the renurture route.
  const { data: request, error: reqErr } = await svc
    .from("campaign_requests")
    .insert({
      name: `${leadName} — Referral (${origCampaign.name ?? "flow"})`,
      icp_profile_id: (origLead.icp_profile_id as string | null) ?? null,
      company_bio_id: companyBioId,
      lead_id: newLeadId,
      channels: [...availableChannels].filter(c => sequence.some(s => s.channel === c)),
      sequence_length: sequence.length,
      frequency_days: 0,
      target_leads_count: 1,
      flow_type: "generic",
      message_prompts: {
        sequence,
        channelMessages: { connectionRequest: "", steps: steps.map((s, i) => ({ channel: sequence[i].channel, subject: s.subject, body: s.body })), autoReplies: {} },
        language: body?.language ?? "es",
        timezone: body?.timezone ?? null,
        selectedLeadIds: [newLeadId],
        sellerId: origCampaign.seller_id ?? null,
      },
      status: "pending_review",
    })
    .select("id")
    .single();

  if (reqErr || !request) {
    await markActioned(false);
    return NextResponse.json({ ok: true, leadId: newLeadId, enrolled: false, reason: "request_failed", message: `Lead created but enrolment request failed: ${reqErr?.message ?? "unknown"}` });
  }

  const approveRes = await fetch(new URL("/api/campaigns/approve", req.url).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") ?? "" },
    body: JSON.stringify({ requestId: (request as { id: string }).id }),
  });

  if (!approveRes.ok) {
    const j = await approveRes.json().catch(() => ({ error: "approve failed" }));
    await markActioned(false);
    return NextResponse.json({ ok: true, leadId: newLeadId, enrolled: false, reason: "approve_failed", message: `Lead created but auto-enrol failed: ${(j as { error?: string }).error ?? "unknown"}` });
  }

  await markActioned(true);
  return NextResponse.json({ ok: true, leadId: newLeadId, enrolled: true, channels: [...availableChannels] });
}
