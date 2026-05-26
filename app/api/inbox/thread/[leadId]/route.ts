// Returns the full chronological conversation for a lead — outbound messages
// we actually sent (campaign_messages where status='sent') merged with inbound
// replies (lead_replies), and topped up on-demand from Unipile to catch any
// messages the n8n reply handler missed (sometimes a lead sends 2 messages
// back-to-back and only the first lands in lead_replies).
//
// IMPORTANT: only status='sent' campaign_messages are returned. Queued/draft
// messages are FUTURE sends — including them in the thread (a) confuses the
// seller into thinking we sent template text with raw placeholders (the
// rendered_content slot fills only at send time), and (b) breaks the
// chronological order since they fall back to created_at which is the
// approval timestamp, not the dispatch timestamp.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const runtime = "nodejs";

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY ?? "";

type ThreadAttachment = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  url?: string | null;
  thumbUrl?: string | null;
  size?: number | null;
  // Convenience flag — anything image/* renders inline, others render as a
  // file pill with the icon + name.
  isImage?: boolean;
};

type ThreadEntry = {
  id: string;
  direction: "outbound" | "inbound" | "event";
  channel: string | null;
  body: string;
  subject?: string | null;
  at: string;
  classification?: string | null;
  stepNumber?: number | null;
  kind?: string;
  providerMessageId?: string | null;
  source?: "db" | "unipile";
  attachments?: ThreadAttachment[];
  // Delivery / read receipts from Unipile (LinkedIn shows "Seen" with a
  // timestamp once the recipient opens the chat). seenAt = ISO when the
  // lead first read this outbound message.
  seen?: boolean;
  seenAt?: string | null;
  delivered?: boolean;
};

function normalizeAttachments(raw: any): ThreadAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a: any) => {
    const mime = a?.mime_type ?? a?.mimeType ?? a?.type ?? null;
    return {
      id: a?.id ?? null,
      name: a?.file_name ?? a?.name ?? null,
      mimeType: mime,
      url: a?.url ?? a?.file_url ?? null,
      thumbUrl: a?.thumb_url ?? a?.thumbnail ?? null,
      size: a?.size ?? null,
      isImage: typeof mime === "string" && mime.startsWith("image/"),
    };
  });
}

