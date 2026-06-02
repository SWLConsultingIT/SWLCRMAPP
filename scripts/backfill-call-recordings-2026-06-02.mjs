// Backfills `calls.recording_storage_path` for every row that still
// has `aircall_call_id` set but no archived recording. Replicates
// what `lib/archive-call-recording.ts` does, but as a standalone
// script so it can iterate sequentially over the orphan set without
// dragging the Next.js runtime in.
//
// Background: Aircall serves recording URLs as S3 presigned links
// that expire (hours/days). Until the webhook started auto-archiving
// (2026-06-01, commit f93d888), `calls.recording_url` aged out and
// the in-app player broke. This script walks the 81 historic rows,
// re-asks Aircall API for a fresh signed URL, downloads the MP3 once,
// uploads to the private `call-recordings` Storage bucket, and
// persists the storage_path so the audio is permanent.
//
// Aircall retention: their default plan keeps recordings indefinitely
// while the subscription is active. If a call returns 404 from the
// `/v1/calls/{id}` endpoint (deleted by retention or never had audio
// — e.g. missed/unanswered), the script logs and moves on.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const AIRCALL_AUTH = "Basic " + Buffer.from(`${env.AIRCALL_API_ID}:${env.AIRCALL_API_TOKEN}`).toString("base64");
const BUCKET = "call-recordings";

console.log("Loading eligible calls…");
const { data: calls } = await svc
  .from("calls")
  .select("id, aircall_call_id, lead_id, status, started_at, leads(company_bio_id)")
  .not("aircall_call_id", "is", null)
  .is("recording_storage_path", null)
  .order("started_at", { ascending: false });
console.log(`${calls?.length ?? 0} calls to process.`);

const results = { archived: 0, no_audio: 0, aircall_404: 0, aircall_other: 0, download_fail: 0, upload_fail: 0 };

for (const c of calls ?? []) {
  // Status=missed/voicemail rarely have audio; we still try once and
  // skip cleanly if Aircall returns nothing.
  const leadRow = Array.isArray(c.leads) ? c.leads[0] : c.leads;
  const tenant = leadRow?.company_bio_id ?? "unscoped";

  const aircallRes = await fetch(`https://api.aircall.io/v1/calls/${c.aircall_call_id}`, {
    headers: { Authorization: AIRCALL_AUTH },
  });
  if (aircallRes.status === 404) {
    results.aircall_404 += 1;
    console.log(`  [404]  ${c.id} (aircall ${c.aircall_call_id}) — gone from Aircall`);
    continue;
  }
  if (!aircallRes.ok) {
    results.aircall_other += 1;
    console.log(`  [${aircallRes.status}] ${c.id} — aircall error`);
    continue;
  }
  const body = await aircallRes.json().catch(() => ({}));
  const freshUrl = body?.call?.recording ?? body?.call?.asset ?? body?.call?.voicemail ?? null;
  if (!freshUrl) {
    results.no_audio += 1;
    console.log(`  [—]    ${c.id} (status=${c.status}) — no recording on Aircall side`);
    continue;
  }

  const dl = await fetch(freshUrl);
  if (!dl.ok) {
    results.download_fail += 1;
    console.log(`  [dl ${dl.status}] ${c.id} — S3 download failed`);
    continue;
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  const contentType = dl.headers.get("content-type") ?? "audio/mpeg";

  const path = `${tenant}/${c.id}.mp3`;
  const { error: upErr } = await svc.storage.from(BUCKET).upload(path, buf, { contentType, upsert: true });
  if (upErr) {
    results.upload_fail += 1;
    console.log(`  [up err] ${c.id} — ${upErr.message}`);
    continue;
  }
  await svc.from("calls").update({
    recording_storage_path: path,
    recording_url: freshUrl,
  }).eq("id", c.id);
  results.archived += 1;
  console.log(`  ✓ ${c.id} → ${path} (${(buf.length / 1024).toFixed(1)} KB)`);
}

console.log("\nDone.", results);
