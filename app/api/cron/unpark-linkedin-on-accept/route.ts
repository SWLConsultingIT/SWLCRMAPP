// Unpark LinkedIn DMs once the lead accepts the connection request.
//
// Why this cron exists: dispatch-queue parks LinkedIn DMs (step ≥ 1) with
// `metadata.awaiting_acceptance=true` + `eligible_at = now() + 21d` when the
// lead is not yet 1st-degree. Email + call steps advance in parallel.
//
// The accept signal arrives via the BESFOHaqTt2Ki0Vw n8n workflow, which
// flips `leads.linkedin_connected = true`. Once that flips, the parked DMs
// should fire on the next dispatcher tick — but their eligible_at is 21d
// out, so the dispatcher would ignore them.
//
// This cron bridges the gap:
//   1. Find every parked LinkedIn DM whose lead has since become connected.
//   2. Drop eligible_at back to now() so the next dispatch tick sends them.
//   3. Optionally also expire DMs that have been parked > 21d — they're
//      past LinkedIn's invite TTL, the invite is dead, no point retrying.
//
// Auth: standard Bearer CRON_SECRET. Wire to the n8n Orquestador on a short
// cadence (every 5-10 min) so the latency between accept and "first DM
// fires" stays low.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const CRON_SECRET = process.env.CRON_SECRET;
const PARK_TTL_DAYS = 21; // LinkedIn invite TTL

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!CRON_SECRET || presented !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const execute = req.nextUrl.searchParams.get("execute") === "1";
  const svc = getSupabaseService();
  const nowMs = Date.now();
  const nowISO = new Date(nowMs).toISOString();

  // Pull every parked LinkedIn DM — paginated to avoid the 1000-row
  // PostgREST silent cap. At scale (100 sellers × many parked DMs each)
  // a single .select() without .range() silently truncates, leaving some
  // accepted leads waiting for their DM forever.
  const parkedRaw: any[] = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await svc
        .from("campaign_messages")
        .select("id, lead_id, step_number, metadata, leads!inner(linkedin_connected)")
        .eq("status", "queued")
        .eq("channel", "linkedin")
        .gt("step_number", 0)
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      parkedRaw.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
  }

  type Row = {
    id: string;
    lead_id: string;
    step_number: number;
    metadata: Record<string, unknown> | null;
    leads: { linkedin_connected: boolean | null } | { linkedin_connected: boolean | null }[] | null;
  };

  const toUnpark: Row[] = [];
  const toExpire: Row[] = [];

  for (const raw of (parkedRaw ?? []) as Row[]) {
    const meta = raw.metadata ?? {};
    if (!meta.awaiting_acceptance) continue;
    const leadRaw = raw.leads;
    const leadRow = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
    const connected = leadRow?.linkedin_connected === true;
    const parkedSinceMs = meta.parked_since ? new Date(meta.parked_since as string).getTime() : 0;
    const ageMs = parkedSinceMs ? nowMs - parkedSinceMs : 0;
    const expired = ageMs > PARK_TTL_DAYS * 86400000;
    if (connected) toUnpark.push(raw);
    else if (expired) toExpire.push(raw);
  }

  if (!execute) {
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      now: nowISO,
      unpark_count: toUnpark.length,
      expire_count: toExpire.length,
      hint: "Add ?execute=1 to apply.",
      unpark: toUnpark.map(r => ({ msgId: r.id, leadId: r.lead_id, stepNumber: r.step_number })),
      expire: toExpire.map(r => ({ msgId: r.id, leadId: r.lead_id, stepNumber: r.step_number })),
    });
  }

  const unparkErrors: Array<{ msgId: string; reason: string }> = [];
  const expireErrors: Array<{ msgId: string; reason: string }> = [];

  // Re-space, don't dump. If a lead has MORE THAN ONE parked LinkedIn DM
  // (multi-DM sequence, accepted late so several were parked), releasing them
  // all to now() makes them fire on consecutive ticks — two+ DMs minutes apart
  // instead of the days the sequence intended (spammy + out of cadence). So we
  // group by lead, fire ONLY the lowest-step DM now, and stagger the rest
  // RESPACE_GAP_DAYS apart from the acceptance moment so the cadence resumes.
  const RESPACE_GAP_DAYS = 2;
  const byLead = new Map<string, Row[]>();
  for (const r of toUnpark) {
    const arr = byLead.get(r.lead_id) ?? [];
    arr.push(r);
    byLead.set(r.lead_id, arr);
  }
  for (const group of byLead.values()) {
    group.sort((a, b) => a.step_number - b.step_number);
    for (let i = 0; i < group.length; i++) {
      const r = group[i];
      const eligible = i === 0 ? nowISO : new Date(nowMs + i * RESPACE_GAP_DAYS * 86400000).toISOString();
      const mergedMeta = {
        ...(r.metadata ?? {}),
        awaiting_acceptance: false,
        eligible_at: eligible,
        unparked_at: nowISO,
      };
      const { error } = await svc
        .from("campaign_messages")
        .update({ metadata: mergedMeta })
        .eq("id", r.id)
        .eq("status", "queued");
      if (error) unparkErrors.push({ msgId: r.id, reason: error.message });
    }
  }

  for (const r of toExpire) {
    const mergedMeta = {
      ...(r.metadata ?? {}),
      awaiting_acceptance: false,
      skipped_reason: "invite_expired_unaccepted",
      skipped_at: nowISO,
      skipped_by: "cron-unpark-linkedin-on-accept",
      ttl_days: PARK_TTL_DAYS,
    };
    const { error } = await svc
      .from("campaign_messages")
      .update({ status: "skipped", metadata: mergedMeta })
      .eq("id", r.id)
      .eq("status", "queued");
    if (error) expireErrors.push({ msgId: r.id, reason: error.message });
  }

  return NextResponse.json({
    ok: true,
    mode: "execute",
    now: nowISO,
    unparked: toUnpark.length - unparkErrors.length,
    expired: toExpire.length - expireErrors.length,
    unparkErrors,
    expireErrors,
  });
}
