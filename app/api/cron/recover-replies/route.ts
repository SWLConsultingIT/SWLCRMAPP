// Safety-net reply recovery (boss 2026-06-09: "arregla los reply handlers para
// siempre... nunca más se rompe"). The n8n webhook handlers drop replies
// whenever (a) Unipile isn't subscribed to a seller's account, (b) the lead
// match by linkedin_internal_id misses, or (c) the lead has no campaign_id —
// all of which silently lose the reply. This cron is the backstop: it READS the
// inbox (Unipile chats + Instantly received emails) directly — no profile views,
// so no account-ban risk — and inserts any inbound message missing from
// lead_replies, with a campaign_id + classification so it surfaces in /queue
// Inbox. Idempotent (dedupes on lead + text prefix). Bounded to a recent window
// so a periodic run stays fast.
//
// Auth: Bearer CRON_SECRET. Wire into the Orquestador (15-min branch) OR call
// manually with ?days=N to widen the lookback.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // many Unipile + Instantly calls; needs headroom

const CRON_SECRET = process.env.CRON_SECRET;
const UNIPILE_BASE = process.env.UNIPILE_DSN ? `https://${process.env.UNIPILE_DSN}` : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY ?? "";
const INSTANTLY_KEY = process.env.INSTANTLY_API_KEY ?? "";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Svc = ReturnType<typeof getSupabaseService>;

// Resolve the lead's campaign to stamp on the reply (the Inbox query inner-joins
// campaigns, so a null campaign_id reply is invisible). Prefer active/paused.
async function campaignFor(svc: Svc, leadId: string): Promise<string | null> {
  const { data } = await svc.from("campaigns").select("id, status, created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(10);
  if (!data || data.length === 0) return null;
  return (data.find(c => c.status === "active" || c.status === "paused") ?? data[0]).id as string;
}

// Insert a recovered reply if not already present (dedupe on lead + first 60
// chars). classification=needs_info so it passes the Inbox's `!= auto_reply`
// filter (a NULL classification is excluded by that SQL predicate) and lands in
// Pending review for the seller to classify. No AI here — per the
// always-use-n8n-for-AI law, classification stays manual.
async function insertIfNew(svc: Svc, leadId: string, channel: string, text: string, receivedAt: string | null, providerThreadId?: string | null): Promise<boolean> {
  const { data: existing } = await svc.from("lead_replies").select("reply_text").eq("lead_id", leadId).eq("channel", channel).limit(80);
  const seen = new Set((existing ?? []).map(e => (e.reply_text ?? "").slice(0, 60)));
  if (seen.has(text.slice(0, 60))) return false;
  const campaignId = await campaignFor(svc, leadId);
  const { error } = await svc.from("lead_replies").insert({
    lead_id: leadId,
    campaign_id: campaignId,
    channel,
    reply_text: text.slice(0, 2000),
    classification: "needs_info",
    received_at: receivedAt ?? new Date().toISOString(),
    requires_human_review: true,
    review_status: "pending",
    // Store the chat id so the Inbox composer can reply without a Unipile lookup.
    ...(providerThreadId ? { provider_thread_id: providerThreadId } : {}),
  });
  return !error;
}

// Re-injection target: the live LinkedIn Response Handler webhook. Posting the
// same payload Unipile sends (see `Code - Parse & Validate` in h2uBZscVnZy0utLD)
// makes the handler run its FULL path — classify (Haiku) → auto-reply on
// positive/negative → persist + close-campaign side effects — even when Unipile
// never delivered the original event (the #1 drop cause). Only used for RECENT
// replies; stale ones go to manual review so we never auto-reply hours late.
const N8N_BASE = (process.env.N8N_API_BASE_URL ?? "https://n8n.srv949269.hstgr.cloud").replace(/\/+$/, "");
const LINKEDIN_HANDLER_WEBHOOK = `${N8N_BASE}/webhook/linkedin-response-handler`;
const REINJECT_MAX_AGE_MIN = 45;

async function replyExists(svc: Svc, leadId: string, channel: string, text: string): Promise<boolean> {
  const { data } = await svc.from("lead_replies").select("reply_text").eq("lead_id", leadId).eq("channel", channel).limit(80);
  return new Set((data ?? []).map(e => (e.reply_text ?? "").slice(0, 60))).has(text.slice(0, 60));
}

async function reinjectLinkedIn(acct: string, chatId: string, senderProviderId: string, senderName: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(LINKEDIN_HANDLER_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account_id: acct,
        chat_id: chatId,
        text,
        sender: { attendee_provider_id: senderProviderId, attendee_name: senderName },
        is_sender: false,
      }),
    });
    return r.ok;
  } catch { return false; }
}