async function unipileGet(url: string): Promise<any | null> {
  if (!UNIPILE_KEY) return null;
  try {
    const res = await fetch(url, {
      headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { leadId } = await params;
  if (!leadId) return NextResponse.json({ error: "missing leadId" }, { status: 400 });

  const svc = getSupabaseService();

  // Tenant gate.
  if (scope.isScoped && scope.companyBioId) {
    const { data: lead } = await svc
      .from("leads")
      .select("company_bio_id")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead || lead.company_bio_id !== scope.companyBioId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  // ─── Pull DB-tracked messages (sent only) + replies in parallel ───
  const [messagesRes, repliesRes] = await Promise.all([
    svc
      .from("campaign_messages")
      .select("id, step_number, channel, content, status, sent_at, metadata, provider_message_id")
      .eq("lead_id", leadId)
      .eq("status", "sent")
      .order("sent_at", { ascending: true }),
    svc
      .from("lead_replies")
      .select("id, channel, reply_text, received_at, classification, provider_thread_id")
      .eq("lead_id", leadId)
      .order("received_at", { ascending: true }),
  ]);

  const entries: ThreadEntry[] = [];
  // Track provider IDs we've already seen so Unipile fetch can dedupe.
  const seenProviderIds = new Set<string>();
  // Discover the Unipile chat_id from whichever source has it.
  let chatIdFromDb: string | null = null;
  let providerThreadId: string | null = null;

  for (const m of messagesRes.data ?? []) {
    const sentAt = (m as any).sent_at;
    if (!sentAt) continue; // defensive — status=sent without sent_at shouldn't happen
    const meta = ((m as any).metadata ?? {}) as Record<string, unknown>;
    const renderedFromMeta = typeof meta.rendered_content === "string" ? (meta.rendered_content as string) : null;
    const body = renderedFromMeta || ((m as any).content as string | null) || "";
    const provId = ((m as any).provider_message_id as string | null) ?? null;
    if (provId) seenProviderIds.add(provId);
    if (!chatIdFromDb && typeof meta.chat_id === "string") chatIdFromDb = meta.chat_id as string;
    entries.push({
      id: `out-${(m as any).id}`,
      direction: "outbound",
      channel: (m as any).channel ?? null,
      body,
      at: sentAt,
      stepNumber: (m as any).step_number ?? null,
      kind: "sent",
      providerMessageId: provId,
      source: "db",
    });
  }

  for (const r of repliesRes.data ?? []) {
    if (!providerThreadId && typeof (r as any).provider_thread_id === "string") {
      providerThreadId = (r as any).provider_thread_id;
    }
    entries.push({
      id: `in-${(r as any).id}`,
      direction: "inbound",
      channel: (r as any).channel ?? null,
      body: (r as any).reply_text || "",
      at: (r as any).received_at,
      classification: (r as any).classification ?? null,
      source: "db",
    });
  }

  // ─── On-demand Unipile top-up ─────────────────────────────────────────
  // The n8n reply handler sometimes only captures the first inbound message
  // in a session; subsequent ones in the same thread can be missed. We pull
  // the live chat history from Unipile and merge anything we don't already
  // have. Same for auto-replies the workflow sent but never wrote back to
  // campaign_messages.
  const chatId = chatIdFromDb || providerThreadId;
  if (chatId) {
    // Find the seller's Unipile account so we know which message is "ours".
    const { data: camp } = await svc
      .from("campaigns")
      .select("seller_id")
      .eq("lead_id", leadId)
      .limit(1)
      .maybeSingle();
    const sellerId = (camp as any)?.seller_id ?? null;
    let unipileAccountId: string | null = null;
    if (sellerId) {
      const { data: seller } = await svc
        .from("sellers")
        .select("unipile_account_id")
        .eq("id", sellerId)
        .maybeSingle();
      unipileAccountId = (seller as any)?.unipile_account_id ?? null;
    }

    if (unipileAccountId) {
      const url = `${UNIPILE_BASE}/api/v1/chats/${encodeURIComponent(chatId)}/messages?account_id=${encodeURIComponent(unipileAccountId)}&limit=50`;
      const data = await unipileGet(url);
      const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      for (const msg of items) {
        const provId = (msg?.id as string | undefined) ?? null;
        const text = (msg?.text as string | undefined) ?? "";
        const at = (msg?.timestamp as string | undefined) ?? (msg?.created_at as string | undefined);
        if (!at) continue;
        // Compute receipt flags up-front so we can enrich an already-merged
        // DB entry OR attach to a new Unipile-sourced entry.
        const seenInt = msg?.seen;
        const seen = seenInt === 1 || seenInt === true;
        const deliveredInt = msg?.delivered;
        const delivered = deliveredInt === 1 || deliveredInt === true;
        let seenAt: string | null = null;
        if (seen && msg?.seen_by && typeof msg.seen_by === "object") {
          for (const v of Object.values(msg.seen_by)) {
            if (typeof v === "string") { seenAt = v; break; }
          }
        }
        // If we already have this message from the DB, enrich it with the
        // receipt info instead of re-pushing it. That way "Visto" badges
        // show up on every outbound entry — DB or Unipile sourced — without
        // duplicating the bubble.
        if (provId && seenProviderIds.has(provId)) {
          const existing = entries.find(e => e.providerMessageId === provId);
          if (existing) {
            existing.seen = seen;
            existing.seenAt = seenAt;
            existing.delivered = delivered;
          }
          continue;
        }
        // Unipile flags whether the sender is the connected account ("us").
        // Critical: Unipile returns `is_sender` as a numeric 0/1, NOT a
        // boolean — `=== true` always fails and the message gets mis-attributed
        // to the lead. Fran caught this on 2026-05-26 (Diego Acosta thread
        // showed our outbound intro labelled as "Diego Acosta replied").
        const isFromUs =
          msg?.is_sender === true || msg?.is_sender === 1 ||
          msg?.from_me === true || msg?.from_me === 1 ||
          (typeof msg?.sender_id === "string" && msg.sender_id === unipileAccountId);
        // De-dupe inbound messages by text+timestamp (within 60s) against
        // what we already have, since lead_replies stores reply_text but not
        // the provider_message_id in older rows.
        if (!provId) {
          const ts = new Date(at).getTime();
          const dupe = entries.some(e => {
            if (e.direction !== (isFromUs ? "outbound" : "inbound")) return false;
            const diff = Math.abs(new Date(e.at).getTime() - ts);
            return diff < 60_000 && (e.body || "").trim() === text.trim();
          });
          if (dupe) continue;
        }
        entries.push({
          id: `unipile-${provId ?? at}`,
          direction: isFromUs ? "outbound" : "inbound",
          channel: "linkedin",
          body: text,
          at,
          providerMessageId: provId,
          source: "unipile",
          kind: isFromUs ? "auto_reply_or_manual" : undefined,
          attachments: normalizeAttachments(msg?.attachments),
          seen,
          seenAt,
          delivered,
        });
      }
    }
  }

  // Final chronological sort. inbound = received_at, outbound = sent_at. Same
  // tz handling via Date.parse — all timestamps end up as ms since epoch.
  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return NextResponse.json({ thread: entries });
}
