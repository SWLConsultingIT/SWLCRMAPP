// POST /api/inbox/reply/[leadId]   body: { text: string, channel?: "linkedin"|"email" }
// ─────────────────────────────────────────────────────────────────────────
// Seller-driven manual reply from the inbox / lead-detail composer. Sends the
// seller's text out the SAME channel the lead used, then logs it to
// campaign_messages so the thread (and the n8n humanInThread guard) see it.
//
// IMPORTANT — this is the missing piece behind the 2026-06-02 reply-loss
// incident: a human replying in LinkedIn was NEVER recorded in
// campaign_messages, so the auto-reply guard couldn't tell a human had already
// answered. Logging every manual send here closes that hole.
//
//   LinkedIn → Unipile POST /chats/{chatId}/messages  (chat_id from the lead's
//              last sent message metadata; account_id from the seller).
//   Email    → Instantly POST /emails/send  (threaded via reply_to_message_id
//              when we have it; from-address reused from the last sent email).
//
// We never start a NEW outreach step here and we don't touch campaign status —
// the campaign is already stopped once a lead replies (LAW). This is purely a
// human conversation continuing inside a stopped flow.
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { getInstantlyConfig } from "@/lib/instantly-config";
import { renderPlaceholders } from "@/lib/placeholders";

export const runtime = "nodejs";

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY ?? "";
const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