async function uni(path: string): Promise<any> {
  try {
    const r = await fetch(`${UNIPILE_BASE}${path}`, { headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" } });
    if (!r.ok) return { items: [] };
    return await r.json();
  } catch { return { items: [] }; }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const days = Math.min(30, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? "2")));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const svc = getSupabaseService();

  // ── Build match maps ───────────────────────────────────────────────
  const internalToLead = new Map<string, string>();
  const emailToLead = new Map<string, string>();
  for (let off = 0; ; off += 1000) {
    const { data } = await svc.from("leads").select("id, linkedin_internal_id, primary_work_email").range(off, off + 999);
    if (!data || data.length === 0) break;
    for (const l of data) {
      if (l.linkedin_internal_id) internalToLead.set(l.linkedin_internal_id as string, l.id as string);
      const e = (l.primary_work_email as string | null)?.trim().toLowerCase();
      if (e && !emailToLead.has(e)) emailToLead.set(e, l.id as string);
    }
    if (data.length < 1000) break;
  }

  let linkedinRecovered = 0;
  let linkedinReinjected = 0;
  let emailRecovered = 0;

  // ── LinkedIn: poll each seller account's recent chats ──────────────
  if (UNIPILE_KEY) {
    const { data: sellers } = await svc.from("sellers").select("unipile_account_id").not("unipile_account_id", "is", null);
    const accounts = [...new Set((sellers ?? []).map(s => s.unipile_account_id as string))];
    for (const acct of accounts) {
      const chats = (await uni(`/api/v1/chats?account_id=${acct}&limit=100`))?.items ?? [];
      for (const ch of chats) {
        if ((ch.timestamp ?? "") < cutoff) continue;
        const leadId = internalToLead.get(ch.attendee_provider_id);
        if (!leadId) continue;
        const msgs = (await uni(`/api/v1/chats/${ch.id}/messages?limit=15`))?.items ?? [];
        for (const m of msgs) {
          const inbound = m.is_sender === 0 || m.is_sender === false;
          const text = (m.text ?? "").trim();
          if (!inbound || !text || (m.timestamp ?? "") < cutoff) continue;
          if (await replyExists(svc, leadId, "linkedin", text)) continue; // already captured
          const ageMin = m.timestamp ? (Date.now() - Date.parse(m.timestamp)) / 60000 : Infinity;
          if (ageMin <= REINJECT_MAX_AGE_MIN && await reinjectLinkedIn(acct, ch.id, ch.attendee_provider_id, m.sender_name ?? ch.name ?? "", text)) {
            // Handler inserts the lead_reply (with real classification) BEFORE its
            // 2-5min send-delay → poll briefly. If it lands, the handler owns it
            // (classified + auto-replied). If not, the handler dropped it (terminal
            // lead / no matching campaign) → fall back to manual-review recovery.
            let handled = false;
            for (const w of [4000, 4000, 4000, 3000]) {
              await sleep(w);
              if (await replyExists(svc, leadId, "linkedin", text)) { handled = true; break; }
            }
            if (handled) linkedinReinjected++;
            else if (await insertIfNew(svc, leadId, "linkedin", text, m.timestamp ?? null, ch.id)) linkedinRecovered++;
          } else if (await insertIfNew(svc, leadId, "linkedin", text, m.timestamp ?? null, ch.id)) {
            linkedinRecovered++; // stale (no late auto-reply) or handler unreachable
          }
        }
        await sleep(120);
      }
    }
  }

  // ── Email: poll Instantly received emails across EVERY workspace ───
  // Instantly is multi-workspace (one API key per workspace: Pathway, Arqy, …
  // in `instantly_workspaces`, plus the env default). The env key only sees ONE
  // workspace, so before this the cron's email backup silently skipped every
  // other tenant's inbox — Pathway/Arqy replies would be invisible to the safety
  // net if the primary n8n handler ever missed them. Gather all keys + dedupe,
  // then run the same paginated poll per key. (2026-07-01)
  const instantlyKeys = new Set<string>();
  if (INSTANTLY_KEY) instantlyKeys.add(INSTANTLY_KEY);
  const { data: workspaces } = await svc.from("instantly_workspaces").select("api_key");
  for (const w of workspaces ?? []) {
    const k = (w as any).api_key as string | null;
    if (k) instantlyKeys.add(k);
  }

  for (const key of instantlyKeys) {
    let cursor: string | null = null;
    for (let page = 0; page < 15; page++) {
      let body: any = { items: [] };
      const url = `https://api.instantly.ai/api/v2/emails?limit=100&email_type=received${cursor ? `&starting_after=${cursor}` : ""}`;
      for (let t = 0; t < 5; t++) {
        try {
          const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, accept: "application/json", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" } });
          if (r.status === 403 || r.status === 429) { await sleep(5000); continue; }
          body = await r.json(); break;
        } catch { await sleep(3000); }
      }
      const items: any[] = body.items ?? [];
      if (items.length === 0) break;
      let stop = false;
      for (const m of items) {
        if ((m.timestamp_email ?? "") < cutoff) { stop = true; break; }
        const leadId = emailToLead.get((m.from_address_email ?? "").trim().toLowerCase());
        if (!leadId) continue;
        // Instantly returns `body: { text, html }` (the FULL message) plus a
        // ~60-char `content_preview`. Use the full plain-text body; fall back
        // to stripped HTML, then the preview only as a last resort. Pre-fix
        // this read content_preview first → every email reply recovered by
        // this cron was truncated to ~60 chars mid-word (incident 2026-06-22,
        // started when recover-replies was wired to the Orquestador 06-11).
        const full =
          (typeof m.body?.text === "string" && m.body.text.trim())
            ? m.body.text
            : (typeof m.body?.html === "string" && m.body.html.trim())
              ? m.body.html.replace(/<[^>]+>/g, " ")
              : (m.content_preview ?? "");
        const text = full.trim();
        if (!text) continue;
        if (await insertIfNew(svc, leadId, "email", text, m.timestamp_email ?? null)) emailRecovered++;
      }
      if (stop) break;
      cursor = items[items.length - 1]?.id ?? null;
      if (!cursor) break;
      await sleep(700);
    }
  }

  return NextResponse.json({ ok: true, windowDays: days, instantlyWorkspaces: instantlyKeys.size, linkedinRecovered, linkedinReinjected, emailRecovered });
}
