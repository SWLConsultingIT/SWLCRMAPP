// LinkedIn Recovery / Second Attempt — orchestration cron.
//
// Safety model (defence in depth):
//   • DRY RUN by default. External + DB state changes need ?execute=1.
//   • EVERY external LinkedIn write (withdraw / invite / DM) additionally needs
//     LINKEDIN_RECOVERY_ENABLED=true. No env ⇒ no external writes, ever.
//   • Only tenants in LINKEDIN_RECOVERY_TENANT_ALLOWLIST get external actions.
//   • LINKEDIN_RECOVERY_MAX_PER_RUN caps external actions per run (default 5).
//   • Idempotent: each action is CAS-guarded (UPDATE … WHERE state=expected) and
//     no-ops when its output id already exists. Concurrency/retry safe.
//   • Fail closed: any ambiguous/unverifiable signal → MANUAL_REVIEW, never a
//     blind send. Copy must be generated AND approved before a second invite.
//
// The original campaign is NEVER reopened. All state lives in linkedin_recovery.
// Acceptance of the second invite is detected app-side (leads.linkedin_connected
// or a live Unipile first-degree check) so this does NOT depend on n8n.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/shared/auth/scope";
import {
  RECOVERY_STATES, computeReinviteAfter, computeSecondAcceptDeadline,
  capRemaining, evaluateWithdrawGuards, evaluateReinviteGuards, sellerUsable,
  DAY_MS, type LiveState,
} from "@/lib/linkedin-recovery";
import { discoverCandidates, buildRecoveryRow } from "@/lib/linkedin-recovery-discovery";
import { generateSecondAttemptCopy } from "@/lib/linkedin-recovery-copy";
import {
  getRelationState, withdrawInvitation, sendInvite, sendDm, extractLinkedinSlug, isFirstDegree, hasUnipileCreds,
} from "@/lib/unipile-linkedin";

export const maxDuration = 60;
const CRON_SECRET = process.env.CRON_SECRET;
const TERMINAL_LEAD = new Set(["qualified", "closed_won", "closed_lost", "discarded"]);
const DISCOVERY_LIMIT = 200;
const COPY_LIMIT_PER_RUN = 10;