type Channel = "linkedin" | "email";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { leadId } = await params;
  const svc = getSupabaseService();

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });

  // Hydrate the lead + enforce tenant scope.
  const { data: lead } = await svc
    .from("leads")
    .select("id, primary_work_email, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  if (scope.isScoped && scope.companyBioId && (lead as any).company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Resolve the campaign + seller (most recent campaign for this lead).
  const { data: camp } = await svc
    .from("campaigns")
    .select("id, seller_id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const campaignId = (camp as any)?.id ?? null;
  const sellerId = (camp as any)?.seller_id ?? null;

  // Placeholder safety net — if the seller pastes a template that still has
  // {{first_name}}/{{company}}/etc., render it; then STRIP any leftover token
  // so a raw {{…}} or [Merge Field] can NEVER ship out (same guarantee the
  // dispatcher + n8n reply handlers enforce). Canonical map in lib/placeholders.
  let sellerName: string | null = null;
  if (sellerId) {
    const { data: s } = await svc.from("sellers").select("name").eq("id", sellerId).maybeSingle();
    sellerName = (s as any)?.name ?? null;
  }
  const outgoing = renderPlaceholders(text, lead as any, { name: sellerName })
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!outgoing) return NextResponse.json({ error: "message empty after placeholder cleanup" }, { status: 400 });

  // Channel: explicit override, else infer from the lead's latest inbound reply.
  let channel: Channel | null =
    body?.channel === "linkedin" || body?.channel === "email" ? body.channel : null;
  if (!channel) {
    const { data: lastReply } = await svc
      .from("lead_replies")
      .select("channel")
      .eq("lead_id", leadId)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ch = (lastReply as any)?.channel;
    channel = ch === "email" ? "email" : ch === "linkedin" ? "linkedin" : null;
  }
  if (!channel) {
    return NextResponse.json({ error: "could not determine channel" }, { status: 422 });
  }

  let providerMessageId: string | null = null;
  const sentMeta: Record<string, unknown> = { manual_seller_reply: true, sent_by_user: scope.userId };

  try {
    if (channel === "linkedin") {
      if (!UNIPILE_KEY) return NextResponse.json({ error: "Unipile not configured" }, { status: 500 });
      // chat_id: pull from the most recent message we sent this lead.
      const { data: lastSent } = await svc
        .from("campaign_messages")
        .select("metadata")
        .eq("lead_id", leadId)
        .eq("channel", "linkedin")
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const chatId =
        ((lastSent as any)?.metadata?.chat_id as string | undefined) ?? null;
      // seller account
      let unipileAccountId: string | null = null;
      if (sellerId) {
        const { data: seller } = await svc
          .from("sellers")
          .select("unipile_account_id")
          .eq("id", sellerId)
          .maybeSingle();
        unipileAccountId = (seller as any)?.unipile_account_id ?? null;
      }
      if (!chatId) {
        return NextResponse.json({ error: "no LinkedIn chat found for this lead" }, { status: 422 });
      }
      const url = `${UNIPILE_BASE}/api/v1/chats/${encodeURIComponent(chatId)}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "X-API-KEY": UNIPILE_KEY, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ text: outgoing }),
      });
      const raw = await res.text();
      let parsed: any = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { /* */ }
      if (!res.ok) {
        const err = parsed?.detail || parsed?.title || parsed?.message || raw || `HTTP ${res.status}`;
        return NextResponse.json({ error: `Unipile send failed: ${err}` }, { status: 502 });
      }
      providerMessageId = parsed?.id ?? parsed?.message_id ?? null;
      sentMeta.chat_id = chatId;
    } else {
      // EMAIL via Instantly /emails/send (threaded reply).
      const tenantBioId = (lead as any).company_bio_id;
      if (!tenantBioId) return NextResponse.json({ error: "lead has no tenant" }, { status: 422 });
      const config = await getInstantlyConfig(tenantBioId);
      if (!config?.apiKey) return NextResponse.json({ error: "tenant has no Instantly API key" }, { status: 422 });
      const to = (lead as any).primary_work_email;
      if (!to) return NextResponse.json({ error: "lead has no email" }, { status: 422 });
      // Reuse the from-address + subject from the last email we sent this lead.
      const { data: lastEmail } = await svc
        .from("campaign_messages")
        .select("metadata")
        .eq("lead_id", leadId)
        .eq("channel", "email")
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastMeta = ((lastEmail as any)?.metadata ?? {}) as Record<string, unknown>;
      const from = (lastMeta.from_address as string | undefined) ?? "";
      const lastSubject = (lastMeta.subject as string | undefined) ?? "";
      // Thread on the lead's last inbound message id if we stored one.
      const { data: lastReply } = await svc
        .from("lead_replies")
        .select("provider_thread_id")
        .eq("lead_id", leadId)
        .eq("channel", "email")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const replyToId = (lastReply as any)?.provider_thread_id ?? null;
      // Prefer a caller-supplied subject (seller edited it in the composer);
      // otherwise auto-build "Re: <last subject>".
      const subjectIn = typeof body?.subject === "string" ? body.subject.trim() : "";
      const subject = subjectIn || (lastSubject ? `Re: ${lastSubject.replace(/^re:\s*/i, "")}` : "Re:");

      const payload: Record<string, unknown> = { to, subject, body: outgoing };
      if (from) payload.from = from;
      if (replyToId) payload.reply_to_message_id = replyToId;

      const res = await fetch(`${INSTANTLY_BASE}/emails/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      let parsed: any = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { /* */ }
      if (!res.ok) {
        const err = parsed?.message || parsed?.error || raw || `HTTP ${res.status}`;
        return NextResponse.json({ error: `Instantly send failed: ${err}` }, { status: 502 });
      }
      providerMessageId = parsed?.id ?? parsed?.message_id ?? null;
      sentMeta.from_address = from;
      sentMeta.subject = subject;
      sentMeta.to_address = to;
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "send failed" }, { status: 502 });
  }

  // Log the manual send so the thread + n8n humanInThread guard see it.
  // step_number = -1 marks a manual, out-of-sequence seller reply (never a
  // template step). rendered_content carries the literal text so the thread
  // renders exactly what we sent.
  const nowIso = new Date().toISOString();
  sentMeta.rendered_content = outgoing;
  const insertRow: Record<string, unknown> = {
    lead_id: leadId,
    campaign_id: campaignId,
    step_number: -1,
    channel,
    content: outgoing,
    status: "sent",
    sent_at: nowIso,
    provider_message_id: providerMessageId,
    metadata: sentMeta,
  };
  const { error: insErr } = await svc.from("campaign_messages").insert(insertRow);
  if (insErr) {
    // The message DID go out — surface a soft warning, don't fail the request.
    return NextResponse.json({
      ok: true,
      channel,
      providerMessageId,
      warning: `sent but failed to log: ${insErr.message}`,
    });
  }

  return NextResponse.json({ ok: true, channel, providerMessageId, sentAt: nowIso });
}
