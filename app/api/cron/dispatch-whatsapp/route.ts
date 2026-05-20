import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Cron-driven WhatsApp dispatcher.
//
// Sends queued campaign_messages where channel='whatsapp' via Meta Cloud API.
//
// Send logic:
//   - If lead replied via WhatsApp in the last 24h → free-form text (session window)
//   - Otherwise → template message (required for cold/first-contact outbound)
//
// Template model: each tenant has a whatsapp_template_name on company_bios
// (default: 'swl_outbound_v1'). Template has one body variable: the full
// personalized message. Template must be pre-approved in Meta Business Manager.
//
// Credentials:
//   - WHATSAPP_ACCESS_TOKEN env var (permanent system user token, shared across tenants)
//   - company_bios.whatsapp_phone_number_id (per-tenant sending number)
//
// Auth: same Bearer CRON_SECRET pattern as other dispatchers.

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
const WA_API_VERSION = "v20.0";
const WA_BASE = `https://graph.facebook.com/${WA_API_VERSION}`;
const BATCH_SIZE = 5;
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

type QueuedMsg = {
  id: string;
  campaign_id: string;
  lead_id: string;
  step_number: number;
  content: string | null;
  metadata: Record<string, unknown> | null;
};

function authorized(req: NextRequest, scopeRole: string | null): boolean {
  if (scopeRole === "admin") return true;
  if (!CRON_SECRET) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${CRON_SECRET}`;
}

function personalize(text: string, lead: any, seller: any): string {
  const first = lead?.primary_first_name ?? "there";
  const sellerName = seller?.name ?? "";
  const company = lead?.company_name ?? "";
  return (text ?? "")
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{company_name}}", company)
    .replaceAll("{{seller_name}}", sellerName);
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;
  return "+" + digits;
}

async function sendWhatsApp(
  phoneNumberId: string,
  to: string,
  body: string,
  templateName: string,
  templateLanguage: string,
  useSession: boolean,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const payload = useSession
    ? {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body, preview_url: false },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: body }],
            },
          ],
        },
      };

  try {
    const res = await fetch(`${WA_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` };
    }
    const msgId = data?.messages?.[0]?.id ?? undefined;
    return { ok: true, messageId: msgId };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  if (!WA_TOKEN) {
    return NextResponse.json({ error: "WHATSAPP_ACCESS_TOKEN not configured" }, { status: 500 });
  }

  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (!authorized(req, (scope as any).role ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();
  const nowMs = Date.now();
  const sessionCutoff = new Date(nowMs - SESSION_WINDOW_MS).toISOString();

  const { data: candidates } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, step_number, content, metadata")
    .eq("status", "queued")
    .eq("channel", "whatsapp")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, reason: "no queued whatsapp messages" });
  }

  const outcomes: Array<{ msgId: string; kind: string; reason?: string }> = [];

  for (const msg of candidates as QueuedMsg[]) {
    // Atomic claim
    const { data: locked } = await svc
      .from("campaign_messages")
      .update({ status: "dispatching", dispatching_since: new Date().toISOString() })
      .eq("id", msg.id)
      .eq("status", "queued")
      .select("id");
    if (!locked || locked.length === 0) {
      outcomes.push({ msgId: msg.id, kind: "lost_race" });
      continue;
    }

    // Hydrate lead + campaign + seller + company config
    const [{ data: lead }, { data: campaign }] = await Promise.all([
      svc.from("leads")
        .select("id, primary_first_name, primary_last_name, primary_phone, primary_secondary_phone, company_name, company_bio_id, primary_title_role")
        .eq("id", msg.lead_id).maybeSingle(),
      svc.from("campaigns")
        .select("id, seller_id")
        .eq("id", msg.campaign_id).maybeSingle(),
    ]);

    if (!lead || !campaign) {
      await svc.from("campaign_messages").update({ status: "failed", error_details: "lead or campaign missing" }).eq("id", msg.id);
      outcomes.push({ msgId: msg.id, kind: "failed", reason: "lead or campaign missing" });
      continue;
    }

    const phone = normalizePhone((lead as any).primary_phone || (lead as any).primary_secondary_phone);
    if (!phone) {
      await svc.from("campaign_messages").update({ status: "failed", error_details: "no phone number" }).eq("id", msg.id);
      outcomes.push({ msgId: msg.id, kind: "failed", reason: "no phone number" });
      continue;
    }

    // Resolve company WhatsApp config
    const bioId = (lead as any).company_bio_id;
    const { data: bio } = await svc
      .from("company_bios")
      .select("whatsapp_phone_number_id, whatsapp_template_name")
      .eq("id", bioId)
      .maybeSingle();

    const phoneNumberId = (bio as any)?.whatsapp_phone_number_id;
    if (!phoneNumberId) {
      await svc.from("campaign_messages").update({ status: "failed", error_details: "tenant has no whatsapp_phone_number_id" }).eq("id", msg.id);
      outcomes.push({ msgId: msg.id, kind: "failed", reason: "no whatsapp config" });
      continue;
    }

    const templateName = (bio as any)?.whatsapp_template_name ?? "swl_outbound_v1";

    // Check if session window is open (lead replied via whatsapp in last 24h)
    const { data: recentReply } = await svc
      .from("lead_replies")
      .select("id")
      .eq("lead_id", msg.lead_id)
      .eq("channel", "whatsapp")
      .gte("received_at", sessionCutoff)
      .limit(1)
      .maybeSingle();
    const useSession = !!recentReply;

    // Resolve seller for personalization
    const { data: seller } = campaign.seller_id
      ? await svc.from("sellers").select("name").eq("id", campaign.seller_id).maybeSingle()
      : { data: null };

    const body = personalize(msg.content ?? "", lead, seller);
    if (!body.trim()) {
      await svc.from("campaign_messages").update({ status: "failed", error_details: "empty message body after personalization" }).eq("id", msg.id);
      outcomes.push({ msgId: msg.id, kind: "failed", reason: "empty body" });
      continue;
    }

    // Determine template language from message content (default en_US)
    const templateLanguage = ((msg.metadata as any)?.language as string) === "es" ? "es_AR" : "en_US";

    const result = await sendWhatsApp(phoneNumberId, phone, body, templateName, templateLanguage, useSession);

    const nowISO = new Date().toISOString();
    if (!result.ok) {
      await svc.from("campaign_messages").update({
        status: "failed",
        error_details: result.error,
        metadata: { ...(msg.metadata ?? {}), dispatched_by: "cron-dispatch-whatsapp", failed_at: nowISO },
      }).eq("id", msg.id);
      outcomes.push({ msgId: msg.id, kind: "failed", reason: result.error });
      continue;
    }

    await Promise.all([
      svc.from("campaign_messages").update({
        status: "sent",
        sent_at: nowISO,
        error_details: null,
        metadata: {
          ...(msg.metadata ?? {}),
          dispatched_by: "cron-dispatch-whatsapp",
          wa_message_id: result.messageId,
          phone_number_id: phoneNumberId,
          used_session: useSession,
          template_name: useSession ? null : templateName,
        },
      }).eq("id", msg.id),
      svc.from("leads").update({ status: "contacted", current_channel: "whatsapp" }).eq("id", msg.lead_id),
    ]);

    outcomes.push({ msgId: msg.id, kind: "sent" });
  }

  const sent = outcomes.filter(o => o.kind === "sent").length;
  const failed = outcomes.filter(o => o.kind === "failed").length;
  return NextResponse.json({ ok: true, processed: candidates.length, sent, failed, outcomes });
}
