// One-shot dispatcher for the 8 Pathway step-0 messages stuck in queued.
// Mirrors the logic in app/api/cron/dispatch-queue/route.ts but runs locally
// without depending on Vercel deploy or n8n. Reads .env.local for credentials.
//
// Usage: node scripts/dispatch-pathway-8.mjs
//
// Behavior:
//   - 75s gap between dispatches (LinkedIn-friendly)
//   - Per message: atomic queued → dispatching, resolve provider_id with name
//     verification, send invite with personalized note, mark sent + lead contacted
//   - Logs each step. Exits on first hard error so we can debug, instead of
//     burning the whole batch.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);

// Read .env.local manually (no dependency on dotenv).
const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envText.split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_KEY;
const UP_KEY = env.UNIPILE_API_KEY;
const UP_DSN = env.UNIPILE_DSN;
const UP_BASE = UP_DSN ? `https://${UP_DSN}` : "https://api21.unipile.com:15107";

if (!SB_URL || !SB_KEY) { console.error("missing supabase env"); process.exit(1); }
if (!UP_KEY) { console.error("missing UNIPILE_API_KEY"); process.exit(1); }

const NOTE_MAX = 300;
// 35 minutes between invites — LinkedIn flagged Graeme's account on the
// first attempt with 75s throttle (3 invites in 4 min = burst protection).
// Slower cadence for new automation accounts. Future runs can lower this
// once the account is warmed up.
const THROTTLE_MS = 35 * 60 * 1000;

const sbHdrs = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...init,
    headers: { ...sbHdrs, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path} → ${res.status}: ${text}`);
  return body;
}

async function unipile(path, init = {}) {
  const res = await fetch(`${UP_BASE}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": UP_KEY,
      accept: "application/json",
      ...(init.method === "POST" ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    const reason = body?.detail || body?.title || body?.message || text || `HTTP ${res.status}`;
    throw new Error(`Unipile ${init.method || "GET"} ${path} → ${res.status}: ${reason}`);
  }
  return body;
}

