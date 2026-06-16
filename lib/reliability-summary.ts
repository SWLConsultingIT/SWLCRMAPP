// /lib/reliability-summary.ts
//
// Per-tenant health snapshot used by /admin/reliability. Aggregates the
// 3 sources of truth (campaign_messages + sellers + Unipile cached) and
// produces a single structured object with:
//   - `paragraph`: human-readable narrative ("Esta semana SWL envió 432
//     invites y 343 emails, todo OK"). Replaces 'ask Claude for status'.
//   - `general`: top-level KPIs (active leads, campaigns, recent reply
//     rate, last activity).
//   - `campaigns`: invites sent / queued / stuck / failed, with the WHY
//     of failures grouped by reason.
//   - `accounts`: per-seller Unipile health + per-mailbox Instantly
//     health (cached via the Unipile helper if available).
//
// Deterministic logic, no LLM calls — the page renders the paragraph
// straight from these numbers so it's fast + cheap + reliable.

import { getSupabaseService } from "@/lib/supabase-service";

const WINDOW_DAYS = 7;
const RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const STUCK_DAYS = 7;

export type TenantSummary = {
  bioId: string;
  bioName: string;
  paragraph: string;
  general: GeneralStats;
  campaigns: CampaignsStats;
  accounts: AccountsStats;
};

type GeneralStats = {
  windowDays: number;
  activeLeads: number;
  activeCampaigns: number;
  totalMessagesSent: number;
  totalReplies: number;
  positiveReplies: number;
  replyRatePct: number; // 0-100
  lastSendAt: string | null;
  health: "healthy" | "warning" | "critical";
};

type CampaignsStats = {
  invitesSent: number;
  invitesAccepted: number;
  invitesPending: number;
  emailsSent: number;
  callsAttempted: number;
  stuckQueued: number; // queued + eligible_at < now() OR no eligible_at AND created_at > STUCK_DAYS
  failed: number;
  failureReasons: Array<{ reason: string; count: number; sample?: string }>;
};

type AccountsStats = {
  sellers: Array<{
    id: string;
    name: string;
    active: boolean;
    unipileAccountId: string | null;
    dailySentLast24h: number;
    dailyLimit: number | null;
    onRateLimitCooldown: boolean;
    cooldownEndsAt: string | null;
  }>;
  instantlyWorkspace: {
    configured: boolean;
    workspaceId: string | null;
    campaignId: string | null;
    label: string | null;
  };
};

// ── Helpers ───────────────────────────────────────────────────────────

function pct(num: number, denom: number): number {
  if (!denom) return 0;
  return Math.round((num / denom) * 1000) / 10; // 1 decimal
}

function groupFailureReasons(rows: Array<{ error_details: string | null }>): Array<{ reason: string; count: number; sample?: string }> {
  const buckets = new Map<string, { count: number; sample: string }>();
  for (const r of rows) {
    const raw = (r.error_details ?? "").trim();
    if (!raw) continue;
    // Normalize: collapse the long, the lower, the short
    const lower = raw.toLowerCase();
    let bucket = "Otro";
    if (lower.includes("rate") || lower.includes("limit") || lower.includes("429")) bucket = "Rate limit (Unipile/Instantly)";
    else if (lower.includes("network") || lower.includes("timeout") || lower.includes("etimedout")) bucket = "Network / timeout";
    else if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("token")) bucket = "Credenciales (token expirado)";
    else if (lower.includes("not found") || lower.includes("404")) bucket = "Recurso no encontrado";
    else if (lower.includes("placeholder") || lower.includes("unsupported")) bucket = "Placeholder no soportado en el body";
    else if (lower.includes("invalid") || lower.includes("bad request") || lower.includes("400")) bucket = "Payload inválido";
    else if (lower.includes("banned") || lower.includes("disabled")) bucket = "Cuenta deshabilitada / baneada";
    else if (lower.includes("no linkedin") || lower.includes("missing url")) bucket = "Lead sin URL de LinkedIn";
    else if (lower.includes("no email") || lower.includes("missing email")) bucket = "Lead sin email";
    else bucket = raw.length > 80 ? raw.slice(0, 80) + "…" : raw;

    const cur = buckets.get(bucket) ?? { count: 0, sample: raw };
    cur.count++;
    if (!cur.sample) cur.sample = raw;
    buckets.set(bucket, cur);
  }
  return Array.from(buckets.entries())
    .map(([reason, v]) => ({ reason, count: v.count, sample: v.sample }))
    .sort((a, b) => b.count - a.count);
}

