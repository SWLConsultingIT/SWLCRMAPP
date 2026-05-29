import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import { redirect } from "next/navigation";
import Link from "next/link";
import Breadcrumb from "@/components/Breadcrumb";
import { C } from "@/lib/design";
import { AlertTriangle, CheckCircle2, Send, Snowflake, Activity, MessageSquare, TrendingUp, ShieldCheck } from "lucide-react";
import PageHero from "@/components/PageHero";
import ReliabilityActions from "./ReliabilityActions";
import RetryButton from "./RetryButton";
import { CancelCooldownButton, PauseCampaignButton } from "./CooldownActions";
import HideNoiseToggle from "./HideNoiseToggle";
import CollapsibleSection from "./CollapsibleSection";
import FailedSummary from "./FailedSummary";
import ReliabilityTabs, { type ReliabilityTabKey } from "./ReliabilityTabs";
import TenantHealthGrid, { computeTenantHealth, type TenantHealth } from "./TenantHealthGrid";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

// Reliability dashboard — SUPER ADMIN ONLY (canViewSwlAdmin gate).
//
// This page reconciles three sources of truth so the app owner can see at a
// glance whether the system is healthy across every tenant:
//   1. campaign_messages — what the CRM thinks happened
//   2. Unipile API — the source of truth for invites/messages sent
//   3. n8n executions — workflow runs (out of scope here)
//
// Rebuilt 2026-05-24: tenant selector + per-tenant cards + three logical
// groups (Action required / Pipeline / Recent) instead of 10 stacked
// sections. Use ?tenant=<bio_id> to scope the view; default is all tenants.

export const dynamic = "force-dynamic";

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY;

const RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const STUCK_DAYS = 7;
const EXPIRED_DAYS = 21;
const NOISE_DAYS = 3;

type CampaignMessageRow = {
  id: string;
  campaign_id: string | null;
  lead_id: string | null;
  step_number: number | null;
  channel: string | null;
  status: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  error_details: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
  leads: {
    primary_first_name: string | null;
    primary_last_name: string | null;
    primary_linkedin_url: string | null;
    company_name: string | null;
    company_bio_id: string | null;
    linkedin_connected: boolean | null;
    responded: boolean | null;
  } | null;
  campaigns: {
    name: string | null;
    seller_id: string | null;
    sellers: { name: string | null; unipile_account_id: string | null } | null;
  } | null;
};

type UnipileSentInvite = {
  id: string;
  invited_user: string;
  invited_user_id: string;
  invited_user_public_id: string;
  parsed_datetime?: string;
  date?: string;
};

type QueuedClassified = CampaignMessageRow & {
  _bucket: "ready" | "cooldown" | "waiting_acceptance";
  _cooldownUntil?: string;
  _eligibleAt?: string;
};

type TenantSummary = {
  bioId: string;
  name: string;
  queued: number;
  failed: number;
  stuck: number;
  cooldown: number;
  sent24h: number;
  ghost: number;
};

type ReliabilityData = {
  queueHealth: {
    skipped: CampaignMessageRow[];
    stuck: CampaignMessageRow[];
    expired: CampaignMessageRow[];
    queuedReady: QueuedClassified[];
    queuedCooldown: QueuedClassified[];
    queuedWaiting: QueuedClassified[];
    queuedByCampaign: Map<string, QueuedClassified[]>;
    dispatching: CampaignMessageRow[];
    failed: CampaignMessageRow[];
  };
  sentVsUnipile: {
    rows: Array<CampaignMessageRow & { _matched: boolean; _matchReason: string; _bucket: "pending" | "accepted" | "ghost" }>;
    ghostCount: number;
    matchedCount: number;
    acceptedCount: number;
  };
  sellerHealth: Array<{
    sellerId: string;
    sellerName: string;
    companyBioId: string | null;
    unipileAccountId: string | null;
    unipileError: string | null;
    invitesInUnipile: number;
    dailySent: number;
    dailyLimit: number;
    rateLimitedUntil: string | null;
    acceptance30d: { sent: number; accepted: number; pct: number | null };
  }>;
  kpis: {
    sentToday: number;
    aggregateCap: number;
    acceptance7d: { sent: number; accepted: number; pct: number | null };
    response7d: { sent: number; replies: number; pct: number | null };
    activeCooldownSellers: number;
    activeCooldownMessages: number;
  };
  tenants: TenantSummary[];
  fetchedAt: string;
};