function extractSlug(url) {
  if (!url) return null;
  const m = url.match(/\/in\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function nameMatches(expF, expL, apiF, apiL) {
  const ef = (expF ?? "").trim().toLowerCase();
  const el = (expL ?? "").trim().toLowerCase();
  const af = (apiF ?? "").trim().toLowerCase();
  const al = (apiL ?? "").trim().toLowerCase();
  if (!ef || !el || !af || !al) return false;
  return af.startsWith(ef.slice(0, 3)) && al.startsWith(el.slice(0, 3));
}

function personalize(template, lead, seller) {
  return (template ?? "")
    .replaceAll("{{first_name}}", lead.primary_first_name ?? "there")
    .replaceAll("{{seller_name}}", seller.name ?? "");
}

async function failMsg(id, reason) {
  await sb(`/campaign_messages?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "failed",
      error_details: reason,
      metadata: { dispatched_by: "dispatch-pathway-8.mjs", failed_at: new Date().toISOString() },
    }),
  });
}

async function dispatchOne(msgId, idx, total) {
  console.log(`\n[${idx}/${total}] msg=${msgId.slice(0, 8)} — claiming…`);
  const claimed = await sb(
    `/campaign_messages?id=eq.${msgId}&status=eq.queued&select=id,campaign_id,lead_id,content`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "dispatching" }) },
  );
  if (!claimed?.length) {
    console.log(`  ✗ lost race or wrong status`);
    return { ok: false, skipped: true };
  }
  const msg = claimed[0];

  const leadRows = await sb(`/leads?id=eq.${msg.lead_id}&select=id,primary_first_name,primary_last_name,primary_linkedin_url,linkedin_internal_id`);
  const lead = leadRows?.[0];
  if (!lead) { await failMsg(msg.id, "lead not found"); return { ok: false }; }

  const campRows = await sb(`/campaigns?id=eq.${msg.campaign_id}&select=id,seller_id`);
  const camp = campRows?.[0];
  if (!camp?.seller_id) { await failMsg(msg.id, "campaign has no seller_id"); return { ok: false }; }

  const sellerRows = await sb(`/sellers?id=eq.${camp.seller_id}&select=id,name,unipile_account_id,linkedin_status`);
  const seller = sellerRows?.[0];
  if (!seller?.unipile_account_id) { await failMsg(msg.id, "seller missing unipile_account_id"); return { ok: false }; }
  if (seller.linkedin_status === "restricted") { await failMsg(msg.id, "seller restricted"); return { ok: false }; }

  const slug = extractSlug(lead.primary_linkedin_url);
  if (!slug) { await failMsg(msg.id, "no LinkedIn slug"); return { ok: false }; }

  let providerId = lead.linkedin_internal_id ?? null;
  console.log(`  · lead=${lead.primary_first_name} ${lead.primary_last_name} slug=${slug}`);

  if (!providerId) {
    let userResp;
    try {
      userResp = await unipile(`/api/v1/users/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(seller.unipile_account_id)}`);
    } catch (e) {
      await failMsg(msg.id, e.message);
      console.log(`  ✗ Unipile user lookup failed: ${e.message}`);
      return { ok: false };
    }
    const apiF = userResp?.first_name ?? "";
    const apiL = userResp?.last_name ?? "";
    if (!nameMatches(lead.primary_first_name, lead.primary_last_name, apiF, apiL)) {
      const reason = `name mismatch — expected "${lead.primary_first_name} ${lead.primary_last_name}", Unipile returned "${apiF} ${apiL}"`;
      await failMsg(msg.id, reason);
      console.log(`  ✗ ${reason}`);
      return { ok: false };
    }
    providerId = userResp?.provider_id ?? null;
    if (!providerId) { await failMsg(msg.id, "no provider_id from Unipile"); return { ok: false }; }
    await sb(`/leads?id=eq.${lead.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ linkedin_internal_id: providerId }),
    });
  }

  let note = personalize(msg.content, lead, seller).trim();
  let truncated = false;
  if (note.length > NOTE_MAX) {
    note = note.slice(0, NOTE_MAX - 1).trimEnd() + "…";
    truncated = true;
  }

  console.log(`  · note (${note.length} chars): ${note.slice(0, 80)}${note.length > 80 ? "…" : ""}`);

  let inviteResp;
  try {
    inviteResp = await unipile("/api/v1/users/invite", {
      method: "POST",
      body: JSON.stringify({
        account_id: seller.unipile_account_id,
        provider_id: providerId,
        message: note || undefined,
      }),
    });
  } catch (e) {
    await failMsg(msg.id, e.message);
    console.log(`  ✗ Unipile invite failed: ${e.message}`);
    return { ok: false };
  }

  const invitationId = inviteResp?.invitation_id ?? null;

  await Promise.all([
    sb(`/campaign_messages?id=eq.${msg.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: invitationId,
        error_details: null,
        metadata: { dispatched_by: "dispatch-pathway-8.mjs", truncated_note: truncated },
      }),
    }),
    sb(`/leads?id=eq.${lead.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "contacted", current_channel: "linkedin" }),
    }),
  ]);

  console.log(`  ✓ SENT — invitation_id=${invitationId}`);
  return { ok: true, invitationId };
}

async function main() {
  // Pull the 8 step-0 queued messages, ordered by created_at (same order as cron).
  const ids = "2b976996-911d-4648-bec7-c1e66c10c3b9,7ae649a0-a8b8-4a77-89f7-4b2dc4e5f844,bb080a8b-c797-436c-a107-ebcd1257093f,965157b9-f53a-4112-b747-9df5d4c8d70b,83b22381-0519-42da-9259-f86906380792,5a10d8c2-7736-460c-ac13-743225e6ab82,f1c6cf85-0a9c-40d9-b60d-c54c7c5d9784,55e4a163-883e-4087-b17d-e75f8adfca33";
  const rows = await sb(`/campaign_messages?campaign_id=in.(${ids})&step_number=eq.0&channel=eq.linkedin&status=eq.queued&order=created_at.asc&select=id`);
  const msgIds = rows.map(r => r.id);

  console.log(`Found ${msgIds.length} queued step-0 messages. Throttle: ${THROTTLE_MS / 1000}s between sends.`);

  const results = [];
  for (let i = 0; i < msgIds.length; i++) {
    const r = await dispatchOne(msgIds[i], i + 1, msgIds.length);
    results.push({ id: msgIds[i], ...r });
    if (i < msgIds.length - 1) {
      console.log(`  · sleeping ${THROTTLE_MS / 1000}s before next…`);
      await new Promise(res => setTimeout(res, THROTTLE_MS));
    }
  }

  console.log(`\n=== SUMMARY ===`);
  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok && !r.skipped).length;
  const skip = results.filter(r => r.skipped).length;
  console.log(`SENT: ${ok} | FAILED: ${fail} | SKIPPED: ${skip}`);
}

main().catch(e => { console.error("fatal:", e); process.exit(1); });