function buildParagraph(s: TenantSummary): string {
  const { bioName, general, campaigns, accounts } = s;
  const days = general.windowDays;
  const parts: string[] = [];

  // Opener — health verdict
  const verdict = general.health === "healthy"
    ? `funcionó correctamente`
    : general.health === "warning"
      ? `tuvo algunos eventos a revisar`
      : `tuvo errores que requieren atención`;
  parts.push(`En los últimos ${days} días, ${bioName} ${verdict}.`);

  // Volume sentence — what got sent
  const volumeBits: string[] = [];
  if (campaigns.invitesSent > 0) volumeBits.push(`${campaigns.invitesSent} invitaciones de LinkedIn (${campaigns.invitesAccepted} aceptadas, ${campaigns.invitesPending} pendientes)`);
  if (campaigns.emailsSent > 0) volumeBits.push(`${campaigns.emailsSent} emails`);
  if (campaigns.callsAttempted > 0) volumeBits.push(`${campaigns.callsAttempted} llamadas`);
  if (volumeBits.length > 0) {
    parts.push(`Se enviaron ${volumeBits.join(", ")}.`);
  } else {
    parts.push(`No se registraron envíos en la ventana.`);
  }

  // Reply rate sentence — if we sent anything
  if (general.totalMessagesSent > 0) {
    if (general.totalReplies > 0) {
      const positiveText = general.positiveReplies > 0 ? `, ${general.positiveReplies} positivas` : "";
      parts.push(`Volvieron ${general.totalReplies} respuestas${positiveText} (${general.replyRatePct}% reply rate).`);
    } else {
      parts.push(`Todavía no hay respuestas registradas.`);
    }
  }

  // Stuck / failed alerts
  const issues: string[] = [];
  if (campaigns.failed > 0) {
    const topReason = campaigns.failureReasons[0];
    if (topReason) {
      issues.push(`${campaigns.failed} mensajes fallaron${topReason.count >= campaigns.failed * 0.6 ? `, principalmente por ${topReason.reason.toLowerCase()}` : ""}`);
    } else {
      issues.push(`${campaigns.failed} mensajes fallaron`);
    }
  }
  if (campaigns.stuckQueued > 0) {
    issues.push(`${campaigns.stuckQueued} están trabados en cola (queued sin avanzar)`);
  }
  if (issues.length > 0) {
    parts.push(`Atención: ${issues.join("; ")}.`);
  }

  // Sellers status
  const totalSellers = accounts.sellers.length;
  const sellersOnCooldown = accounts.sellers.filter(s => s.onRateLimitCooldown).length;
  if (totalSellers > 0) {
    if (sellersOnCooldown === 0) {
      parts.push(`Los ${totalSellers} seller${totalSellers === 1 ? "" : "s"} están operativos.`);
    } else {
      parts.push(`${sellersOnCooldown} de ${totalSellers} seller${totalSellers === 1 ? "" : "s"} en cooldown de rate-limit; reanudan automático en pocas horas.`);
    }
  }

  return parts.join(" ");
}

function classifyHealth(c: CampaignsStats, g: Omit<GeneralStats, "health">): "healthy" | "warning" | "critical" {
  // Critical: lots of failures OR everything stuck
  if (c.failed >= 20 || (c.stuckQueued >= 50 && g.totalMessagesSent === 0)) return "critical";
  // Warning: some failures or stuck OR no activity at all in 7d when there are active campaigns
  if (c.failed > 0 || c.stuckQueued > 10) return "warning";
  if (g.activeCampaigns > 0 && g.totalMessagesSent === 0) return "warning";
  return "healthy";
}

// ── Main aggregator ───────────────────────────────────────────────────

