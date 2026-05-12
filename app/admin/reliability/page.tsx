import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import { redirect } from "next/navigation";
import Breadcrumb from "@/components/Breadcrumb";
import { C } from "@/lib/design";
import { AlertTriangle, CheckCircle2, Clock, Send, Hourglass, Snowflake, Activity, MessageSquare, TrendingUp } from "lucide-react";
import ReliabilityActions from "./ReliabilityActions";
import RetryButton from "./RetryButton";
import { CancelCooldownButton, PauseCampaignButton } from "./CooldownActions";
import HideNoiseToggle from "./HideNoiseToggle";
import CollapsibleSection from "./CollapsibleSection";
import AutoRefresh from "./AutoRefresh";

// Reliability dashboard.
//
// The "ghost-sent" incident on Pathway (8 campaign_messages flagged as sent
// while Unipile had zero matching invitations) made it clear we needed a
// single place to see whether the database actually reflects what happened
// at the LinkedIn provider. This page reconciles three sources:
//
//   1. campaign_messages — what the CRM thinks happened
//   2. Unipile API       — the source of truth for invites/messages sent
//   3. n8n executions    — workflow runs, including failures
//
// Anything in the DB marked sent but missing from Unipile is a "ghost".
// Anything in queued/failed needs admin attention.

export const dynamic = "force-dynamic";

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY;

const RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const STUCK_DAYS = 7;
const EXPIRED_DAYS = 21; // LinkedIn auto-expires invites after ~3 weeks
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
    rows: Array<CampaignMessageRow & { _matched: boolean; _matchReason: string }>;
    ghostCount: number;
    matchedCount: number;
  };
  sellerHealth: Array<{
    sellerId: string;
    sellerName: string;
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
  fetchedAt: string;
};