function authorized(req: NextRequest, role: string | null): boolean {
  if (role === "admin") return true;
  if (!CRON_SECRET) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${CRON_SECRET}`;
}

function parseAllowlist(): string[] {
  return (process.env.LINKEDIN_RECOVERY_TENANT_ALLOWLIST ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

type Svc = ReturnType<typeof getSupabaseService>;

// Per-row snapshot for the guard evaluators (small, per-row — capped by budget).
async function loadGuardSnapshot(svc: Svc, row: any) {
  const { data: lead } = await svc
    .from("leads")
    .select("id, status, archived, linkedin_connected, allow_linkedin, linkedin_internal_id, primary_linkedin_url")
    .eq("id", row.lead_id).maybeSingle();
  const { data: seller } = row.seller_id
    ? await svc.from("sellers").select("id, linkedin_status, unipile_account_id, active").eq("id", row.seller_id).maybeSingle()
    : { data: null as any };
  const nowISO = new Date().toISOString();
  const { data: supp } = await svc
    .from("lead_suppressions").select("lead_id, expires_at")
    .eq("channel", "linkedin").eq("active", true).eq("lead_id", row.lead_id).limit(5);
  const suppressed = (supp ?? []).some((s: any) => !s.expires_at || s.expires_at > nowISO);
  const { data: reps } = await svc.from("lead_replies").select("id").eq("channel", "linkedin").eq("lead_id", row.lead_id).limit(1);
  const { data: dms } = await svc.from("campaign_messages").select("id").eq("channel", "linkedin").eq("status", "sent").gte("step_number", 1).eq("lead_id", row.lead_id).limit(1);
  const laterEngagement = (reps ?? []).length > 0 || (dms ?? []).length > 0;

  const accountId = (seller?.unipile_account_id as string | null) ?? null;
  const sellerActive = !!seller && (seller as any).active !== false && sellerUsable((seller as any).linkedin_status, accountId);
  return {
    lead, seller, accountId, suppressed, laterEngagement, sellerActive,
    leadConnected: (lead as any)?.linkedin_connected === true,
    leadTerminal: TERMINAL_LEAD.has(((lead as any)?.status ?? "").toLowerCase()),
    leadArchived: (lead as any)?.archived === true,
    slug: extractLinkedinSlug((lead as any)?.primary_linkedin_url ?? null),
    storedProviderId: ((lead as any)?.linkedin_internal_id as string | null) ?? null,
  };
}

// Live preflight; null when creds missing or GET fails (fail-closed downstream).
async function preflight(slug: string | null, accountId: string | null): Promise<LiveState | null> {
  if (!slug || !accountId || !hasUnipileCreds()) return null;
  try {
    const s = await getRelationState(slug, accountId);
    return { networkDistance: s.networkDistance, invitationStatus: s.invitationStatus, providerId: s.providerId };
  } catch { return null; }
}

// CAS state transition. Returns true when this worker won the row.
async function cas(svc: Svc, id: string, from: string, patch: Record<string, unknown>): Promise<boolean> {
  const { data } = await svc.from("linkedin_recovery").update(patch).eq("id", id).eq("state", from).select("id");
  return !!(data && data.length > 0);
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (!authorized(req, (scope as any).role ?? null)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const execute = url.searchParams.get("execute") === "1";
  const enabled = process.env.LINKEDIN_RECOVERY_ENABLED === "true";
  const allowlist = parseAllowlist();
  const maxPerRun = Math.max(0, parseInt(process.env.LINKEDIN_RECOVERY_MAX_PER_RUN ?? "5", 10) || 0);
  const svc = getSupabaseService();
  const nowMs = Date.now();
  const nowISO = new Date().toISOString();
  const externalOk = execute && enabled && allowlist.length > 0;

  const report: any = {
    dryRun: !execute, enabled, allowlist, maxPerRun, externalWritesAllowed: externalOk,
    unipileCreds: hasUnipileCreds(),
    discovered: 0, enrolled: 0,
    withdraw: { eligible: 0, proceeded: 0, withdrawn: 0, alreadyGone: 0, cancelled: 0, review: 0, waited: 0, failed: 0 },
    copy: { generated: 0, failed: 0 },
    reinvite: { eligible: 0, sent: 0, cancelled: 0, review: 0, waited: 0, failed: 0 },
    accept: { checked: 0, dmSent: 0, stoppedUnaccepted: 0 },
    notes: [] as string[],
  };
  let budget = maxPerRun;

  // ── 1. DISCOVERY (enroll new CASE-1 candidates). Internal writes (execute). ──
  try {
    const candidates = await discoverCandidates(svc, { companyBioIds: allowlist.length ? allowlist : null, limit: DISCOVERY_LIMIT });
    const enrollable = candidates.filter((c) => c.decision.enroll);
    report.discovered = enrollable.length;
    if (execute && enrollable.length > 0) {
      const rows = enrollable.map(buildRecoveryRow).filter(Boolean) as Record<string, unknown>[];
      // Idempotent: UNIQUE(lead_id) — ignore conflicts.
      const { data, error } = await svc.from("linkedin_recovery").upsert(rows, { onConflict: "lead_id", ignoreDuplicates: true }).select("id");
      if (error) report.notes.push(`enroll error: ${error.message}`);
      else report.enrolled = data?.length ?? 0;
    }
  } catch (e: any) {
    report.notes.push(`discovery error: ${e?.message ?? String(e)}`);
  }

  // ── 2. COPY generation for WAITING_REINVITE rows still missing copy ──
  //    (internal-ish: n8n webhook, gated by execute; not a LinkedIn write).
  if (execute) {
    let qy = svc.from("linkedin_recovery")
      .select("id, lead_id, campaign_id, company_bio_id, second_connection_note")
      .eq("state", RECOVERY_STATES.WAITING_REINVITE)
      .is("second_connection_note", null)
      .limit(COPY_LIMIT_PER_RUN);
    if (allowlist.length) qy = qy.in("company_bio_id", allowlist);
    const { data: needCopy } = await qy;
    for (const row of needCopy ?? []) {
      // recover originals for the prompt + distinctness check
      const { data: orig } = await svc.from("campaign_messages")
        .select("step_number, content").eq("lead_id", (row as any).lead_id).eq("channel", "linkedin").in("status", ["sent", "skipped", "queued", "draft"]);
      const note0 = (orig ?? []).find((m: any) => m.step_number === 0)?.content ?? null;
      const dm0 = (orig ?? []).find((m: any) => m.step_number >= 1)?.content ?? null;
      const { data: leadRow } = await svc.from("leads").select("icp_profile_id").eq("id", (row as any).lead_id).maybeSingle();
      const res = await generateSecondAttemptCopy({
        leadId: (row as any).lead_id, campaignId: (row as any).campaign_id, companyBioId: (row as any).company_bio_id,
        icpProfileId: (leadRow as any)?.icp_profile_id ?? null, originalNote: note0, originalDm: dm0,
      });
      if (res.ok) {
        await svc.from("linkedin_recovery").update({ second_connection_note: res.note, second_dm: res.dm, last_error: null }).eq("id", (row as any).id);
        report.copy.generated += 1;
      } else {
        await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.MANUAL_REVIEW, stop_reason: "copy_generation_failed", last_error: res.error }).eq("id", (row as any).id);
        report.copy.failed += 1;
      }
    }
  }

  // ── 3. WITHDRAW: WAITING_WITHDRAWAL rows past the 5-day wait ──
  {
    let qy = svc.from("linkedin_recovery")
      .select("id, lead_id, campaign_id, seller_id, original_invitation_id, eligible_withdraw_at")
      .eq("state", RECOVERY_STATES.WAITING_WITHDRAWAL)
      .lte("eligible_withdraw_at", nowISO)
      .order("eligible_withdraw_at", { ascending: true })
      .limit(50);
    if (allowlist.length) qy = qy.in("company_bio_id", allowlist);
    const { data: rows } = await qy;
    report.withdraw.eligible = (rows ?? []).length;
    for (const row of rows ?? []) {
      if (budget <= 0) { report.notes.push("withdraw: budget exhausted"); break; }
      const snap = await loadGuardSnapshot(svc, row);
      const live = externalOk ? await preflight(snap.slug, snap.accountId) : null;
      const decision = evaluateWithdrawGuards({
        nowMs,
        eligibleWithdrawAtMs: (row as any).eligible_withdraw_at ? Date.parse((row as any).eligible_withdraw_at) : null,
        leadConnected: snap.leadConnected, leadTerminal: snap.leadTerminal, leadArchived: snap.leadArchived,
        suppressed: snap.suppressed, laterEngagement: snap.laterEngagement,
        sellerActive: snap.sellerActive, accountAvailable: !!snap.accountId,
        originalInvitationId: (row as any).original_invitation_id, storedProviderId: snap.storedProviderId, live,
      });
      if (decision.action === "wait") { report.withdraw.waited += 1; continue; }
      if (!execute) { report.withdraw[decision.action === "proceed" ? "proceeded" : decision.action] += 1; continue; }
      if (decision.action === "cancel") { await svc.from("linkedin_recovery").update({ state: decision.state, stop_reason: decision.reason }).eq("id", (row as any).id); report.withdraw.cancelled += 1; continue; }
      if (decision.action === "review") { await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.MANUAL_REVIEW, stop_reason: decision.reason }).eq("id", (row as any).id); report.withdraw.review += 1; continue; }
      // proceed → external write
      if (!externalOk) { report.withdraw.proceeded += 1; report.notes.push("withdraw ready but external writes disabled"); continue; }
      if (!await cas(svc, (row as any).id, RECOVERY_STATES.WAITING_WITHDRAWAL, { state: RECOVERY_STATES.WITHDRAWING })) continue; // lost race
      budget -= 1;
      const w = await withdrawInvitation((row as any).original_invitation_id, snap.accountId!);
      if (w.ok && w.status === "withdrawn") {
        const withdrawnAt = new Date().toISOString();
        await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.WAITING_REINVITE, withdrawn_at: withdrawnAt, reinvite_after: computeReinviteAfter(withdrawnAt), last_error: null }).eq("id", (row as any).id);
        report.withdraw.withdrawn += 1;
      } else if (w.ok && w.status === "already_gone") {
        // Can't anchor a cooldown on an invite that vanished at an unknown time.
        await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.MANUAL_REVIEW, stop_reason: "original_invite_already_gone" }).eq("id", (row as any).id);
        report.withdraw.alreadyGone += 1;
      } else {
        await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.WAITING_WITHDRAWAL, last_error: (w as any).reason, retry_count: ((row as any).retry_count ?? 0) + 1 }).eq("id", (row as any).id);
        report.withdraw.failed += 1;
      }
    }
  }

  // ── 4. REINVITE: WAITING_REINVITE rows past cooldown, copy approved ──
  {
    let qy = svc.from("linkedin_recovery")
      .select("id, lead_id, campaign_id, seller_id, reinvite_after, attempt_count, copy_approved_at, second_connection_note, second_invitation_id")
      .eq("state", RECOVERY_STATES.WAITING_REINVITE)
      .lte("reinvite_after", nowISO)
      .not("copy_approved_at", "is", null)
      .order("reinvite_after", { ascending: true })
      .limit(50);
    if (allowlist.length) qy = qy.in("company_bio_id", allowlist);
    const { data: rows } = await qy;
    report.reinvite.eligible = (rows ?? []).length;

    // Per-seller cap: normal step-0 sends + recovery second invites in last 24h.
    const since24h = new Date(nowMs - DAY_MS).toISOString();
    const capCache = new Map<string, number>();
    async function remainingFor(sellerId: string, dailyLimit: number | null): Promise<number> {
      if (capCache.has(sellerId)) return capCache.get(sellerId)!;
      const { data: normal } = await svc.from("campaign_messages").select("id, campaigns!inner(seller_id)").eq("status", "sent").eq("channel", "linkedin").eq("step_number", 0).gte("sent_at", since24h).eq("campaigns.seller_id", sellerId);
      const { data: recov } = await svc.from("linkedin_recovery").select("id").eq("seller_id", sellerId).gte("second_invite_sent_at", since24h);
      const rem = capRemaining(dailyLimit, (normal ?? []).length, (recov ?? []).length);
      capCache.set(sellerId, rem);
      return rem;
    }

    for (const row of rows ?? []) {
      if (budget <= 0) { report.notes.push("reinvite: budget exhausted"); break; }
      if ((row as any).second_invitation_id) continue; // idempotent — already sent
      const snap = await loadGuardSnapshot(svc, row);
      const dailyLimit = (snap.seller as any)?.linkedin_daily_limit ?? null;
      const rem = externalOk && (row as any).seller_id ? await remainingFor((row as any).seller_id, dailyLimit) : 0;
      const live = externalOk ? await preflight(snap.slug, snap.accountId) : null;
      const decision = evaluateReinviteGuards({
        nowMs, reinviteAfterMs: (row as any).reinvite_after ? Date.parse((row as any).reinvite_after) : null,
        attemptCount: (row as any).attempt_count ?? 1, copyApproved: !!(row as any).copy_approved_at, capRemaining: rem,
        leadConnected: snap.leadConnected, leadTerminal: snap.leadTerminal, leadArchived: snap.leadArchived,
        suppressed: snap.suppressed, laterEngagement: snap.laterEngagement,
        sellerActive: snap.sellerActive, accountAvailable: !!snap.accountId, live,
      });
      if (decision.action === "wait") { report.reinvite.waited += 1; continue; }
      if (!execute) { report.reinvite[decision.action === "proceed" ? "sent" : decision.action] += 1; continue; }
      if (decision.action === "cancel") { await svc.from("linkedin_recovery").update({ state: decision.state, stop_reason: decision.reason }).eq("id", (row as any).id); report.reinvite.cancelled += 1; continue; }
      if (decision.action === "review") { await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.MANUAL_REVIEW, stop_reason: decision.reason }).eq("id", (row as any).id); report.reinvite.review += 1; continue; }
      if (!externalOk) { report.notes.push("reinvite ready but external writes disabled"); continue; }
      if (!await cas(svc, (row as any).id, RECOVERY_STATES.WAITING_REINVITE, { state: RECOVERY_STATES.SECOND_INVITE_SENDING })) continue;
      budget -= 1;
      try {
        const providerId = snap.storedProviderId || live?.providerId;
        if (!providerId) throw new Error("no provider_id for reinvite");
        const inv = await sendInvite(snap.accountId!, providerId, (row as any).second_connection_note ?? undefined);
        await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.SECOND_INVITE_SENT, second_invitation_id: inv.invitationId, second_invite_sent_at: new Date().toISOString(), attempt_count: 2, last_error: null }).eq("id", (row as any).id);
        capCache.delete((row as any).seller_id);
        report.reinvite.sent += 1;
      } catch (e: any) {
        await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.WAITING_REINVITE, last_error: e?.message ?? String(e), retry_count: ((row as any).retry_count ?? 0) + 1 }).eq("id", (row as any).id);
        report.reinvite.failed += 1;
      }
    }
  }

  // ── 5. ACCEPTANCE of the second invite → send the second DM (app-side) ──
  {
    let qy = svc.from("linkedin_recovery")
      .select("id, lead_id, seller_id, second_invite_sent_at, second_dm, second_message_id")
      .eq("state", RECOVERY_STATES.SECOND_INVITE_SENT)
      .order("second_invite_sent_at", { ascending: true })
      .limit(50);
    if (allowlist.length) qy = qy.in("company_bio_id", allowlist);
    const { data: rows } = await qy;
    for (const row of rows ?? []) {
      report.accept.checked += 1;
      if ((row as any).second_message_id) continue; // idempotent
      const snap = await loadGuardSnapshot(svc, row);
      const live = externalOk ? await preflight(snap.slug, snap.accountId) : null;
      const accepted = snap.leadConnected || (live ? isFirstDegree(live.networkDistance) : false);
      const deadline = (row as any).second_invite_sent_at ? computeSecondAcceptDeadline((row as any).second_invite_sent_at) : null;
      const expired = deadline ? Date.parse(deadline) < nowMs : false;
      if (accepted) {
        if (!execute) { report.accept.dmSent += 1; continue; }
        if (budget <= 0) { report.notes.push("dm: budget exhausted"); break; }
        if (!externalOk) { report.notes.push("second DM ready but external writes disabled"); continue; }
        if (!(row as any).second_dm) { await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.MANUAL_REVIEW, stop_reason: "second_dm_missing" }).eq("id", (row as any).id); continue; }
        if (!await cas(svc, (row as any).id, RECOVERY_STATES.SECOND_INVITE_SENT, { state: RECOVERY_STATES.SECOND_MESSAGE_SENDING })) continue;
        budget -= 1;
        try {
          const providerId = snap.storedProviderId || live?.providerId;
          if (!providerId) throw new Error("no provider_id for second DM");
          const dm = await sendDm(snap.accountId!, providerId, (row as any).second_dm);
          await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.DONE, second_message_id: dm.messageId, second_message_sent_at: new Date().toISOString(), last_error: null }).eq("id", (row as any).id);
          report.accept.dmSent += 1;
        } catch (e: any) {
          await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.SECOND_INVITE_SENT, last_error: e?.message ?? String(e), retry_count: ((row as any).retry_count ?? 0) + 1 }).eq("id", (row as any).id);
        }
      } else if (expired) {
        if (execute) await svc.from("linkedin_recovery").update({ state: RECOVERY_STATES.STOPPED_UNACCEPTED, stop_reason: "second_invite_unaccepted" }).eq("id", (row as any).id);
        report.accept.stoppedUnaccepted += 1;
      }
    }
  }

  return NextResponse.json({ ok: true, ...report });
}