export async function getTenantSummary(bioId: string, bioName: string): Promise<TenantSummary> {
  const svc = getSupabaseService();
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const stuckBefore = new Date(Date.now() - STUCK_DAYS * 86400000).toISOString();
  const cooldownThreshold = new Date(Date.now() - RATE_LIMIT_COOLDOWN_MS).toISOString();

  // ── Run all queries in parallel ────────────────────────────────────
  const [
    activeLeadsRes,
    activeCampaignsRes,
    sentMessagesRes,
    failedMessagesRes,
    queuedMessagesRes,
    repliesRes,
    sellersRes,
    bioRes,
  ] = await Promise.all([
    svc.from("leads").select("id", { count: "exact", head: true }).eq("company_bio_id", bioId).not("status", "in", "(closed_won,closed_lost,qualified)"),
    svc.from("campaigns").select("id, lead_id, leads!inner(company_bio_id)", { count: "exact", head: true }).eq("status", "active").eq("leads.company_bio_id", bioId),
    svc.from("campaign_messages").select("id, channel, step_number, sent_at, leads!inner(company_bio_id, linkedin_connected)").eq("status", "sent").gte("sent_at", since).eq("leads.company_bio_id", bioId).limit(2000),
    svc.from("campaign_messages").select("id, channel, error_details, created_at, leads!inner(company_bio_id)").eq("status", "failed").gte("created_at", since).eq("leads.company_bio_id", bioId).limit(500),
    svc.from("campaign_messages").select("id, channel, created_at, metadata, leads!inner(company_bio_id)").eq("status", "queued").eq("leads.company_bio_id", bioId).limit(1000),
    svc.from("lead_replies").select("id, classification, received_at, leads!inner(company_bio_id)").gte("received_at", since).eq("leads.company_bio_id", bioId).limit(1000),
    svc.from("sellers").select("id, name, active, unipile_account_id, linkedin_daily_limit, company_bio_id").eq("company_bio_id", bioId),
    svc.from("company_bios").select("instantly_campaign_id, instantly_workspace_id").eq("id", bioId).maybeSingle(),
  ]);

  // ── Crunch counts ──────────────────────────────────────────────────
  // Supabase types `!inner` joins as arrays by default; we coerce to
  // the single-object shape we actually want by going through unknown.
  const sentMsgs = ((sentMessagesRes.data ?? []) as unknown) as Array<{ channel: string | null; step_number: number | null; sent_at: string | null; leads: { linkedin_connected: boolean | null } | null }>;
  const failedMsgs = ((failedMessagesRes.data ?? []) as unknown) as Array<{ channel: string | null; error_details: string | null; created_at: string | null }>;
  const queuedMsgs = ((queuedMessagesRes.data ?? []) as unknown) as Array<{ id: string; channel: string | null; created_at: string | null; metadata: Record<string, unknown> | null }>;
  const replies = ((repliesRes.data ?? []) as unknown) as Array<{ classification: string | null; received_at: string | null }>;
  const sellers = (sellersRes.data ?? []) as Array<{ id: string; name: string; active: boolean; unipile_account_id: string | null; linkedin_daily_limit: number | null }>;
  const bio = (bioRes.data ?? null) as { instantly_campaign_id: string | null; instantly_workspace_id: string | null } | null;

  // Invites (LinkedIn step_number=0 = the invite itself; step_number>=1 = DMs after accept)
  const invitesSent = sentMsgs.filter(m => m.channel === "linkedin" && m.step_number === 0).length;
  const invitesAccepted = sentMsgs.filter(m => m.channel === "linkedin" && m.step_number === 0 && m.leads?.linkedin_connected).length;
  const invitesPending = invitesSent - invitesAccepted;
  const emailsSent = sentMsgs.filter(m => m.channel === "email").length;
  const callsAttempted = sentMsgs.filter(m => m.channel === "call").length;
  const linkedinDMs = sentMsgs.filter(m => m.channel === "linkedin" && (m.step_number ?? 0) > 0).length;

  // Stuck queued = either eligible_at is past OR no eligible_at AND created_at is older than STUCK_DAYS.
  const nowMs = Date.now();
  const stuckQueued = queuedMsgs.filter(m => {
    const eligibleAt = (m.metadata?.eligible_at as string | undefined) ?? null;
    if (eligibleAt) {
      const t = Date.parse(eligibleAt);
      return !isNaN(t) && t < nowMs - 60_000;
    }
    return m.created_at !== null && m.created_at < stuckBefore;
  }).length;

  // Replies
  const totalReplies = replies.length;
  const positiveReplies = replies.filter(r => r.classification === "positive").length;
  const totalMessagesSent = invitesSent + linkedinDMs + emailsSent + callsAttempted;
  const replyRatePct = pct(totalReplies, totalMessagesSent);

  // Failure grouping
  const failureReasons = groupFailureReasons(failedMsgs);

  // Last activity timestamp
  const lastSendAt = sentMsgs
    .map(m => m.sent_at)
    .filter((x): x is string => !!x)
    .sort()
    .pop() ?? null;

  // Sellers + cooldown check
  // A seller is "on cooldown" when any of their queued messages have a
  // last_rate_limit_at metadata stamp within the last RATE_LIMIT_COOLDOWN_MS.
  const cooldownSellerIds = new Set<string>();
  // The queue rows don't include seller_id directly; do a quick second fetch
  // for queued rows that have a cooldown stamp.
  const { data: cooldownRows } = await svc
    .from("campaign_messages")
    .select("id, metadata, campaigns!inner(seller_id, leads!inner(company_bio_id))")
    .eq("status", "queued")
    .eq("campaigns.leads.company_bio_id", bioId)
    .not("metadata->last_rate_limit_at", "is", null)
    .gte("metadata->>last_rate_limit_at", cooldownThreshold)
    .limit(500);
  for (const r of ((cooldownRows ?? []) as unknown) as Array<{ campaigns: { seller_id: string | null } | null }>) {
    const sid = r.campaigns?.seller_id;
    if (sid) cooldownSellerIds.add(sid);
  }

  // Per-seller sent-last-24h
  const sellerDailyMap = new Map<string, number>();
  if (sellers.length > 0) {
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const { data: sentBySeller } = await svc
      .from("campaign_messages")
      .select("id, campaigns!inner(seller_id, leads!inner(company_bio_id))")
      .eq("status", "sent")
      .gte("sent_at", since24h)
      .eq("campaigns.leads.company_bio_id", bioId)
      .limit(5000);
    for (const r of ((sentBySeller ?? []) as unknown) as Array<{ campaigns: { seller_id: string | null } | null }>) {
      const sid = r.campaigns?.seller_id;
      if (sid) sellerDailyMap.set(sid, (sellerDailyMap.get(sid) ?? 0) + 1);
    }
  }

  const general: Omit<GeneralStats, "health"> = {
    windowDays: WINDOW_DAYS,
    activeLeads: activeLeadsRes.count ?? 0,
    activeCampaigns: activeCampaignsRes.count ?? 0,
    totalMessagesSent,
    totalReplies,
    positiveReplies,
    replyRatePct,
    lastSendAt,
  };

  const campaignsStats: CampaignsStats = {
    invitesSent,
    invitesAccepted,
    invitesPending,
    emailsSent,
    callsAttempted,
    stuckQueued,
    failed: failedMsgs.length,
    failureReasons,
  };

  const health = classifyHealth(campaignsStats, general);
  const generalWithHealth: GeneralStats = { ...general, health };

  const accountsStats: AccountsStats = {
    sellers: sellers.map(s => ({
      id: s.id,
      name: s.name,
      active: s.active,
      unipileAccountId: s.unipile_account_id,
      dailySentLast24h: sellerDailyMap.get(s.id) ?? 0,
      dailyLimit: s.linkedin_daily_limit,
      onRateLimitCooldown: cooldownSellerIds.has(s.id),
      cooldownEndsAt: null, // could be derived from latest last_rate_limit_at + 4h
    })),
    instantlyWorkspace: {
      configured: !!(bio?.instantly_campaign_id),
      workspaceId: bio?.instantly_workspace_id ?? null,
      campaignId: bio?.instantly_campaign_id ?? null,
      label: bio?.instantly_workspace_id ? `Instantly workspace ${bio.instantly_workspace_id.slice(0, 8)}` : null,
    },
  };

  const partial: TenantSummary = {
    bioId,
    bioName,
    paragraph: "",
    general: generalWithHealth,
    campaigns: campaignsStats,
    accounts: accountsStats,
  };
  partial.paragraph = buildParagraph(partial);
  return partial;
}

// Pull every tenant (company_bios) summary in parallel for the page.
export async function getAllTenantSummaries(): Promise<TenantSummary[]> {
  const svc = getSupabaseService();
  const { data: bios } = await svc
    .from("company_bios")
    .select("id, company_name")
    .order("company_name", { ascending: true });
  const list = (bios ?? []) as Array<{ id: string; company_name: string | null }>;
  return await Promise.all(list.map(b => getTenantSummary(b.id, b.company_name ?? "Unnamed tenant")));
}
