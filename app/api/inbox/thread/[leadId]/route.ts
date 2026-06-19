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
  // Which seller / LinkedIn account this outbound message was sent from, so
  // the seller can see "who's responsible" for each touch (Fran 2026-06-16).
  senderName?: string | null;
  attachments?: ThreadAttachment[];
  // Delivery / read receipts from Unipile (LinkedIn shows "Seen" with a
  // timestamp once the recipient opens the chat). seenAt = ISO when the
  // lead first read this outbound message.
  seen?: boolean;
  seenAt?: string | null;
  delivered?: boolean;
  // Call entries: link + meta so the UI renders a compact, clickable outcome.
  callId?: string | null;
  durationSec?: number | null;
  hasRecording?: boolean;
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

  // ─── Pull DB-tracked messages (sent only) + replies + calls in parallel ───
  const [messagesRes, repliesRes, callsRes] = await Promise.all([
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
    // Calls show as a COMPACT outcome entry (icon + outcome + 1-line note),
    // clickable through to the Calls tab — no transcript dumped inline. The
    // matching channel='call' lead_replies ("Call outcome: …" markers) are
    // skipped below to avoid a duplicate row.
    svc
      .from("calls")
      .select("id, classification, status, duration, notes, transcript, recording_url, aircall_call_id, started_at")
      .eq("lead_id", leadId)
      .order("started_at", { ascending: true }),
  ]);

  const entries: ThreadEntry[] = [];
  // Track provider IDs we've already seen so Unipile fetch can dedupe.
  const seenProviderIds = new Set<string>();
  // Discover the Unipile chat_id from whichever source has it.
  let chatIdFromDb: string | null = null;
  let providerThreadId: string | null = null;

  // Resolve the seller who owns this flow ONCE, up-front: their name labels
  // every outbound bubble ("who's responsible"), and their Unipile account id
  // tells the live-chat fetch below which messages are "ours".
  const { data: campSeller } = await svc
    .from("campaigns")
    .select("seller_id, sellers(name, unipile_account_id)")
    .eq("lead_id", leadId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sellerName: string | null = (campSeller as any)?.sellers?.name ?? null;
  const unipileAccountId: string | null = (campSeller as any)?.sellers?.unipile_account_id ?? null;

  for (const m of messagesRes.data ?? []) {
    const sentAt = (m as any).sent_at;
    if (!sentAt) continue; // defensive — status=sent without sent_at shouldn't happen
    const meta = ((m as any).metadata ?? {}) as Record<string, unknown>;
    const renderedFromMeta = typeof meta.rendered_content === "string" ? (meta.rendered_content as string) : null;
    const body = renderedFromMeta || ((m as any).content as string | null) || "";
    const provId = ((m as any).provider_message_id as string | null) ?? null;
    if (provId) seenProviderIds.add(provId);
    if (!chatIdFromDb && typeof meta.chat_id === "string") chatIdFromDb = meta.chat_id as string;
    const subject = typeof meta.subject === "string" ? (meta.subject as string) : null;
    // Distinguish a manual seller reply from a bot auto-reply: both live at
    // step -1 (off-sequence), but metadata.manual_seller_reply flags the human
    // one. Without this a seller's own reply got mislabeled "Auto-reply".
    const stepNum = (m as any).step_number ?? null;
    const kind = meta.manual_seller_reply === true
      ? "manual_seller_reply"
      : stepNum === -1
        ? "auto_reply"
        : "sent";
    const channel = (m as any).channel ?? null;
    entries.push({
      id: `out-${(m as any).id}`,
      direction: "outbound",
      channel,
      body,
      subject,
      at: sentAt,
      stepNumber: stepNum,
      kind,
      providerMessageId: provId,
      source: "db",
      senderName: channel === "linkedin" ? sellerName : null,
    });
  }

  for (const r of repliesRes.data ?? []) {
    if (!providerThreadId && typeof (r as any).provider_thread_id === "string") {
      providerThreadId = (r as any).provider_thread_id;
    }
    // Skip call markers — calls render as their own compact outcome entry
    // (built from the calls table below), not as an inbound text reply.
    if ((r as any).channel === "call") continue;
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

  // Calls → one compact outcome entry each. Dedupe the two-rows-per-call
  // (dial-marker + Aircall record) by minute, keeping the richest row.
  {
    const score = (c: any) => (c.classification ? 1 : 0) + (c.notes ? 1 : 0) + (c.transcript ? 1 : 0) + (c.recording_url ? 1 : 0);
    const byMinute = new Map<string, any>();
    for (const c of callsRes.data ?? []) {
      if (!c.started_at) continue;
      if (!c.classification && c.status !== "answered") continue; // skip pure dial attempts
      const key = new Date(c.started_at).toISOString().slice(0, 16);
      const prev = byMinute.get(key);
      if (!prev || score(c) > score(prev)) byMinute.set(key, c);
    }
    for (const c of byMinute.values()) {
      const note = (c.notes ?? "").toString().trim();
      const summary = note ? (note.length > 140 ? note.slice(0, 140) + "…" : note) : "";
      const hasRec = !!c.recording_url || (c.status === "answered" && (c.duration ?? 0) > 0 && !!c.aircall_call_id);
      entries.push({
        id: `call-${c.id}`,
        direction: "event",
        channel: "call",
        body: summary,
        at: c.started_at,
        classification: (c.classification as string | null) ?? null,
        callId: c.id as string,
        durationSec: (c.duration as number | null) ?? null,
        hasRecording: hasRec,
        kind: "call",
        source: "db",
      });
    }
  }

  // ─── On-demand Unipile top-up ─────────────────────────────────────────
  // The n8n reply handler sometimes only captures the first inbound message
  // in a session; subsequent ones in the same thread can be missed. We pull
  // the live chat history from Unipile and merge anything we don't already
  // have. Same for auto-replies the workflow sent but never wrote back to
  // campaign_messages.
  const chatId = chatIdFromDb || providerThreadId;
  if (chatId) {
    if (unipileAccountId) {
      const url = `${UNIPILE_BASE}/api/v1/chats/${encodeURIComponent(chatId)}/messages?account_id=${encodeURIComponent(unipileAccountId)}&limit=50`;
      const data = await unipileGet(url);
      const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      // Track which message ids the live chat still has + the oldest one we
      // fetched — used below to detect messages deleted on LinkedIn's side.
      const liveUnipileIds = new Set<string>();
      // Messages the seller DELETED on LinkedIn: Unipile keeps the row but
      // flags `deleted: 1` and nulls the text. We must drop our matching DB
      // copy so the app mirrors LinkedIn (Fran 2026-06-16 deleted an auto-reply
      // on Luciano's LinkedIn; the app kept showing it).
      const deletedUnipileIds = new Set<string>();
      let oldestUnipileMs = Number.POSITIVE_INFINITY;
      for (const msg of items) {
        const provId = (msg?.id as string | undefined) ?? null;
        const text = (msg?.text as string | undefined) ?? "";
        const at = (msg?.timestamp as string | undefined) ?? (msg?.created_at as string | undefined);
        if (!at) continue;
        if (provId) liveUnipileIds.add(provId);
        { const tms = new Date(at).getTime(); if (Number.isFinite(tms) && tms < oldestUnipileMs) oldestUnipileMs = tms; }
        // Deleted-on-LinkedIn: record the id and skip entirely (no enrich, no
        // push). The DB-copy removal happens after the loop.
        if (provId && (msg?.deleted === 1 || msg?.deleted === true)) {
          deletedUnipileIds.add(provId);
          continue;
        }
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
        // De-dupe by text+timestamp against entries we already have. Runs
        // even when Unipile provides a provId because (a) lead_replies never
        // stores a per-message provider_message_id (only provider_thread_id),
        // so inbound DB rows can't match by ID, and (b) the CR invite-note
        // gets re-surfaced in /chats/messages after the lead accepts with a
        // timestamp that's MINUTES off the original sent_at (LinkedIn uses
        // the accept time). 10-min window catches both cases without merging
        // genuinely distinct messages — sellers don't fire two identical
        // copies of the same note within the same 10 min.
        const ts = new Date(at).getTime();
        const targetDir = isFromUs ? "outbound" : "inbound";
        const normText = text.trim();
        const dupe = entries.some(e => {
          if (e.direction !== targetDir) return false;
          if ((e.body || "").trim() !== normText) return false;
          // OUTBOUND: identical text = same message, regardless of timestamp.
          // LinkedIn re-surfaces the connection-request note in /chats/messages
          // AFTER the lead accepts — with a NEW message id and the ACCEPT
          // timestamp (hours/days off the original sent_at). So both id-match
          // and the 10-min window miss it and the CR showed twice in the inbox
          // (Fran 2026-06-19). Sellers never fire the exact same outbound text
          // twice in a real thread, so matching on text alone is safe here.
          if (targetDir === "outbound") return true;
          // INBOUND: keep the 10-min window — a lead CAN legitimately repeat a
          // short message ("ok", "gracias") minutes apart, and those are
          // genuinely distinct replies we must not collapse.
          return Math.abs(new Date(e.at).getTime() - ts) < 10 * 60_000;
        });
        if (dupe) continue;
        entries.push({
          id: `unipile-${provId ?? at}`,
          direction: isFromUs ? "outbound" : "inbound",
          channel: "linkedin",
          body: text,
          at,
          providerMessageId: provId,
          source: "unipile",
          kind: isFromUs ? "auto_reply_or_manual" : undefined,
          senderName: isFromUs ? sellerName : null,
          attachments: normalizeAttachments(msg?.attachments),
          seen,
          seenAt,
          delivered,
        });
      }

      // Reflect LinkedIn-side DELETIONS. Two cases, both mean "drop our copy so
      // the app matches LinkedIn" (Fran 2026-06-16 deleted an auto-reply on
      // Luciano's LinkedIn; the app kept showing it):
      //   (a) Unipile returns the message with `deleted: 1` (the common case —
      //       the id stays in the chat, just flagged + text nulled).
      //   (b) The message is GONE from the live chat entirely (rarer). Guarded
      //       to entries newer than the oldest fetched, so messages beyond the
      //       50-message window aren't mistaken for deletions.
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (!(e.direction === "outbound" && e.channel === "linkedin" && e.providerMessageId)) continue;
        const flaggedDeleted = deletedUnipileIds.has(e.providerMessageId);
        const goneFromChat = liveUnipileIds.size > 0
          && e.source === "db"
          && !liveUnipileIds.has(e.providerMessageId)
          && new Date(e.at).getTime() >= oldestUnipileMs;
        if (flaggedDeleted || goneFromChat) entries.splice(i, 1);
      }
    }
  }

  // Final chronological sort. inbound = received_at, outbound = sent_at. Same
  // tz handling via Date.parse — all timestamps end up as ms since epoch.
  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // ─── Campaign stage summary ─────────────────────────────────────────────
  // Surface a brief "where is this lead in the flow?" line for the seller.
  // current_step, totalSteps, next channel/label, status, days until next.
  const { data: campRow } = await svc
    .from("campaigns")
    .select("id, status, current_step, stop_reason, sequence_steps, next_step_due_at, last_step_at, started_at, metadata")
    .eq("lead_id", leadId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let stage: {
    status: string | null;
    currentStep: number | null;
    totalSteps: number | null;
    nextStepLabel: string | null;
    nextStepChannel: string | null;
    nextStepDueAt: string | null;
    stopReason: string | null;
    haltedByReply: boolean;
  } | null = null;
  if (campRow) {
    const seq = Array.isArray((campRow as any).sequence_steps) ? (campRow as any).sequence_steps as any[] : [];
    const cur = (campRow as any).current_step ?? 0;
    // sequence_steps already excludes the CR slot post-2026-05-26, so
    // current_step 0 = waiting on CR accept, 1 = first followup, etc.
    const nextIdx = cur; // current_step is the LAST completed step; next is at index `cur`
    const next = seq[nextIdx] || null;
    const stepLabelFor = (channel: string | null, idx: number, allSteps: any[]) => {
      if (!channel) return "Mensaje";
      const same = allSteps.slice(0, idx + 1).filter(s => s?.channel === channel).length;
      if (channel === "linkedin") return same === 1 ? "First DM" : `LinkedIn Follow-up ${same - 1}`;
      if (channel === "email") return same === 1 ? "Email intro" : `Email Follow-up ${same - 1}`;
      if (channel === "call") return same === 1 ? "First Call" : `Follow-up Call`;
      return channel;
    };
    // Will the next step ACTUALLY fire? Mirror the dispatcher stop-guard: any
    // inbound reply halts the flow unless the campaign was re-engaged (follow_up)
    // AFTER that reply. Without this the header showed "listo para disparar" on
    // a lead who had clearly replied (Fran 2026-06-03).
    const md = ((campRow as any).metadata ?? {}) as Record<string, unknown>;
    const reengaged = md.reengaged === true;
    const reengagedAt = typeof md.reengaged_at === "string" ? (md.reengaged_at as string) : null;
    const lastInboundAt = entries
      .filter(e => e.direction === "inbound" && e.at)
      .map(e => e.at)
      .sort()
      .pop() ?? null;
    const blockingReply = !!lastInboundAt && (!reengaged || !reengagedAt || lastInboundAt > reengagedAt);
    const active = ((campRow as any).status ?? null) === "active";
    stage = {
      status: (campRow as any).status ?? null,
      currentStep: cur,
      totalSteps: seq.length,
      nextStepLabel: next ? stepLabelFor(next.channel, nextIdx, seq) : null,
      nextStepChannel: next?.channel ?? null,
      nextStepDueAt: (campRow as any).next_step_due_at ?? null,
      stopReason: (campRow as any).stop_reason ?? null,
      haltedByReply: active && blockingReply,
    };
  }

  return NextResponse.json({ thread: entries, stage });
}