async function fetchReliability(): Promise<ReliabilityData> {
  const svc = getSupabaseService();

  const queueSelect = "id, campaign_id, lead_id, step_number, channel, status, sent_at, provider_message_id, error_details, created_at, metadata, leads(source, encrypted_payload, primary_first_name, primary_last_name, primary_linkedin_url, company_name, company_bio_id, linkedin_connected, responded), campaigns(name, seller_id, sellers(name, unipile_account_id, company_bio_id))";

  const nowMs = Date.now();
  const since24h = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
  const stuckCutoff = new Date(nowMs - STUCK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const expiredCutoff = new Date(nowMs - EXPIRED_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [queuedQ, dispatchingQ, failedQ, skippedQ, sentLedgerQ, sellersQ, stuckExpiredQ, sent7dQ, sent30dQ, replies7dQ, bioQ] = await Promise.all([
    svc.from("campaign_messages").select(queueSelect).eq("status", "queued").order("created_at", { ascending: true }),
    svc.from("campaign_messages").select(queueSelect).eq("status", "dispatching").order("created_at", { ascending: true }),
    svc.from("campaign_messages").select(queueSelect).eq("status", "failed").order("created_at", { ascending: false }).limit(50),
    svc.from("campaign_messages").select(queueSelect).eq("status", "skipped").order("created_at", { ascending: false }).limit(50),
    svc.from("campaign_messages").select(queueSelect).eq("status", "sent").eq("step_number", 0).gte("sent_at", since24h).order("sent_at", { ascending: false }),
    svc.from("sellers").select("id, name, unipile_account_id, active, linkedin_daily_limit, company_bio_id").eq("active", true),
    svc.from("campaign_messages").select(queueSelect)
      .eq("status", "sent").eq("step_number", 0).eq("channel", "linkedin")
      .lt("sent_at", stuckCutoff)
      .order("sent_at", { ascending: true }),
    svc.from("campaign_messages").select("id, lead_id, campaigns!inner(seller_id), leads!inner(linkedin_connected)")
      .eq("status", "sent").eq("step_number", 0).eq("channel", "linkedin")
      .gte("sent_at", since7d),
    svc.from("campaign_messages").select("id, lead_id, campaigns!inner(seller_id), leads!inner(linkedin_connected)")
      .eq("status", "sent").eq("step_number", 0).eq("channel", "linkedin")
      .gte("sent_at", since30d),
    svc.from("lead_replies").select("id").gte("received_at", since7d),
    svc.from("company_bios").select("id, company_name"),
  ]);

  // Decrypt PII on every queue-row's inner `leads` so the table doesn't
  // render "(no name)" for client-source leads.
  {
    const rowsWithLeads: Array<{ leads?: any }> = [];
    for (const q of [queuedQ, dispatchingQ, failedQ, skippedQ, sentLedgerQ, stuckExpiredQ]) {
      for (const r of (q.data ?? []) as any[]) {
        if (r.leads) rowsWithLeads.push(r);
      }
    }
    const tenantIds = Array.from(new Set(
      rowsWithLeads
        .filter(r => r.leads?.source === "client" && r.leads?.encrypted_payload && r.leads?.company_bio_id)
        .map(r => r.leads.company_bio_id as string)
    ));
    const keys = new Map<string, Buffer>();
    for (const bioId of tenantIds) {
      try {
        const { key } = await resolveTenantKey(bioId);
        keys.set(bioId, key);
      } catch (err) {
        console.error("[reliability] tenant key resolution failed for", bioId, err);
      }
    }
    for (const r of rowsWithLeads) {
      const l = r.leads;
      if (l?.source !== "client" || !l.encrypted_payload || !l.company_bio_id) continue;
      const key = keys.get(l.company_bio_id);
      if (!key) continue;
      try {
        const blob = bufferFromSupabaseBytea(l.encrypted_payload);
        const decrypted = decryptWithResolvedKey(blob, key);
        r.leads = { ...l, ...decrypted, encrypted_payload: undefined };
      } catch (err) {
        console.error("[reliability] decrypt failed for lead", l.id, err);
      }
    }
  }

  // Pull Unipile sent invites per active seller (last 100 each).
  const unipileBySeller = new Map<string, UnipileSentInvite[]>();
  const sellerErrors = new Map<string, string>();
  if (UNIPILE_KEY && sellersQ.data) {
    await Promise.all(sellersQ.data.map(async (s: any) => {
      if (!s.unipile_account_id) return;
      try {
        const res = await fetch(
          `${UNIPILE_BASE}/api/v1/users/invite/sent?account_id=${encodeURIComponent(s.unipile_account_id)}&limit=100`,
          { headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" }, cache: "no-store" },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          sellerErrors.set(s.id, body?.detail || body?.message || `HTTP ${res.status}`);
          return;
        }
        unipileBySeller.set(s.id, (body?.items ?? []) as UnipileSentInvite[]);
      } catch (e: any) {
        sellerErrors.set(s.id, e?.message ?? String(e));
      }
    }));
  }

  // Reconcile sent rows against Unipile.
  //
  // Unipile's /users/invite/sent endpoint lists only PENDING invites — once a
  // lead accepts, declines, or expires, the invite drops off the feed. So
  // "not present in the feed" doesn't automatically mean ghost. The
  // empirically common case is "lead accepted, dropped off pending feed,
  // accept webhook may or may not have updated our DB yet".
  //
  // Buckets:
  //   - "pending"   → matched in the sent feed (invite still outstanding)
  //   - "accepted"  → not in feed but lead.linkedin_connected=true OR
  //                   lead.responded=true (you can only DM 1st-degree, so a
  //                   reply implies acceptance even if the webhook missed it)
  //   - "ghost"     → not in feed AND no evidence of engagement. THIS is the
  //                   actionable bucket — the original ghost-sent incident
  //                   case where the dispatcher claimed sent but Unipile has
  //                   no record and the lead never engaged.
  const ledger = (sentLedgerQ.data ?? []) as unknown as CampaignMessageRow[];
  const reconciled = ledger.map((r) => {
    const sellerId = r.campaigns?.seller_id ?? null;
    const invites = sellerId ? (unipileBySeller.get(sellerId) ?? []) : [];
    let matched = false;
    let reason = "";
    let bucket: "pending" | "accepted" | "ghost" = "ghost";

    if (sellerId) {
      if (r.provider_message_id) {
        matched = invites.some((inv) => inv.id === r.provider_message_id);
        if (matched) { bucket = "pending"; reason = "still pending in Unipile"; }
      }
      if (!matched && r.leads?.primary_linkedin_url) {
        const m = r.leads.primary_linkedin_url.match(/\/in\/([^/?#]+)/i);
        const slug = m ? m[1].toLowerCase() : null;
        if (slug) {
          matched = invites.some((inv) => (inv.invited_user_public_id ?? "").toLowerCase() === slug);
          if (matched) { bucket = "pending"; reason = "matched by LinkedIn slug"; }
        }
      }
    } else {
      reason = "no seller_id";
    }

    if (!matched) {
      const accepted = r.leads?.linkedin_connected === true;
      const replied = (r as any).leads?.responded === true;
      if (accepted || replied) {
        bucket = "accepted";
        reason = accepted ? "accepted (1st-degree)" : "lead replied (implies accept)";
      } else {
        bucket = "ghost";
        reason = sellerId ? "no Unipile match + no engagement signal" : reason;
      }
    }

    return { ...r, _matched: matched, _matchReason: reason, _bucket: bucket };
  });

  // Ghosts are the real action-required cases (no feed + no engagement).
  // "Accepted" rows are healthy — they just left the pending feed.
  const matchedCount = reconciled.filter((r) => r._bucket === "pending").length;
  const acceptedCount = reconciled.filter((r) => r._bucket === "accepted").length;
  const ghostCount = reconciled.filter((r) => r._bucket === "ghost").length;

  const dailyCount = new Map<string, number>();
  for (const r of sentLedgerQ.data ?? []) {
    const sid = (r as any)?.campaigns?.seller_id as string | undefined;
    if (sid) dailyCount.set(sid, (dailyCount.get(sid) ?? 0) + 1);
  }

  const acceptance30dBySeller = new Map<string, { sent: number; accepted: number }>();
  for (const r of (sent30dQ.data ?? []) as any[]) {
    const sid = r?.campaigns?.seller_id as string | undefined;
    if (!sid) continue;
    const cur = acceptance30dBySeller.get(sid) ?? { sent: 0, accepted: 0 };
    cur.sent += 1;
    if (r?.leads?.linkedin_connected === true) cur.accepted += 1;
    acceptance30dBySeller.set(sid, cur);
  }

  // Classify queued rows into ready / cooldown / waiting.
  const queuedRaw = ((queuedQ.data ?? []) as unknown as CampaignMessageRow[]);
  const queuedReady: QueuedClassified[] = [];
  const queuedCooldown: QueuedClassified[] = [];
  const queuedWaiting: QueuedClassified[] = [];
  const sellerInCooldown = new Set<string>();
  let activeCooldownMessages = 0;
  for (const r of queuedRaw) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const lastRL = meta.last_rate_limit_at as string | undefined;
    const eligibleAt = meta.eligible_at as string | undefined;
    const cooldownActive = lastRL && nowMs - new Date(lastRL).getTime() < RATE_LIMIT_COOLDOWN_MS;
    const waiting = eligibleAt && new Date(eligibleAt).getTime() > nowMs;
    if (cooldownActive) {
      const cooldownUntil = new Date(new Date(lastRL!).getTime() + RATE_LIMIT_COOLDOWN_MS).toISOString();
      queuedCooldown.push({ ...r, _bucket: "cooldown", _cooldownUntil: cooldownUntil });
      activeCooldownMessages += 1;
      const sid = r.campaigns?.seller_id;
      if (sid) sellerInCooldown.add(sid);
    } else if (waiting) {
      queuedWaiting.push({ ...r, _bucket: "waiting_acceptance", _eligibleAt: eligibleAt });
    } else {
      queuedReady.push({ ...r, _bucket: "ready" });
    }
  }

  const queuedByCampaign = new Map<string, QueuedClassified[]>();
  for (const r of [...queuedReady, ...queuedCooldown, ...queuedWaiting]) {
    const name = r.campaigns?.name ?? "(no name)";
    const list = queuedByCampaign.get(name) ?? [];
    list.push(r);
    queuedByCampaign.set(name, list);
  }

  const stuckOrExpired = ((stuckExpiredQ.data ?? []) as unknown as CampaignMessageRow[]).filter(
    (r) => r.leads?.linkedin_connected !== true,
  );
  const stuck: CampaignMessageRow[] = [];
  const expired: CampaignMessageRow[] = [];
  for (const r of stuckOrExpired) {
    if (r.sent_at && new Date(r.sent_at).toISOString() < expiredCutoff) {
      expired.push(r);
    } else {
      stuck.push(r);
    }
  }

  const sellerHealth = (sellersQ.data ?? []).map((s: any) => {
    const acc = acceptance30dBySeller.get(s.id) ?? { sent: 0, accepted: 0 };
    const pct = acc.sent > 0 ? Math.round((acc.accepted / acc.sent) * 100) : null;
    let latestCooldown: number | null = null;
    for (const r of queuedCooldown) {
      if (r.campaigns?.seller_id === s.id && r._cooldownUntil) {
        const t = new Date(r._cooldownUntil).getTime();
        if (latestCooldown === null || t > latestCooldown) latestCooldown = t;
      }
    }
    return {
      sellerId: s.id,
      sellerName: s.name ?? "(unnamed)",
      companyBioId: (s.company_bio_id as string | null) ?? null,
      unipileAccountId: s.unipile_account_id ?? null,
      unipileError: sellerErrors.get(s.id) ?? null,
      invitesInUnipile: unipileBySeller.get(s.id)?.length ?? 0,
      dailySent: dailyCount.get(s.id) ?? 0,
      dailyLimit: (s.linkedin_daily_limit as number | null) ?? 20,
      rateLimitedUntil: latestCooldown ? new Date(latestCooldown).toISOString() : null,
      acceptance30d: { sent: acc.sent, accepted: acc.accepted, pct },
    };
  });

  const sentToday = Array.from(dailyCount.values()).reduce((a, b) => a + b, 0);
  const aggregateCap = sellerHealth.reduce((a, s) => a + s.dailyLimit, 0);
  const sent7dRows = (sent7dQ.data ?? []) as any[];
  const accepted7d = sent7dRows.filter((r) => r?.leads?.linkedin_connected === true).length;
  const acceptance7dPct = sent7dRows.length > 0 ? Math.round((accepted7d / sent7dRows.length) * 100) : null;
  const replies7dCount = (replies7dQ.data ?? []).length;
  const response7dPct = sent7dRows.length > 0 ? Math.round((replies7dCount / sent7dRows.length) * 100) : null;

  // Tenant aggregations. We bucket every row by lead.company_bio_id so each
  // tenant card shows what it owns. Sent24h pulls from the reconciled ledger
  // (step 0 sent in last 24h). Rows with no bio_id (system / orphan) bucket
  // to "unknown" so they're at least visible somewhere.
  const bioNameMap = new Map<string, string>();
  for (const b of (bioQ.data ?? []) as any[]) {
    bioNameMap.set(b.id as string, (b.company_name as string | null) ?? "(unnamed)");
  }
  const tenantInit = (bioId: string): TenantSummary => ({
    bioId,
    name: bioNameMap.get(bioId) ?? "(unknown tenant)",
    queued: 0, failed: 0, stuck: 0, cooldown: 0, sent24h: 0, ghost: 0,
  });
  const tenantMap = new Map<string, TenantSummary>();
  const bumpTenant = (bioId: string | null | undefined, field: keyof Omit<TenantSummary, "bioId" | "name">) => {
    const key = bioId ?? "__no_tenant__";
    if (!tenantMap.has(key)) tenantMap.set(key, tenantInit(key));
    tenantMap.get(key)![field] += 1;
  };
  for (const r of queuedRaw) bumpTenant(r.leads?.company_bio_id, "queued");
  for (const r of (failedQ.data ?? []) as unknown as CampaignMessageRow[]) bumpTenant(r.leads?.company_bio_id, "failed");
  for (const r of stuck) bumpTenant(r.leads?.company_bio_id, "stuck");
  for (const r of queuedCooldown) bumpTenant(r.leads?.company_bio_id, "cooldown");
  for (const r of reconciled) bumpTenant(r.leads?.company_bio_id, "sent24h");
  for (const r of reconciled) if (r._bucket === "ghost") bumpTenant(r.leads?.company_bio_id, "ghost");
  const tenants = Array.from(tenantMap.values()).sort((a, b) =>
    (b.ghost + b.failed + b.stuck) - (a.ghost + a.failed + a.stuck) || b.queued - a.queued || a.name.localeCompare(b.name),
  );

  return {
    queueHealth: {
      queuedReady, queuedCooldown, queuedWaiting, queuedByCampaign,
      dispatching: (dispatchingQ.data ?? []) as unknown as CampaignMessageRow[],
      failed: (failedQ.data ?? []) as unknown as CampaignMessageRow[],
      skipped: (skippedQ.data ?? []) as unknown as CampaignMessageRow[],
      stuck, expired,
    },
    sentVsUnipile: { rows: reconciled, ghostCount, matchedCount, acceptedCount },
    sellerHealth,
    kpis: {
      sentToday, aggregateCap,
      acceptance7d: { sent: sent7dRows.length, accepted: accepted7d, pct: acceptance7dPct },
      response7d: { sent: sent7dRows.length, replies: replies7dCount, pct: response7dPct },
      activeCooldownSellers: sellerInCooldown.size,
      activeCooldownMessages,
    },
    tenants,
    fetchedAt: new Date().toISOString(),
  };
}

function leadName(r: CampaignMessageRow): string {
  const f = r.leads?.primary_first_name ?? "";
  const l = r.leads?.primary_last_name ?? "";
  return `${f} ${l}`.trim() || "(no name)";
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const s = Math.round(abs / 1000);
  const m = Math.round(abs / 60_000);
  const h = Math.round(abs / 3_600_000);
  const d = Math.round(abs / 86_400_000);
  let label = "";
  if (s < 60) label = `${s}s`;
  else if (m < 60) label = `${m}m`;
  else if (h < 48) label = `${h}h`;
  else label = `${d}d`;
  return ms < 0 ? `${label} ago` : `in ${label}`;
}

// Filters a row list by the selected tenant. "all" / null returns the list
// untouched. A specific bioId keeps rows whose lead.company_bio_id matches.
function byTenant<T extends { leads?: { company_bio_id?: string | null } | null }>(
  rows: T[], tenantId: string | null,
): T[] {
  if (!tenantId || tenantId === "all") return rows;
  return rows.filter(r => r.leads?.company_bio_id === tenantId);
}

export default async function ReliabilityPage({ searchParams }: { searchParams: Promise<{ noise?: string; tenant?: string; tab?: string }> }) {
  const scope = await getUserScope();
  if (!canViewSwlAdmin(scope.tier)) redirect("/");

  const params = await searchParams;
  const showNoise = params.noise === "1";
  const tenantId = params.tenant && params.tenant !== "all" ? params.tenant : null;
  // Tab selector — default is "status" (health overview + action required).
  // Pipeline = queue/cooldown/waiting/dispatching. History = sent/skipped/expired.
  const tab: ReliabilityTabKey =
    params.tab === "pipeline" ? "pipeline"
    : params.tab === "history" ? "history"
    : "status";

  const data = await fetchReliability();
  const { queueHealth, sentVsUnipile, sellerHealth, kpis, fetchedAt, tenants } = data;

  // Resolve selected tenant name for the header.
  const selectedTenant = tenantId ? tenants.find(t => t.bioId === tenantId) : null;
  const selectedLabel = selectedTenant?.name ?? "All tenants";

  // Apply tenant filter to every list before rendering.
  const fQueuedReady = byTenant(queueHealth.queuedReady, tenantId);
  const fQueuedCooldown = byTenant(queueHealth.queuedCooldown, tenantId);
  const fQueuedWaiting = byTenant(queueHealth.queuedWaiting, tenantId);
  const fDispatching = byTenant(queueHealth.dispatching, tenantId);
  const fFailedAll = byTenant(queueHealth.failed, tenantId);
  const fSkippedAll = byTenant(queueHealth.skipped, tenantId);
  const fStuck = byTenant(queueHealth.stuck, tenantId);
  const fExpired = byTenant(queueHealth.expired, tenantId);
  const fSentRows = byTenant(sentVsUnipile.rows, tenantId);
  const fSellers = tenantId ? sellerHealth.filter(s => s.companyBioId === tenantId) : sellerHealth;
  const fGhostCount = fSentRows.filter(r => r._bucket === "ghost").length;
  const fAcceptedCount = fSentRows.filter(r => r._bucket === "accepted").length;
  const fMatchedCount = fSentRows.filter(r => r._bucket === "pending").length;

  const noiseCutoff = Date.now() - NOISE_DAYS * 24 * 60 * 60 * 1000;
  const isRecent = (iso: string | null) => !iso || new Date(iso).getTime() >= noiseCutoff;
  const failedVisible = showNoise ? fFailedAll : fFailedAll.filter((r) => isRecent(r.created_at));
  const failedHiddenCount = fFailedAll.length - failedVisible.length;
  const skippedVisible = showNoise ? fSkippedAll : fSkippedAll.filter((r) => isRecent(r.created_at));
  const skippedHiddenCount = fSkippedAll.length - skippedVisible.length;

  // "Acción requerida" = anything the operator should look at.
  const actionRequiredCount =
    failedVisible.length + fStuck.length + fGhostCount;
  // "Pipeline" = work currently flowing through the dispatcher (no action needed).
  const pipelineCount =
    fQueuedReady.length + fQueuedCooldown.length + fQueuedWaiting.length + fDispatching.length;
  // Build the rebuilt-on-filter campaign map for the panic-pause buttons.
  const fQueuedByCampaign = new Map<string, QueuedClassified[]>();
  for (const r of [...fQueuedReady, ...fQueuedCooldown, ...fQueuedWaiting]) {
    const name = r.campaigns?.name ?? "(no name)";
    const list = fQueuedByCampaign.get(name) ?? [];
    list.push(r);
    fQueuedByCampaign.set(name, list);
  }

  // Aggregate counts for the scoped status banner.
  const allClean =
    actionRequiredCount === 0 && pipelineCount === 0;

  // Per-tenant healthscore for the Status tab tenant grid. Computed off the
  // tenant summaries built in fetchReliability (which already aggregate per
  // bio_id). Scoring is identical across the page so the chip dot and the
  // grid card border stay in sync.
  const tenantHealth: TenantHealth[] = tenants.map(t => computeTenantHealth(t));
  const globalHealth = tenantHealth.length > 0
    ? Math.round(tenantHealth.reduce((a, t) => a + t.health, 0) / tenantHealth.length)
    : 100;
  // Counts shown next to each tab label so the operator sees at a glance
  // whether they have to switch tabs (e.g. "5 ghosts in History").
  const historyCount = fSentRows.length + skippedVisible.length + fExpired.length;
  const tabCounts = {
    status: actionRequiredCount,
    pipeline: pipelineCount,
    history: historyCount,
  };

  return (
    <div className="p-6 w-full max-w-7xl mx-auto">
      <Breadcrumb crumbs={[{ label: "Admin", href: "/admin" }, { label: "Reliability" }]} />

      {/* ─── Hero ───────────────────────────────────────────────────
          Same navy + gold treatment as the rest of the app (PageHero
          component) so the page feels native to the brand. Action slot
          carries the live-refresh widget; stats give a one-glance read
          of tenants, global health and the actionable backlog. */}
      <PageHero
        icon={ShieldCheck}
        section="ADMIN · INFRASTRUCTURE"
        title="Reliability"
        description={selectedLabel === "All tenants"
          ? `Pipeline health across every tenant. Fetched ${formatTime(fetchedAt)}.`
          : `Pipeline health for ${selectedLabel}. Click "All tenants" to widen the scope.`}
        accentColor="var(--brand, #c9a83a)"
        status={{ label: actionRequiredCount > 0 ? `${actionRequiredCount} acción${actionRequiredCount === 1 ? "" : "es"} requerida${actionRequiredCount === 1 ? "" : "s"}` : "Healthy", active: actionRequiredCount === 0 }}
        action={<ReliabilityActions />}
        stats={[
          { label: "Tenants", value: tenants.length, tone: "neutral" },
          { label: "Health", value: globalHealth, tone: globalHealth >= 85 ? "positive" : globalHealth >= 60 ? "warning" : "danger" },
          { label: "Acción", value: actionRequiredCount, tone: actionRequiredCount > 0 ? "danger" : "neutral" },
          { label: "Pipeline", value: pipelineCount, tone: pipelineCount > 0 ? "warning" : "neutral" },
        ]}
      />

      {/* Scoped to one tenant? Surface a clear back-to-all chip so the
          operator can widen the scope from the same place they narrowed
          it — the chip strip used to live here pre-rework. */}
      {tenantId && selectedTenant && (
        <div className="mb-3 flex items-center gap-2 text-[12px]">
          <Link
            href="/admin/reliability"
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-semibold transition-opacity hover:opacity-80"
            style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }}
          >
            ← All tenants
          </Link>
          <span style={{ color: C.textMuted }}>
            Filtering by <strong style={{ color: C.textBody }}>{selectedTenant.name}</strong>
          </span>
        </div>
      )}

      {/* ─── Tab nav: Status / Pipeline / History ────────────────── */}
      <ReliabilityTabs active={tab} counts={tabCounts} />

      {/* ─── KPI ribbon (scoped to selected tenant) ──────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi
          label="Sent today"
          value={`${kpis.sentToday}`}
          sub={`of ${kpis.aggregateCap} cap`}
          icon={Send}
          color={kpis.sentToday >= kpis.aggregateCap * 0.8 ? "#D97706" : C.linkedin}
        />
        <Kpi
          label="Acceptance 7d"
          value={kpis.acceptance7d.pct === null ? "—" : `${kpis.acceptance7d.pct}%`}
          sub={`${kpis.acceptance7d.accepted}/${kpis.acceptance7d.sent} invites`}
          icon={TrendingUp}
          color={
            kpis.acceptance7d.pct === null ? C.textDim
            : kpis.acceptance7d.pct >= 30 ? C.green
            : kpis.acceptance7d.pct >= 15 ? "#D97706"
            : C.red
          }
        />
        <Kpi
          label="Response 7d"
          value={kpis.response7d.pct === null ? "—" : `${kpis.response7d.pct}%`}
          sub={`${kpis.response7d.replies} replies / ${kpis.response7d.sent} sent`}
          icon={MessageSquare}
          color={
            kpis.response7d.pct === null ? C.textDim
            : kpis.response7d.pct >= 5 ? C.green
            : kpis.response7d.pct >= 2 ? "#D97706"
            : C.red
          }
        />
        <Kpi
          label="Active cooldowns"
          value={`${kpis.activeCooldownSellers}`}
          sub={`${kpis.activeCooldownMessages} messages frozen`}
          icon={Snowflake}
          color={kpis.activeCooldownSellers > 0 ? "#D97706" : C.green}
        />
      </div>

      {/* Status sub-nav — sticky jump-link strip so the operator can skip
          straight to "Acción" or "Sellers" without scrolling past the
          tenant grid. Only shown on Status (Pipeline + History don't
          have enough sub-sections to justify a nav). */}
      {tab === "status" && (
        <nav
          className="sticky z-30 mb-5 rounded-xl border flex items-center gap-1 px-2 py-1.5 backdrop-blur"
          style={{
            top: 12,
            borderColor: C.border,
            backgroundColor: "color-mix(in srgb, var(--bg, #fff) 88%, transparent)",
          }}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider px-2" style={{ color: C.textDim }}>Jump to</span>
          <a href="#health" className="text-[11.5px] font-semibold px-2 py-1 rounded-md transition-colors hover:bg-black/[0.04]" style={{ color: C.textBody }}>Salud</a>
          {selectedLabel === "All tenants" && tenantHealth.length > 0 && (
            <a href="#tenants" className="text-[11.5px] font-semibold px-2 py-1 rounded-md transition-colors hover:bg-black/[0.04]" style={{ color: C.textBody }}>Tenants</a>
          )}
          {actionRequiredCount > 0 && (
            <a href="#action-required" className="text-[11.5px] font-semibold px-2 py-1 rounded-md transition-colors hover:bg-black/[0.04]" style={{ color: C.red }}>
              Acción <span className="tabular-nums">({actionRequiredCount})</span>
            </a>
          )}
          <a href="#sellers" className="text-[11.5px] font-semibold px-2 py-1 rounded-md transition-colors hover:bg-black/[0.04]" style={{ color: C.textBody }}>Sellers</a>
        </nav>
      )}

      {/* ════════════════════════════════════════════════════════════
          STATUS TAB — health banner + tenant grid + action required
          ════════════════════════════════════════════════════════════ */}
      {tab === "status" && (
        <section id="health" className="scroll-mt-24">
          <HealthBanner
            global={globalHealth}
            actionRequired={actionRequiredCount}
            pipeline={pipelineCount}
            scopeLabel={selectedLabel}
          />
        </section>
      )}

      {/* Tenant grid is only meaningful in the cross-tenant view. */}
      {tab === "status" && selectedLabel === "All tenants" && tenantHealth.length > 0 && (
        <section id="tenants" className="mb-6 scroll-mt-24">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: C.textPrimary }}>
              Health por tenant
            </h2>
            <span className="text-[11px]" style={{ color: C.textMuted }}>
              {tenantHealth.length} tenant{tenantHealth.length === 1 ? "" : "s"} con actividad · click para filtrar
            </span>
          </div>
          <TenantHealthGrid tenants={tenantHealth} activeTenantId={tenantId} />
        </section>
      )}

      {tab === "status" && allClean && (
        <div className="rounded-xl border p-5 mb-6 flex items-center gap-3"
          style={{ backgroundColor: C.greenLight, borderColor: C.green + "30" }}>
          <CheckCircle2 size={20} style={{ color: C.green }} />
          <span className="text-sm font-medium" style={{ color: C.green }}>
            Nothing in queue, nothing failed. {selectedLabel === "All tenants" ? "All tenants are clean." : `${selectedLabel} is clean.`}
          </span>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────
          STATUS · Acción requerida — failed / stuck / ghosts
          ──────────────────────────────────────────────────────────── */}
      {tab === "status" && actionRequiredCount > 0 && (
        <section id="action-required" className="scroll-mt-24">
        <SectionGroup title="Acción requerida" subtitle="Cosas que necesitan tu atención — el dispatcher no las va a resolver solo." accent={C.red} count={actionRequiredCount}>
          {/* Failed */}
          {(failedVisible.length > 0 || failedHiddenCount > 0) && (
            <CollapsibleSection
              title="Mensajes fallidos"
              accent={C.red}
              count={failedVisible.length}
              defaultOpen={failedVisible.length > 0}
              hint={failedHiddenCount > 0 ? `${failedHiddenCount} hidden older than ${NOISE_DAYS}d` : "Necesita acción"}>
              {failedHiddenCount > 0 && (
                <div className="px-5 py-3 text-[11px] flex items-center gap-2" style={{ backgroundColor: C.surface, borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>
                  <span>Hiding {failedHiddenCount} row(s) older than {NOISE_DAYS}d.</span>
                  <HideNoiseToggle showing={showNoise} />
                </div>
              )}
              <FailedSummary rows={failedVisible as any} />
              <Table>
                <thead>
                  <Th>When</Th>
                  <Th>Lead</Th>
                  <Th>Company</Th>
                  <Th>Seller</Th>
                  <Th>Step</Th>
                  <Th>Error</Th>
                  <Th>Action</Th>
                </thead>
                <tbody>
                  {failedVisible.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <Td>{formatTime(r.created_at)}</Td>
                      <Td>{leadName(r)}</Td>
                      <Td>{r.leads?.company_name ?? "—"}</Td>
                      <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                      <Td>{r.step_number}</Td>
                      <Td>
                        <span className="text-xs block max-w-[280px] truncate" style={{ color: C.red }} title={r.error_details ?? "(no error captured)"}>
                          {r.error_details ?? "(no error captured)"}
                        </span>
                      </Td>
                      <Td><RetryButton messageId={r.id} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}

          {/* Stuck */}
          {fStuck.length > 0 && (
            <CollapsibleSection
              title="Invites trabados (7-21 días sin aceptación)"
              accent="#D97706"
              count={fStuck.length}
              defaultOpen={fStuck.length > 0}
              hint="Invitación enviada hace más de 7d, el lead no la aceptó">
              <Table>
                <thead>
                  <Th>Sent</Th>
                  <Th>Lead</Th>
                  <Th>Company</Th>
                  <Th>Seller</Th>
                </thead>
                <tbody>
                  {fStuck.map((r) => {
                    const days = r.sent_at ? Math.floor((Date.now() - new Date(r.sent_at).getTime()) / 86400000) : 0;
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                        <Td>
                          <span className="text-xs">{formatTime(r.sent_at)}</span>
                          <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded" style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>{days}d ago</span>
                        </Td>
                        <Td>{leadName(r)}</Td>
                        <Td>{r.leads?.company_name ?? "—"}</Td>
                        <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}

          {/* Ghost-sent — REAL ghosts only (no Unipile match AND no engagement signal) */}
          {fGhostCount > 0 && (
            <CollapsibleSection
              title={`Ghost-sent — DB dice enviado, Unipile no lo registra y el lead no respondió (${fGhostCount})`}
              accent={C.red}
              count={fGhostCount}
              defaultOpen={true}
              hint="Posible falla del dispatcher: invite nunca salió">
              <div className="px-4 py-2.5 text-[11px]" style={{ color: C.textMuted, backgroundColor: C.surface, borderBottom: `1px solid ${C.border}` }}>
                Filas SIN match en el feed pending de Unipile Y sin señal de engagement (`linkedin_connected=false`, `responded=false`). El invite probablemente nunca salió o falló silenciosamente. Investigar.
              </div>
              <Table>
                <thead>
                  <Th>Sent at</Th>
                  <Th>Lead</Th>
                  <Th>Seller</Th>
                  <Th>Reason</Th>
                </thead>
                <tbody>
                  {fSentRows.filter(r => r._bucket === "ghost").map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <Td>{formatTime(r.sent_at)}</Td>
                      <Td>{leadName(r)}</Td>
                      <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                      <Td><span className="text-xs block max-w-[280px] truncate" style={{ color: C.textMuted }} title={r._matchReason}>{r._matchReason}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}
        </SectionGroup>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════
          PIPELINE TAB — work flowing through, no action needed
          ════════════════════════════════════════════════════════════ */}
      {tab === "pipeline" && pipelineCount === 0 && (
        <div className="rounded-xl border p-5 mb-6 flex items-center gap-3"
          style={{ backgroundColor: C.greenLight, borderColor: C.green + "30" }}>
          <CheckCircle2 size={20} style={{ color: C.green }} />
          <span className="text-sm font-medium" style={{ color: C.green }}>
            Sin mensajes en cola. {selectedLabel === "All tenants" ? "Todos los tenants vacíos." : `${selectedLabel} vacío.`}
          </span>
        </div>
      )}
      {tab === "pipeline" && pipelineCount > 0 && (
        <SectionGroup title="Pipeline en curso" subtitle="Mensajes que el dispatcher está procesando solo — no necesitan acción." accent="#D97706" count={pipelineCount}>
          {/* Cooldown */}
          {fQueuedCooldown.length > 0 && (
            <CollapsibleSection
              title="En cooldown (rate-limit)"
              accent="#D97706"
              count={fQueuedCooldown.length}
              defaultOpen={fQueuedCooldown.length > 0}
              hint="LinkedIn frenó al seller. Auto-reanuda en 4h.">
              <div className="px-4 py-2.5 text-[11px]" style={{ color: C.textMuted, backgroundColor: C.surface, borderBottom: `1px solid ${C.border}` }}>
                Cada fila fue rate-limited por LinkedIn (o cascadeó de otra). El dispatcher las salta hasta que pasa la ventana de 4h. Usá "Force retry" solo si verificaste que el account del seller no está bloqueado.
              </div>
              <Table>
                <thead>
                  <Th>Lead</Th>
                  <Th>Step</Th>
                  <Th>Seller</Th>
                  <Th>Cooldown until</Th>
                  <Th>Reason</Th>
                  <Th>Action</Th>
                </thead>
                <tbody>
                  {fQueuedCooldown.map((r) => {
                    const meta = (r.metadata ?? {}) as Record<string, unknown>;
                    const reason = (meta.last_rate_limit_reason as string | undefined) ?? "—";
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                        <Td>{leadName(r)}</Td>
                        <Td>{r.step_number}</Td>
                        <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                        <Td>
                          <span className="text-xs">{formatTime(r._cooldownUntil ?? null)}</span>
                          <span className="text-[10px] ml-2" style={{ color: C.textDim }}>({formatRelative(r._cooldownUntil ?? null)})</span>
                        </Td>
                        <Td><span className="text-[11px] block max-w-[260px] truncate" style={{ color: C.textMuted }} title={reason}>{reason}</span></Td>
                        <Td><CancelCooldownButton messageId={r.id} /></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}

          {/* Ready */}
          {fQueuedReady.length > 0 && (
            <CollapsibleSection
              title="Listos para enviar"
              accent={C.linkedin}
              count={fQueuedReady.length}
              hint="Salen en el próximo tick del orquestador (15 min)">
              {fQueuedByCampaign.size > 0 && (
                <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ backgroundColor: C.surface, borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>
                  Pausa de emergencia por campaña:
                  {Array.from(fQueuedByCampaign.entries()).map(([name, rows]) => {
                    const readyCount = rows.filter((r) => r._bucket === "ready").length;
                    if (readyCount === 0) return null;
                    return (
                      <span key={name} className="inline-flex items-center gap-2">
                        <span className="font-medium" style={{ color: C.textBody }}>{name.slice(0, 50)}{name.length > 50 ? "…" : ""}</span>
                        <PauseCampaignButton campaignName={name} queuedCount={rows.length} />
                      </span>
                    );
                  })}
                </div>
              )}
              <Table>
                <thead>
                  <Th>Created</Th>
                  <Th>Lead</Th>
                  <Th>Seller</Th>
                  <Th>Step</Th>
                  <Th>Channel</Th>
                </thead>
                <tbody>
                  {fQueuedReady.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <Td>{formatTime(r.created_at)}</Td>
                      <Td>{leadName(r)}</Td>
                      <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                      <Td>{r.step_number}</Td>
                      <Td>{r.channel}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}

          {/* Waiting */}
          {fQueuedWaiting.length > 0 && (
            <CollapsibleSection
              title="En espera (futuro)"
              accent="#7C3AED"
              count={fQueuedWaiting.length}
              hint="Step 1+ programados para una fecha futura. Salen cuando llega el momento.">
              <Table>
                <thead>
                  <Th>Lead</Th>
                  <Th>Step</Th>
                  <Th>Seller</Th>
                  <Th>Eligible at</Th>
                </thead>
                <tbody>
                  {fQueuedWaiting.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <Td>{leadName(r)}</Td>
                      <Td>{r.step_number}</Td>
                      <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                      <Td>
                        <span className="text-xs">{formatTime(r._eligibleAt ?? null)}</span>
                        <span className="text-[10px] ml-2" style={{ color: C.textDim }}>({formatRelative(r._eligibleAt ?? null)})</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}

          {/* Dispatching */}
          {fDispatching.length > 0 && (
            <CollapsibleSection
              title="Despachando ahora"
              accent="#7C3AED"
              count={fDispatching.length}
              defaultOpen={fDispatching.length > 0}
              hint="Mensajes en vuelo en este momento">
              <Table>
                <thead>
                  <Th>Lead</Th>
                  <Th>Seller</Th>
                  <Th>Started</Th>
                </thead>
                <tbody>
                  {fDispatching.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <Td>{leadName(r)}</Td>
                      <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                      <Td>{formatTime(r.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}
        </SectionGroup>
      )}

      {/* ════════════════════════════════════════════════════════════
          HISTORY TAB — what just happened (sent / skipped / expired)
          ════════════════════════════════════════════════════════════ */}
      {tab === "history" && historyCount === 0 && (
        <div className="rounded-xl border p-5 mb-6 flex items-center gap-3"
          style={{ backgroundColor: C.surface, borderColor: C.border }}>
          <Activity size={20} style={{ color: C.textMuted }} />
          <span className="text-sm" style={{ color: C.textBody }}>
            Sin actividad reciente que mostrar.
          </span>
        </div>
      )}
      {tab === "history" && (fSentRows.length > 0 || skippedVisible.length > 0 || fExpired.length > 0) && (
        <SectionGroup title="Actividad reciente" subtitle="Lo que pasó hace poco. Sólo lectura." accent={C.green} count={fMatchedCount + skippedVisible.length + fExpired.length}>
          {/* Sent 24h reconciliation — 3 buckets:
              ✓ pending   matched in Unipile sent feed
              ✓ accepted  not in feed, but lead engaged (1st-degree or replied)
              ✗ ghost     not in feed AND no engagement — bubbled up to Acción requerida */}
          {fSentRows.length > 0 && (
            <CollapsibleSection
              title={`Enviados últimas 24h (${fMatchedCount} pending · ${fAcceptedCount} accepted · ${fGhostCount} ghost)`}
              accent={C.green}
              count={fSentRows.length}
              hint={fGhostCount > 0 ? `${fGhostCount} ghosts en Acción requerida` : "Sin ghosts"}>
              <Table>
                <thead>
                  <Th>Sent at</Th>
                  <Th>Lead</Th>
                  <Th>Seller</Th>
                  <Th>Bucket</Th>
                  <Th>Reason</Th>
                </thead>
                <tbody>
                  {fSentRows.map((r) => {
                    const bucketMeta = {
                      pending: { label: "✓ PENDING", color: C.linkedin },
                      accepted: { label: "✓ ACCEPTED", color: C.green },
                      ghost: { label: "✗ GHOST", color: C.red },
                    }[r._bucket];
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                        <Td>{formatTime(r.sent_at)}</Td>
                        <Td>{leadName(r)}</Td>
                        <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                        <Td>
                          <span className="text-xs font-bold" style={{ color: bucketMeta.color }}>
                            {bucketMeta.label}
                          </span>
                        </Td>
                        <Td><span className="text-xs block max-w-[280px] truncate" style={{ color: C.textMuted }} title={r._matchReason}>{r._matchReason}</span></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}

          {/* Skipped */}
          {(skippedVisible.length > 0 || skippedHiddenCount > 0) && (
            <CollapsibleSection
              title="Saltados"
              accent="#6B7280"
              count={skippedVisible.length}
              hint={skippedHiddenCount > 0 ? `${skippedHiddenCount} hidden older than ${NOISE_DAYS}d` : "Ya conectados / invite pending / etc."}>
              {skippedHiddenCount > 0 && (
                <div className="px-4 py-2 text-[11px] flex items-center gap-2" style={{ backgroundColor: C.surface, borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>
                  <span>Hiding {skippedHiddenCount} row(s) older than {NOISE_DAYS}d.</span>
                  <HideNoiseToggle showing={showNoise} />
                </div>
              )}
              <Table>
                <thead>
                  <Th>Lead</Th>
                  <Th>Step</Th>
                  <Th>Channel</Th>
                  <Th>Created</Th>
                </thead>
                <tbody>
                  {skippedVisible.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <Td>{leadName(r)}</Td>
                      <Td>{r.step_number}</Td>
                      <Td>{r.channel}</Td>
                      <Td>{formatTime(r.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}

          {/* Expired */}
          {fExpired.length > 0 && (
            <CollapsibleSection
              title="Expirados (≥21 días, LinkedIn los descartó)"
              accent={C.textDim}
              count={fExpired.length}
              hint="Sólo historia">
              <Table>
                <thead>
                  <Th>Sent</Th>
                  <Th>Lead</Th>
                  <Th>Company</Th>
                  <Th>Seller</Th>
                </thead>
                <tbody>
                  {fExpired.map((r) => {
                    const days = r.sent_at ? Math.floor((Date.now() - new Date(r.sent_at).getTime()) / 86400000) : 0;
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                        <Td>
                          <span className="text-xs">{formatTime(r.sent_at)}</span>
                          <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded" style={{ backgroundColor: C.surface, color: C.textMuted }}>{days}d ago</span>
                        </Td>
                        <Td>{leadName(r)}</Td>
                        <Td>{r.leads?.company_name ?? "—"}</Td>
                        <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </CollapsibleSection>
          )}
        </SectionGroup>
      )}

      {/* ════════════════════════════════════════════════════════════
          STATUS · Seller / Unipile account health
          ════════════════════════════════════════════════════════════ */}
      {tab === "status" && (
      <section id="sellers" className="scroll-mt-24">
      <CollapsibleSection title="Seller / Unipile account health" accent={C.gold} hint={tenantId ? "Sellers del tenant seleccionado" : "Todos los sellers activos"} defaultOpen={true}>
        <Table>
          <thead>
            <Th>Seller</Th>
            <Th>Unipile</Th>
            <Th>Today (24h)</Th>
            <Th>Acceptance 30d</Th>
            <Th>Status</Th>
          </thead>
          <tbody>
            {fSellers.map((s) => {
              const pct = s.dailyLimit > 0 ? Math.min(100, Math.round((s.dailySent / s.dailyLimit) * 100)) : 0;
              const atCap = s.dailySent >= s.dailyLimit;
              const dailyColor = atCap ? C.red : pct >= 80 ? "#D97706" : C.linkedin;
              const accPct = s.acceptance30d.pct;
              const accColor = accPct === null ? C.textDim
                : accPct >= 30 ? C.green
                : accPct >= 15 ? "#D97706"
                : C.red;
              return (
                <tr key={s.sellerId} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td>
                    <div className="flex flex-col">
                      <span style={{ color: C.textBody }}>{s.sellerName}</span>
                      <span className="text-[10px] font-mono" style={{ color: C.textDim }}>
                        {s.unipileAccountId ?? "(not connected)"}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <span className="text-xs">{s.invitesInUnipile} invites</span>
                    {s.unipileError && <div className="text-[10px]" style={{ color: C.red }}>{s.unipileError}</div>}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2 min-w-[140px]">
                      <span className="text-xs tabular-nums font-semibold" style={{ color: dailyColor }}>
                        {s.dailySent}/{s.dailyLimit}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: dailyColor }} />
                      </div>
                      {atCap && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: C.redLight, color: C.red }}>AT CAP</span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    {accPct === null ? (
                      <span className="text-xs" style={{ color: C.textDim }}>no data</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums font-semibold" style={{ color: accColor }}>
                          {accPct}%
                        </span>
                        <span className="text-[10px]" style={{ color: C.textDim }}>
                          {s.acceptance30d.accepted}/{s.acceptance30d.sent}
                        </span>
                      </div>
                    )}
                  </Td>
                  <Td>
                    {s.rateLimitedUntil ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>
                        <Snowflake size={9} /> RATE-LIMITED · clears {formatRelative(s.rateLimitedUntil)}
                      </span>
                    ) : s.unipileError ? (
                      <span className="text-xs" style={{ color: C.red }}>error</span>
                    ) : s.unipileAccountId ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: C.greenLight, color: C.green }}>
                        <Activity size={9} /> OK
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: C.textMuted }}>not connected</span>
                    )}
                  </Td>
                </tr>
              );
            })}
            {fSellers.length === 0 && (
              <tr><Td><span className="text-xs" style={{ color: C.textDim }}>Sin sellers activos para este tenant.</span></Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
            )}
          </tbody>
        </Table>
      </CollapsibleSection>
      </section>
      )}
    </div>
  );
}

// Group header that wraps several CollapsibleSections. Visual separator
// between "Acción requerida" / "Pipeline" / "Actividad" so each block reads
// as a logical unit instead of one long list of unrelated sections.
function SectionGroup({ title, subtitle, accent, count, children }: { title: string; subtitle: string; accent: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-7">
      <div className="flex items-baseline justify-between mb-3 px-1">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: accent }}>
            {title}
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums"
              style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
              {count}
            </span>
          </h2>
          <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// Top-level health card for the Status tab. Reads as a one-line answer to
// "¿hay que tocar algo ahora?" — green if everything's quiet, amber if the
// dispatcher is busy but healthy, red if there's anything actionable.
function HealthBanner({
  global,
  actionRequired,
  pipeline,
  scopeLabel,
}: {
  global: number;
  actionRequired: number;
  pipeline: number;
  scopeLabel: string;
}) {
  const tone =
    actionRequired > 0 ? "danger" :
    pipeline > 0 ? "neutral" : "ok";
  const accent = tone === "danger" ? C.red : tone === "neutral" ? "#D97706" : C.green;
  const bg = tone === "danger" ? `color-mix(in srgb, ${C.red} 8%, ${C.card})`
    : tone === "neutral" ? `color-mix(in srgb, #D97706 6%, ${C.card})`
    : C.greenLight;
  const headline =
    tone === "danger" ? `${actionRequired} ${actionRequired === 1 ? "cosa" : "cosas"} requieren tu acción`
    : tone === "neutral" ? `${pipeline} mensajes en pipeline — sin acción requerida`
    : "Todo limpio";
  const subline = scopeLabel === "All tenants"
    ? "Health agregada de todos los tenants"
    : `Scope: ${scopeLabel}`;
  const Icon = tone === "danger" ? AlertTriangle : tone === "neutral" ? Activity : CheckCircle2;
  return (
    <div className="rounded-2xl border p-5 mb-5 flex items-center gap-4"
      style={{ borderColor: `color-mix(in srgb, ${accent} 28%, ${C.border})`, backgroundColor: bg }}>
      <span className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)`, color: accent }}>
        <Icon size={22} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold leading-tight" style={{ color: accent }}>{headline}</p>
        <p className="text-[12px] mt-0.5" style={{ color: C.textBody }}>{subline}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[28px] font-bold tabular-nums leading-none" style={{ color: accent, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{global}</p>
        <p className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: accent }}>Health</p>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub: string; icon: any; color: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>{label}</span>
        <Icon size={12} style={{ color: C.textDim }} />
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{sub}</div>
    </div>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  // Wrapped in an overflow-x container so long error strings or Unipile
  // URLs can scroll horizontally inside the section instead of pushing
  // the page out and forcing every other column into 1-char-per-line
  // wraps. Error cells should still set a max-w + truncate themselves.
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: 720 }}>{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: C.textMuted, backgroundColor: C.surface, borderBottom: `1px solid ${C.border}` }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5 text-xs" style={{ color: C.textBody }}>{children}</td>;
}