async function fetchReliability(): Promise<ReliabilityData> {
  const svc = getSupabaseService();

  const queueSelect = "id, campaign_id, lead_id, step_number, channel, status, sent_at, provider_message_id, error_details, created_at, metadata, leads(primary_first_name, primary_last_name, primary_linkedin_url, company_name, company_bio_id, linkedin_connected), campaigns(name, seller_id, sellers(name, unipile_account_id))";

  const nowMs = Date.now();
  const since24h = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
  const stuckCutoff = new Date(nowMs - STUCK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const expiredCutoff = new Date(nowMs - EXPIRED_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [queuedQ, dispatchingQ, failedQ, skippedQ, sentLedgerQ, sellersQ, stuckExpiredQ, sent7dQ, sent30dQ, replies7dQ] = await Promise.all([
    svc.from("campaign_messages").select(queueSelect).eq("status", "queued").order("created_at", { ascending: true }),
    svc.from("campaign_messages").select(queueSelect).eq("status", "dispatching").order("created_at", { ascending: true }),
    svc.from("campaign_messages").select(queueSelect).eq("status", "failed").order("created_at", { ascending: false }).limit(50),
    svc.from("campaign_messages").select(queueSelect).eq("status", "skipped").order("created_at", { ascending: false }).limit(50),
    svc.from("campaign_messages").select(queueSelect).eq("status", "sent").eq("step_number", 0).gte("sent_at", since24h).order("sent_at", { ascending: false }),
    svc.from("sellers").select("id, name, unipile_account_id, active, linkedin_daily_limit").eq("active", true),
    // Stuck + expired: step 0 sent ≥7d ago. We split by age in JS.
    svc.from("campaign_messages").select(queueSelect)
      .eq("status", "sent").eq("step_number", 0).eq("channel", "linkedin")
      .lt("sent_at", stuckCutoff)
      .order("sent_at", { ascending: true }),
    // 7d sent step 0 (for acceptance rate global)
    svc.from("campaign_messages").select("id, lead_id, campaigns!inner(seller_id), leads!inner(linkedin_connected)")
      .eq("status", "sent").eq("step_number", 0).eq("channel", "linkedin")
      .gte("sent_at", since7d),
    // 30d sent step 0 by seller (for acceptance rate per seller)
    svc.from("campaign_messages").select("id, lead_id, campaigns!inner(seller_id), leads!inner(linkedin_connected)")
      .eq("status", "sent").eq("step_number", 0).eq("channel", "linkedin")
      .gte("sent_at", since30d),
    // 7d replies for response rate
    svc.from("lead_replies").select("id").gte("received_at", since7d),
  ]);

  // Pull Unipile sent invites per active seller (last 100 each).
  const unipileBySeller = new Map<string, UnipileSentInvite[]>();
  const sellerErrors = new Map<string, string>();
  if (UNIPILE_KEY && sellersQ.data) {
    await Promise.all(sellersQ.data.map(async (s: any) => {
      if (!s.unipile_account_id) return;
      try {
        // Always fetch fresh — the previous 60s revalidate window produced
        // false ghost-sent rows (2026-05-11 incident): 3 recent invitations
        // showed in Unipile via direct curl but the dashboard's cached page
        // copy didn't include them, so reconciliation marked them as ghost.
        // Reliability is a diagnostic surface; staleness defeats its purpose.
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

  // Reconcile sent rows against Unipile by invitation_id or LinkedIn slug.
  const ledger = (sentLedgerQ.data ?? []) as unknown as CampaignMessageRow[];
  const reconciled = ledger.map((r) => {
    const sellerId = r.campaigns?.seller_id ?? null;
    const invites = sellerId ? (unipileBySeller.get(sellerId) ?? []) : [];
    let matched = false;
    let reason = "no seller_id";
    if (sellerId) {
      reason = "no Unipile match";
      if (r.provider_message_id) {
        matched = invites.some((inv) => inv.id === r.provider_message_id);
        if (matched) reason = "matched by invitation_id";
      }
      if (!matched && r.leads?.primary_linkedin_url) {
        const m = r.leads.primary_linkedin_url.match(/\/in\/([^/?#]+)/i);
        const slug = m ? m[1].toLowerCase() : null;
        if (slug) {
          matched = invites.some((inv) => (inv.invited_user_public_id ?? "").toLowerCase() === slug);
          if (matched) reason = "matched by LinkedIn slug";
        }
      }
    }
    return { ...r, _matched: matched, _matchReason: reason };
  });

  const matchedCount = reconciled.filter((r) => r._matched).length;
  const ghostCount = reconciled.length - matchedCount;

  // Per-seller daily count: sent in last 24h (mirrors dispatcher's guard).
  const dailyCount = new Map<string, number>();
  for (const r of sentLedgerQ.data ?? []) {
    const sid = (r as any)?.campaigns?.seller_id as string | undefined;
    if (sid) dailyCount.set(sid, (dailyCount.get(sid) ?? 0) + 1);
  }

  // 30d acceptance rate per seller — sent step 0 vs leads.linkedin_connected.
  const acceptance30dBySeller = new Map<string, { sent: number; accepted: number }>();
  for (const r of (sent30dQ.data ?? []) as any[]) {
    const sid = r?.campaigns?.seller_id as string | undefined;
    if (!sid) continue;
    const cur = acceptance30dBySeller.get(sid) ?? { sent: 0, accepted: 0 };
    cur.sent += 1;
    if (r?.leads?.linkedin_connected === true) cur.accepted += 1;
    acceptance30dBySeller.set(sid, cur);
  }

  // Classify queued rows into ready / cooldown / waiting_acceptance.
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

  // Group queued (all buckets) by campaign name for the per-campaign pause action.
  const queuedByCampaign = new Map<string, QueuedClassified[]>();
  for (const r of [...queuedReady, ...queuedCooldown, ...queuedWaiting]) {
    const name = r.campaigns?.name ?? "(no name)";
    const list = queuedByCampaign.get(name) ?? [];
    list.push(r);
    queuedByCampaign.set(name, list);
  }

  // Stuck (7-21d) vs expired (≥21d).
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

  // Seller health rows.
  const sellerHealth = (sellersQ.data ?? []).map((s: any) => {
    const acc = acceptance30dBySeller.get(s.id) ?? { sent: 0, accepted: 0 };
    const pct = acc.sent > 0 ? Math.round((acc.accepted / acc.sent) * 100) : null;
    // Find the latest cooldown stamp among this seller's queued messages
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
      unipileAccountId: s.unipile_account_id ?? null,
      unipileError: sellerErrors.get(s.id) ?? null,
      invitesInUnipile: unipileBySeller.get(s.id)?.length ?? 0,
      dailySent: dailyCount.get(s.id) ?? 0,
      dailyLimit: (s.linkedin_daily_limit as number | null) ?? 20,
      rateLimitedUntil: latestCooldown ? new Date(latestCooldown).toISOString() : null,
      acceptance30d: { sent: acc.sent, accepted: acc.accepted, pct },
    };
  });

  // KPIs.
  const sentToday = Array.from(dailyCount.values()).reduce((a, b) => a + b, 0);
  const aggregateCap = sellerHealth.reduce((a, s) => a + s.dailyLimit, 0);
  const sent7dRows = (sent7dQ.data ?? []) as any[];
  const accepted7d = sent7dRows.filter((r) => r?.leads?.linkedin_connected === true).length;
  const acceptance7dPct = sent7dRows.length > 0 ? Math.round((accepted7d / sent7dRows.length) * 100) : null;
  const replies7dCount = (replies7dQ.data ?? []).length;
  const response7dPct = sent7dRows.length > 0 ? Math.round((replies7dCount / sent7dRows.length) * 100) : null;

  return {
    queueHealth: {
      queuedReady,
      queuedCooldown,
      queuedWaiting,
      queuedByCampaign,
      dispatching: (dispatchingQ.data ?? []) as unknown as CampaignMessageRow[],
      failed: (failedQ.data ?? []) as unknown as CampaignMessageRow[],
      skipped: (skippedQ.data ?? []) as unknown as CampaignMessageRow[],
      stuck,
      expired,
    },
    sentVsUnipile: { rows: reconciled, ghostCount, matchedCount },
    sellerHealth,
    kpis: {
      sentToday,
      aggregateCap,
      acceptance7d: { sent: sent7dRows.length, accepted: accepted7d, pct: acceptance7dPct },
      response7d: { sent: sent7dRows.length, replies: replies7dCount, pct: response7dPct },
      activeCooldownSellers: sellerInCooldown.size,
      activeCooldownMessages,
    },
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

export default async function ReliabilityPage({ searchParams }: { searchParams: Promise<{ noise?: string }> }) {
  const scope = await getUserScope();
  if (!canViewSwlAdmin(scope.tier)) redirect("/");

  const params = await searchParams;
  const showNoise = params.noise === "1";

  const data = await fetchReliability();
  const { queueHealth, sentVsUnipile, sellerHealth, kpis, fetchedAt } = data;

  // Failed/Skipped noise filter: hide rows older than NOISE_DAYS unless toggled.
  const noiseCutoff = Date.now() - NOISE_DAYS * 24 * 60 * 60 * 1000;
  const isRecent = (iso: string | null) => !iso || new Date(iso).getTime() >= noiseCutoff;
  const failedVisible = showNoise ? queueHealth.failed : queueHealth.failed.filter((r) => isRecent(r.created_at));
  const failedHiddenCount = queueHealth.failed.length - failedVisible.length;
  const skippedVisible = showNoise ? queueHealth.skipped : queueHealth.skipped.filter((r) => isRecent(r.created_at));
  const skippedHiddenCount = queueHealth.skipped.length - skippedVisible.length;

  const totalAttention = queueHealth.queuedReady.length + queueHealth.queuedCooldown.length
    + queueHealth.dispatching.length + failedVisible.length + queueHealth.stuck.length + sentVsUnipile.ghostCount;

  return (
    <div className="p-6 w-full max-w-6xl mx-auto">
      <Breadcrumb crumbs={[{ label: "Admin", href: "/admin" }, { label: "Reliability" }]} />

      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: C.textPrimary }}>Reliability</h1>
          <p className="text-sm" style={{ color: C.textMuted }}>
            DB ↔ Unipile reconciliation. Server fetched {formatTime(fetchedAt)}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AutoRefresh />
          <ReliabilityActions />
        </div>
      </div>

      {/* KPI ribbon — pipeline view at a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
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

      {/* Queue tiles — split by actionable bucket */}
      <div className="grid grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
        <Tile label="Ready" count={queueHealth.queuedReady.length} color={C.linkedin} icon={Clock} hint="Will dispatch on next tick" />
        <Tile label="Cooldown" count={queueHealth.queuedCooldown.length} color="#D97706" icon={Snowflake} hint="Frozen 4h after rate limit" />
        <Tile label="Waiting" count={queueHealth.queuedWaiting.length} color="#7C3AED" icon={Hourglass} hint="Step 1+ awaiting eligible_at" />
        <Tile label="Dispatching" count={queueHealth.dispatching.length} color="#7C3AED" icon={Send} />
        <Tile label="Failed" count={queueHealth.failed.length} color={queueHealth.failed.length > 0 ? C.red : C.green} icon={queueHealth.failed.length > 0 ? AlertTriangle : CheckCircle2} />
        <Tile label="Stuck (7-21d)" count={queueHealth.stuck.length} color={queueHealth.stuck.length > 0 ? "#D97706" : C.green} icon={queueHealth.stuck.length > 0 ? AlertTriangle : CheckCircle2} hint="Pending acceptance" />
        <Tile label="Ghost-sent (24h)" count={sentVsUnipile.ghostCount} color={sentVsUnipile.ghostCount > 0 ? C.red : C.green} icon={sentVsUnipile.ghostCount > 0 ? AlertTriangle : CheckCircle2} />
      </div>

      {totalAttention === 0 && (
        <div className="rounded-xl border p-5 mb-6 flex items-center gap-3"
          style={{ backgroundColor: C.greenLight, borderColor: C.green + "30" }}>
          <CheckCircle2 size={20} style={{ color: C.green }} />
          <span className="text-sm font-medium" style={{ color: C.green }}>
            Nothing in queue, nothing failed, no ghosts. Outgoing pipeline is clean.
          </span>
        </div>
      )}

      {/* Cooldown / rate-limited messages — most actionable */}
      {queueHealth.queuedCooldown.length > 0 && (
        <CollapsibleSection
          title="Cooldown — frozen by rate limit"
          accent="#D97706"
          count={queueHealth.queuedCooldown.length}
          defaultOpen={queueHealth.queuedCooldown.length > 0}
          hint="Frozen 4h after rate limit">
          <div className="px-4 py-2.5 text-[11px]" style={{ color: C.textMuted, backgroundColor: C.surface, borderBottom: `1px solid ${C.border}` }}>
            Each row was rate-limited by LinkedIn (or cascaded from a sibling). Dispatcher skips them until the cooldown expires. Use Force retry only if you've verified the seller's account isn't blocked.
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
              {queueHealth.queuedCooldown.map((r) => {
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
                    <Td><span className="text-[11px]" style={{ color: C.textMuted }}>{reason.slice(0, 80)}</span></Td>
                    <Td><CancelCooldownButton messageId={r.id} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </CollapsibleSection>
      )}

      {/* Ready to dispatch */}
      {queueHealth.queuedReady.length > 0 && (
        <CollapsibleSection
          title="Ready — will dispatch on next tick"
          accent={C.linkedin}
          count={queueHealth.queuedReady.length}
          hint="Pending next 15-min tick">
          {queueHealth.queuedByCampaign.size > 0 && (
            <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ backgroundColor: C.surface, borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>
              Per-campaign panic pause:
              {Array.from(queueHealth.queuedByCampaign.entries()).map(([name, rows]) => {
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
              {queueHealth.queuedReady.map((r) => (
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

      {/* Waiting acceptance — step 1+ post-accept timer */}
      {queueHealth.queuedWaiting.length > 0 && (
        <CollapsibleSection
          title="Waiting — step 1+ awaiting eligible_at"
          accent="#7C3AED"
          count={queueHealth.queuedWaiting.length}
          hint="Scheduled, not yet due">
          <Table>
            <thead>
              <Th>Lead</Th>
              <Th>Step</Th>
              <Th>Seller</Th>
              <Th>Eligible at</Th>
            </thead>
            <tbody>
              {queueHealth.queuedWaiting.map((r) => (
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
      {queueHealth.dispatching.length > 0 && (
        <CollapsibleSection
          title="Dispatching — currently being sent"
          accent="#7C3AED"
          count={queueHealth.dispatching.length}
          defaultOpen={queueHealth.dispatching.length > 0}>
          <Table>
            <thead>
              <Th>Lead</Th>
              <Th>Seller</Th>
              <Th>Started</Th>
            </thead>
            <tbody>
              {queueHealth.dispatching.map((r) => (
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

      {/* Failed messages */}
      {(failedVisible.length > 0 || failedHiddenCount > 0) && (
        <CollapsibleSection
          title="Failed messages"
          accent={C.red}
          count={failedVisible.length}
          defaultOpen={failedVisible.length > 0}
          hint={failedHiddenCount > 0 ? `${failedHiddenCount} hidden older than ${NOISE_DAYS}d` : "Needs attention"}>
          {failedHiddenCount > 0 && (
            <div className="px-4 py-2 text-[11px] flex items-center gap-2" style={{ backgroundColor: C.surface, borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>
              <span>Hiding {failedHiddenCount} row(s) older than {NOISE_DAYS}d.</span>
              <HideNoiseToggle showing={showNoise} />
            </div>
          )}
          <Table>
            <thead>
              <Th>When</Th>
              <Th>Lead</Th>
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
                  <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                  <Td>{r.step_number}</Td>
                  <Td>
                    <span className="text-xs" style={{ color: C.red }}>{r.error_details ?? "(no error captured)"}</span>
                  </Td>
                  <Td><RetryButton messageId={r.id} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CollapsibleSection>
      )}

      {/* Stuck (7-21d, still pending) */}
      {queueHealth.stuck.length > 0 && (
        <CollapsibleSection
          title="Stuck — invite sent 7-21d ago, no acceptance yet"
          accent="#D97706"
          count={queueHealth.stuck.length}
          defaultOpen={queueHealth.stuck.length > 0}>
          <Table>
            <thead>
              <Th>Sent</Th>
              <Th>Lead</Th>
              <Th>Company</Th>
              <Th>Seller</Th>
            </thead>
            <tbody>
              {queueHealth.stuck.map((r) => {
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

      {/* Expired (≥21d) */}
      {queueHealth.expired.length > 0 && (
        <CollapsibleSection
          title="Expired — invite ≥21d old, LinkedIn auto-cleared"
          accent={C.textDim}
          count={queueHealth.expired.length}
          hint="History only">
          <Table>
            <thead>
              <Th>Sent</Th>
              <Th>Lead</Th>
              <Th>Company</Th>
              <Th>Seller</Th>
            </thead>
            <tbody>
              {queueHealth.expired.map((r) => {
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

      {/* Skipped */}
      {(skippedVisible.length > 0 || skippedHiddenCount > 0) && (
        <CollapsibleSection
          title="Skipped"
          accent="#6B7280"
          count={skippedVisible.length}
          hint={skippedHiddenCount > 0 ? `${skippedHiddenCount} hidden older than ${NOISE_DAYS}d` : "Won't dispatch"}>
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

      {/* Ghost-sent reconciliation */}
      {sentVsUnipile.rows.length > 0 && (
        <CollapsibleSection
          title={`Sent in last 24h — ${sentVsUnipile.matchedCount}/${sentVsUnipile.rows.length} matched in Unipile`}
          accent={sentVsUnipile.ghostCount > 0 ? C.red : C.green}
          count={sentVsUnipile.rows.length}
          defaultOpen={sentVsUnipile.ghostCount > 0}
          hint={sentVsUnipile.ghostCount > 0 ? `${sentVsUnipile.ghostCount} ghosts` : "All matched"}>
          <Table>
            <thead>
              <Th>Sent at</Th>
              <Th>Lead</Th>
              <Th>Seller</Th>
              <Th>Match</Th>
              <Th>Reason</Th>
            </thead>
            <tbody>
              {sentVsUnipile.rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td>{formatTime(r.sent_at)}</Td>
                  <Td>{leadName(r)}</Td>
                  <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                  <Td>
                    <span className="text-xs font-bold" style={{ color: r._matched ? C.green : C.red }}>
                      {r._matched ? "✓ MATCHED" : "✗ GHOST"}
                    </span>
                  </Td>
                  <Td><span className="text-xs" style={{ color: C.textMuted }}>{r._matchReason}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CollapsibleSection>
      )}

      {/* Seller / Unipile health — now with acceptance rate + rate-limit indicator */}
      <CollapsibleSection title="Seller / Unipile account health" accent={C.gold} hint="Per-seller drill-down">
        <Table>
          <thead>
            <Th>Seller</Th>
            <Th>Unipile</Th>
            <Th>Today (24h)</Th>
            <Th>Acceptance 30d</Th>
            <Th>Status</Th>
          </thead>
          <tbody>
            {sellerHealth.map((s) => {
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
          </tbody>
        </Table>
      </CollapsibleSection>
    </div>
  );
}

function Tile({ label, count, color, icon: Icon, hint }: { label: string; count: number; color: string; icon: any; hint?: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ backgroundColor: C.card, borderColor: C.border }} title={hint}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold truncate" style={{ color: C.textMuted }}>{label}</span>
        <Icon size={12} style={{ color }} />
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{count}</div>
      {hint && <div className="text-[9px] mt-0.5 truncate" style={{ color: C.textDim }}>{hint}</div>}
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub: string; icon: any; color: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>{label}</span>
        <Icon size={14} style={{ color }} />
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: C.textDim }}>{sub}</div>
    </div>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return <table className="w-full text-sm">{children}</table>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: C.textMuted, backgroundColor: C.surface }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5" style={{ color: C.textBody }}>{children}</td>;
}
