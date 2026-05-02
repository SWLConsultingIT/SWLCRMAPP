import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { redirect } from "next/navigation";
import Breadcrumb from "@/components/Breadcrumb";
import { C } from "@/lib/design";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Send, Zap } from "lucide-react";
import ReliabilityActions from "./ReliabilityActions";
import RetryButton from "./RetryButton";

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
  leads: {
    primary_first_name: string | null;
    primary_last_name: string | null;
    primary_linkedin_url: string | null;
    company_name: string | null;
    company_bio_id: string | null;
    linkedin_connected: boolean | null;
    primary_company_bios?: { company_name: string | null } | null;
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

type ReliabilityData = {
  queueHealth: {
    skipped: CampaignMessageRow[];
    stuck: CampaignMessageRow[];
    queued: CampaignMessageRow[];
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
  }>;
  fetchedAt: string;
};

async function fetchReliability(): Promise<ReliabilityData> {
  const svc = getSupabaseService();

  const queueSelect = "id, campaign_id, lead_id, step_number, channel, status, sent_at, provider_message_id, error_details, created_at, leads(primary_first_name, primary_last_name, primary_linkedin_url, company_name, company_bio_id, linkedin_connected), campaigns(name, seller_id, sellers(name, unipile_account_id))";

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Stuck cutoff: step 0 sent ≥7 days ago + lead never connected + step 1 still draft.
  // These campaigns are technically "active" but functionally dead — the lead
  // ignored the invite. Without surfacing them they accumulate silently.
  const STUCK_DAYS = 7;
  const stuckCutoff = new Date(Date.now() - STUCK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [queuedQ, dispatchingQ, failedQ, skippedQ, sentLedgerQ, sellersQ, stuckQ] = await Promise.all([
    svc.from("campaign_messages").select(queueSelect).eq("status", "queued").order("created_at", { ascending: true }),
    svc.from("campaign_messages").select(queueSelect).eq("status", "dispatching").order("created_at", { ascending: true }),
    svc.from("campaign_messages").select(queueSelect).eq("status", "failed").order("created_at", { ascending: false }).limit(50),
    // Skipped rows from skipAlreadyConnected / markAlreadyInvited / retroactive
    // fixes — they're not failures but they need visibility (esp. the
    // "awaiting acceptance" ones that depend on the lead).
    svc.from("campaign_messages").select(queueSelect).eq("status", "skipped").order("created_at", { ascending: false }).limit(50),
    svc.from("campaign_messages").select(queueSelect).eq("status", "sent").eq("step_number", 0).gte("sent_at", since24h).order("sent_at", { ascending: false }),
    svc.from("sellers").select("id, name, unipile_account_id, active, linkedin_daily_limit").eq("active", true),
    // Stuck campaigns: step 0 sent ≥7d ago, lead never connected.
    svc.from("campaign_messages").select(queueSelect)
      .eq("status", "sent").eq("step_number", 0).eq("channel", "linkedin")
      .lt("sent_at", stuckCutoff)
      .order("sent_at", { ascending: true }),
  ]);

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

  // Reconcile: each "sent" step-0 row in DB → does Unipile have a matching invite?
  // We match by either provider_message_id (if recorded) OR by the LinkedIn slug.
  const ledger = (sentLedgerQ.data ?? []) as CampaignMessageRow[];
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

  // Per-seller daily count: sent in last 24h. Mirrors the guard in
  // /api/cron/dispatch-queue so the dashboard shows the same numbers
  // the dispatcher uses to decide eligibility.
  const dailyCount = new Map<string, number>();
  for (const r of sentLedgerQ.data ?? []) {
    const sid = (r as any)?.campaigns?.seller_id as string | undefined;
    if (sid) dailyCount.set(sid, (dailyCount.get(sid) ?? 0) + 1);
  }

  const sellerHealth = (sellersQ.data ?? []).map((s: any) => ({
    sellerId: s.id,
    sellerName: s.name ?? "(unnamed)",
    unipileAccountId: s.unipile_account_id ?? null,
    unipileError: sellerErrors.get(s.id) ?? null,
    invitesInUnipile: unipileBySeller.get(s.id)?.length ?? 0,
    dailySent: dailyCount.get(s.id) ?? 0,
    dailyLimit: (s.linkedin_daily_limit as number | null) ?? 20,
  }));

  // Stuck = sent step-0 LinkedIn invite ≥7d ago AND lead never connected.
  // Surface these explicitly — without it they sit in 'active' campaigns
  // forever, invisible. (The user reported this gap with Pathway: 6 invites
  // sent, 0 acceptances, no surface anywhere.)
  const stuckRows = ((stuckQ.data ?? []) as unknown as CampaignMessageRow[]).filter(
    (r) => r.leads?.linkedin_connected !== true,
  );

  return {
    queueHealth: {
      queued: (queuedQ.data ?? []) as unknown as CampaignMessageRow[],
      dispatching: (dispatchingQ.data ?? []) as unknown as CampaignMessageRow[],
      failed: (failedQ.data ?? []) as unknown as CampaignMessageRow[],
      skipped: (skippedQ.data ?? []) as unknown as CampaignMessageRow[],
      stuck: stuckRows,
    },
    sentVsUnipile: { rows: reconciled, ghostCount, matchedCount },
    sellerHealth,
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

export default async function ReliabilityPage() {
  const scope = await getUserScope();
  if (scope.role !== "admin") redirect("/");

  const data = await fetchReliability();
  const { queueHealth, sentVsUnipile, sellerHealth, fetchedAt } = data;

  const totalAttention = queueHealth.queued.length + queueHealth.dispatching.length + queueHealth.failed.length + queueHealth.stuck.length + sentVsUnipile.ghostCount;

  return (
    <div className="p-6 w-full max-w-6xl mx-auto">
      <Breadcrumb crumbs={[{ label: "Admin", href: "/admin" }, { label: "Reliability" }]} />

      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: C.textPrimary }}>Reliability</h1>
          <p className="text-sm" style={{ color: C.textMuted }}>
            DB ↔ Unipile reconciliation. Refreshed {formatTime(fetchedAt)}.
          </p>
        </div>
        <ReliabilityActions />
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Tile label="Queued" count={queueHealth.queued.length} color={C.blue} icon={Clock} />
        <Tile label="Dispatching" count={queueHealth.dispatching.length} color="#7C3AED" icon={Send} />
        <Tile label="Failed" count={queueHealth.failed.length} color={C.red} icon={AlertTriangle} />
        <Tile label="Skipped" count={queueHealth.skipped.length} color="#6B7280" icon={CheckCircle2} />
        <Tile label="Stuck (≥7d)" count={queueHealth.stuck.length} color={queueHealth.stuck.length > 0 ? "#D97706" : C.green} icon={queueHealth.stuck.length > 0 ? AlertTriangle : CheckCircle2} />
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

      {/* Stuck campaigns — sent step-0 invite ≥7d ago, lead never connected */}
      {queueHealth.stuck.length > 0 && (
        <Section title={`Stuck campaigns — invite sent ≥7d ago, no acceptance (${queueHealth.stuck.length})`} accent="#D97706">
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
        </Section>
      )}

      {/* Skipped — preflight skip + retroactive fixes */}
      {queueHealth.skipped.length > 0 && (
        <Section title={`Skipped (${queueHealth.skipped.length})`} accent="#6B7280">
          <Table>
            <thead>
              <Th>Lead</Th>
              <Th>Step</Th>
              <Th>Channel</Th>
              <Th>Created</Th>
            </thead>
            <tbody>
              {queueHealth.skipped.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td>{leadName(r)}</Td>
                  <Td>{r.step_number}</Td>
                  <Td>{r.channel}</Td>
                  <Td>{formatTime(r.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      {/* Failed */}
      {queueHealth.failed.length > 0 && (
        <Section title={`Failed messages (${queueHealth.failed.length})`} accent={C.red}>
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
              {queueHealth.failed.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td>{formatTime(r.created_at)}</Td>
                  <Td>{leadName(r)}</Td>
                  <Td>{r.campaigns?.sellers?.name ?? "—"}</Td>
                  <Td>{r.step_number}</Td>
                  <Td>
                    <span className="text-xs" style={{ color: C.red }}>
                      {r.error_details ?? "(no error captured)"}
                    </span>
                  </Td>
                  <Td><RetryButton messageId={r.id} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      {/* Queued */}
      {queueHealth.queued.length > 0 && (
        <Section title={`Queued — waiting for cron dispatcher (${queueHealth.queued.length})`} accent={C.blue}>
          <Table>
            <thead>
              <Th>Created</Th>
              <Th>Lead</Th>
              <Th>Seller</Th>
              <Th>Step</Th>
              <Th>Channel</Th>
            </thead>
            <tbody>
              {queueHealth.queued.map((r) => (
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
        </Section>
      )}

      {/* Dispatching */}
      {queueHealth.dispatching.length > 0 && (
        <Section title={`Dispatching — currently being sent (${queueHealth.dispatching.length})`} accent="#7C3AED">
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
        </Section>
      )}

      {/* Ghost-sent */}
      {sentVsUnipile.rows.length > 0 && (
        <Section
          title={`Sent in last 24h: ${sentVsUnipile.matchedCount}/${sentVsUnipile.rows.length} matched in Unipile`}
          accent={sentVsUnipile.ghostCount > 0 ? C.red : C.green}>
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
                    <span className="text-xs font-bold"
                      style={{ color: r._matched ? C.green : C.red }}>
                      {r._matched ? "✓ MATCHED" : "✗ GHOST"}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs" style={{ color: C.textMuted }}>{r._matchReason}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      {/* Seller health */}
      <Section title="Seller / Unipile account health" accent={C.gold}>
        <Table>
          <thead>
            <Th>Seller</Th>
            <Th>Unipile account</Th>
            <Th>Status</Th>
            <Th>Today (24h)</Th>
            <Th>Invites in Unipile</Th>
          </thead>
          <tbody>
            {sellerHealth.map((s) => {
              const pct = s.dailyLimit > 0 ? Math.min(100, Math.round((s.dailySent / s.dailyLimit) * 100)) : 0;
              const atCap = s.dailySent >= s.dailyLimit;
              const dailyColor = atCap ? C.red : pct >= 80 ? "#D97706" : C.linkedin;
              return (
                <tr key={s.sellerId} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td>{s.sellerName}</Td>
                  <Td>
                    <span className="text-xs font-mono" style={{ color: C.textMuted }}>
                      {s.unipileAccountId ?? "(none)"}
                    </span>
                  </Td>
                  <Td>
                    {s.unipileError ? (
                      <span className="text-xs" style={{ color: C.red }}>{s.unipileError}</span>
                    ) : s.unipileAccountId ? (
                      <span className="text-xs font-bold" style={{ color: C.green }}>OK</span>
                    ) : (
                      <span className="text-xs" style={{ color: C.textMuted }}>not connected</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <span className="text-xs tabular-nums font-semibold" style={{ color: dailyColor }}>
                        {s.dailySent}/{s.dailyLimit}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: dailyColor }} />
                      </div>
                      {atCap && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: C.redLight, color: C.red }}>
                          AT CAP
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>{s.invitesInUnipile}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Section>
    </div>
  );
}

function Tile({ label, count, color, icon: Icon }: { label: string; count: number; color: string; icon: any }) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>{label}</span>
        <Icon size={14} style={{ color }} />
      </div>
      <div className="text-2xl font-bold tabular" style={{ color }}>{count}</div>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: C.border }}>
        <Zap size={12} style={{ color: accent }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: accent }}>{title}</span>
      </div>
      <div>{children}</div>
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
