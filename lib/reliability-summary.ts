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
  stuckBreakdown: Array<{
    reason: string;
    count: number;
    samples: Array<{ campaignName: string; leadName: string; channel: string; stepNumber: number; ageDays: number; messageId: string; campaignId: string }>;
  }>;
  failed: number;
  failureReasons: Array<{ reason: string; count: number; sample?: string }>;
};

export type CampaignSummary = {
  campaignId: string;
  campaignName: string;
  status: string;
  channels: string[];
  totalSteps: number;
  totalLeads: number;
  messagesSent: number;
  messagesQueued: number;
  messagesStuck: number;
  messagesFailed: number;
  replies: number;
  positiveReplies: number;
  lastActivityAt: string | null;
  health: "healthy" | "warning" | "critical";
  // Per-card stuck breakdown — Fran wants the "where are they stuck?"
  // detail rendered INSIDE each flow card, not in a global block above.
  stuckBuckets: Array<{
    reason: string; // i18n key (e.g. "rel.stuck.reason.cooldown")
    count: number;
    samples: Array<{ leadName: string; channel: string; stepNumber: number; ageDays: number }>;
  }>;
};

export type CampaignDetail = CampaignSummary & {
  bioId: string;
  bioName: string;
  stuckBreakdown: Array<{
    reason: string;
    count: number;
    samples: Array<{ leadName: string; channel: string; stepNumber: number; ageDays: number; messageId: string }>;
  }>;
  failureReasons: Array<{ reason: string; count: number; sample?: string }>;
  steps: Array<{
    stepNumber: number;
    channel: string;
    sent: number;
    queued: number;
    stuck: number;
    failed: number;
    draft: number;
  }>;
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
    svc.from("campaign_messages").select("id, channel, step_number, created_at, metadata, lead_id, campaign_id, leads!inner(company_bio_id, primary_first_name, primary_last_name, company_name, linkedin_connected, status), campaigns(name, seller_id, sellers(name))").eq("status", "queued").eq("leads.company_bio_id", bioId).limit(2000),
    svc.from("lead_replies").select("id, classification, received_at, leads!inner(company_bio_id)").gte("received_at", since).eq("leads.company_bio_id", bioId).limit(1000),
    // Sellers for this tenant — owned (`company_bio_id = bioId`) OR
    // shared into this tenant (`shared_with_company_bio_ids ⊇ {bioId}`).
    // Split into 2 separate queries because the compound `.or()` with
    // `cs.{uuid-with-dashes}` was silently returning a subset on this
    // dataset (Arqy showed only Sara, but /accounts — which uses the
    // same OR — showed all). Running them apart + Set-deduping is
    // bulletproof and yields the same row set as /accounts.
    Promise.all([
      svc.from("sellers")
        .select("id, name, unipile_account_id, linkedin_daily_limit, active, company_bio_id")
        .eq("active", true)
        .eq("company_bio_id", bioId)
        .order("name"),
      svc.from("sellers")
        .select("id, name, unipile_account_id, linkedin_daily_limit, active, company_bio_id, shared_with_company_bio_ids")
        .eq("active", true)
        .contains("shared_with_company_bio_ids", [bioId])
        .order("name"),
    ]).then(([ownedRes, sharedRes]) => {
      const all: Array<{ id: string; name: string; active: boolean; unipile_account_id: string | null; linkedin_daily_limit: number | null }> = [];
      const seen = new Set<string>();
      for (const list of [ownedRes.data ?? [], sharedRes.data ?? []]) {
        for (const s of list as Array<{ id: string; name: string; active: boolean; unipile_account_id: string | null; linkedin_daily_limit: number | null }>) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          all.push(s);
        }
      }
      all.sort((a, b) => a.name.localeCompare(b.name));
      return { data: all, error: null };
    }),
    svc.from("company_bios").select("instantly_campaign_id, instantly_workspace_id").eq("id", bioId).maybeSingle(),
  ]);

  // ── Crunch counts ──────────────────────────────────────────────────
  // Supabase types `!inner` joins as arrays by default; we coerce to
  // the single-object shape we actually want by going through unknown.
  const sentMsgs = ((sentMessagesRes.data ?? []) as unknown) as Array<{ channel: string | null; step_number: number | null; sent_at: string | null; leads: { linkedin_connected: boolean | null } | null }>;
  const failedMsgs = ((failedMessagesRes.data ?? []) as unknown) as Array<{ channel: string | null; error_details: string | null; created_at: string | null }>;
  const queuedMsgs = ((queuedMessagesRes.data ?? []) as unknown) as Array<{
    id: string;
    channel: string | null;
    step_number: number | null;
    created_at: string | null;
    metadata: Record<string, unknown> | null;
    lead_id: string | null;
    campaign_id: string | null;
    leads: { primary_first_name: string | null; primary_last_name: string | null; company_name: string | null; linkedin_connected: boolean | null; status: string | null } | null;
    campaigns: { name: string | null; seller_id: string | null; sellers: { name: string | null } | null } | null;
  }>;
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

  // Stuck queued = either eligible_at is past OR no eligible_at AND
  // created_at is older than STUCK_DAYS. We also classify the LIKELY
  // REASON each stuck row is stuck for so the operator can see WHY,
  // not just a count.
  const nowMs = Date.now();
  const sellerOnCooldownIds = new Set<string>(); // populated below from cooldownRows
  const stuckRows = queuedMsgs.filter(m => {
    const eligibleAt = (m.metadata?.eligible_at as string | undefined) ?? null;
    if (eligibleAt) {
      const t = Date.parse(eligibleAt);
      return !isNaN(t) && t < nowMs - 60_000;
    }
    return m.created_at !== null && m.created_at < stuckBefore;
  });
  const stuckQueued = stuckRows.length;

  // Returns an i18n key — the UI translates it via t(). Lets the
  // Reliability page render in EN or ES without us having to fork
  // strings in the data layer.
  function classifyStuckReason(m: typeof queuedMsgs[number]): string {
    const channel = (m.channel ?? "linkedin").toLowerCase();
    const step = m.step_number ?? 0;
    const leadStatus = m.leads?.status ?? null;
    const linkedinConnected = m.leads?.linkedin_connected === true;
    const meta = m.metadata ?? {};
    const lastRateLimit = (meta.last_rate_limit_at as string | undefined) ?? null;
    const sellerId = m.campaigns?.seller_id ?? null;
    if (lastRateLimit) {
      const t = Date.parse(lastRateLimit);
      if (!isNaN(t) && t > nowMs - RATE_LIMIT_COOLDOWN_MS) return "rel.stuck.reason.cooldown";
    }
    if (sellerId && sellerOnCooldownIds.has(sellerId)) return "rel.stuck.reason.cooldown";
    if (leadStatus && ["closed_won", "closed_lost", "qualified"].includes(leadStatus)) return "rel.stuck.reason.terminal";
    if (channel === "linkedin" && step > 0 && !linkedinConnected) return "rel.stuck.reason.notAccepted";
    if (channel === "call") return "rel.stuck.reason.manualCall";
    if (!m.campaigns?.seller_id) return "rel.stuck.reason.noSeller";
    return "rel.stuck.reason.cronLag";
  }

  function buildStuckBreakdown(): CampaignsStats["stuckBreakdown"] {
    const buckets = new Map<string, CampaignsStats["stuckBreakdown"][number]>();
    for (const m of stuckRows) {
      const reason = classifyStuckReason(m);
      const cur = buckets.get(reason) ?? { reason, count: 0, samples: [] };
      cur.count++;
      if (cur.samples.length < 3) {
        const first = m.leads?.primary_first_name ?? "";
        const last = m.leads?.primary_last_name ?? "";
        const leadName = (first + " " + last).trim() || (m.leads?.company_name ?? "(lead sin nombre)");
        const created = m.created_at ? Date.parse(m.created_at) : nowMs;
        const ageDays = Math.max(0, Math.round((nowMs - created) / 86400000));
        cur.samples.push({
          campaignName: m.campaigns?.name ?? "(sin nombre)",
          leadName,
          channel: m.channel ?? "?",
          stepNumber: m.step_number ?? 0,
          ageDays,
          messageId: m.id,
          campaignId: m.campaign_id ?? "",
        });
      }
      buckets.set(reason, cur);
    }
    return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  }

  // Cooldown sellers query — runs BEFORE the stuck breakdown so the
  // classifier knows which sellers are currently rate-limited.
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
    if (sid) sellerOnCooldownIds.add(sid);
  }
  const cooldownSellerIds = sellerOnCooldownIds; // alias for the accounts section below

  // Now we can build the stuck breakdown (uses sellerOnCooldownIds).
  const stuckBreakdown = buildStuckBreakdown();

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
    stuckBreakdown,
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

// ── Per-campaign data ─────────────────────────────────────────────────

function campaignHealth(s: CampaignSummary): "healthy" | "warning" | "critical" {
  if (s.messagesFailed >= 10 || (s.messagesStuck >= 50 && s.messagesSent === 0)) return "critical";
  if (s.messagesFailed > 0 || s.messagesStuck > 10) return "warning";
  return "healthy";
}

// List every campaign of a tenant with high-level stats. Used by the
// per-tenant CampaignsListSection so the operator can drill down to a
// specific campaign that's misbehaving.
export async function getTenantCampaigns(bioId: string): Promise<CampaignSummary[]> {
  const svc = getSupabaseService();
  const nowMs = Date.now();
  const cooldownThreshold = new Date(nowMs - RATE_LIMIT_COOLDOWN_MS).toISOString();

  // Active flows only — Fran's definition of a "flow" is what appears in
  // /campaigns under Outreach Flow (status='active'). Mirror the exact
  // query from getTenantSummary line 247 that we know returns the right
  // count (used by the activeCampaigns badge), instead of the 2-step
  // approach that was returning 0 rows.
  // NOTE: column is `sequence_steps` (jsonb array), NOT `sequence_length`.
  // The earlier code asked for sequence_length, got a 400 from PostgREST,
  // received {data: null} and rendered "No flows in this tenant yet"
  // even though activeCampaigns count returned 201. Compute step total
  // from sequence_steps.length below.
  const { data: campaignsRaw, error: campaignsErr } = await svc
    .from("campaigns")
    .select("id, name, status, sequence_steps, lead_id, seller_id, last_step_at, created_at, leads!inner(company_bio_id)")
    .eq("status", "active")
    .eq("leads.company_bio_id", bioId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (campaignsErr) {
    console.error("[reliability] getTenantCampaigns query failed", campaignsErr);
    return [];
  }

  const campaigns = ((campaignsRaw ?? []) as unknown) as Array<{
    id: string; name: string | null; status: string | null; sequence_steps: unknown;
    lead_id: string | null; seller_id: string | null; last_step_at: string | null; created_at: string | null;
  }>;
  if (campaigns.length === 0) return [];

  const campaignIds = campaigns.map(c => c.id);

  // Sellers on cooldown — used to classify stuck rows that are sitting
  // because the seller hit a rate-limit recently.
  const { data: cooldownRaw } = await svc
    .from("sellers")
    .select("id, name")
    .gte("last_rate_limit_at", cooldownThreshold);
  const sellerOnCooldownIds = new Set(((cooldownRaw ?? []) as Array<{ id: string }>).map(r => r.id));

  // Messages for those campaigns, joined to leads (status / linkedin_connected)
  // so we can classify WHY each queued row is stuck, with the same logic
  // as the global breakdown — but scoped per-campaign so each card carries
  // its own buckets.
  const { data: msgsRaw } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, status, channel, step_number, sent_at, created_at, metadata, lead_id, leads(primary_first_name, primary_last_name, company_name, linkedin_connected, status)")
    .in("campaign_id", campaignIds)
    .limit(50000);
  const msgs = ((msgsRaw ?? []) as unknown) as Array<{
    id: string; campaign_id: string; status: string | null; channel: string | null; step_number: number | null;
    sent_at: string | null; created_at: string | null; metadata: Record<string, unknown> | null; lead_id: string | null;
    leads: { primary_first_name: string | null; primary_last_name: string | null; company_name: string | null; linkedin_connected: boolean | null; status: string | null } | null;
  }>;

  // Replies by lead_id.
  const campaignLeadIds = Array.from(new Set(campaigns.map(c => c.lead_id).filter((x): x is string => !!x)));
  const repliesByLeadMap = new Map<string, { total: number; positive: number }>();
  if (campaignLeadIds.length > 0) {
    const { data: repliesRaw } = await svc
      .from("lead_replies")
      .select("lead_id, classification")
      .in("lead_id", campaignLeadIds)
      .limit(5000);
    for (const r of (repliesRaw ?? []) as Array<{ lead_id: string | null; classification: string | null }>) {
      if (!r.lead_id) continue;
      const cur = repliesByLeadMap.get(r.lead_id) ?? { total: 0, positive: 0 };
      cur.total++;
      if (r.classification === "positive") cur.positive++;
      repliesByLeadMap.set(r.lead_id, cur);
    }
  }

  // Classify a single stuck (queued + eligible_at past or aged out) row.
  // Mirrors the global classifyStuckReason in getTenantSummary so the
  // per-card and the (now-gone) global block would tell the same story.
  function classifyStuckReason(m: typeof msgs[number], sellerId: string | null): string {
    const channel = (m.channel ?? "linkedin").toLowerCase();
    const step = m.step_number ?? 0;
    const leadStatus = m.leads?.status ?? null;
    const linkedinConnected = m.leads?.linkedin_connected === true;
    const meta = m.metadata ?? {};
    const lastRateLimit = (meta.last_rate_limit_at as string | undefined) ?? null;
    if (lastRateLimit) {
      const t = Date.parse(lastRateLimit);
      if (!isNaN(t) && t > nowMs - RATE_LIMIT_COOLDOWN_MS) return "rel.stuck.reason.cooldown";
    }
    if (sellerId && sellerOnCooldownIds.has(sellerId)) return "rel.stuck.reason.cooldown";
    if (leadStatus && ["closed_won", "closed_lost", "qualified"].includes(leadStatus)) return "rel.stuck.reason.terminal";
    if (channel === "linkedin" && step > 0 && !linkedinConnected) return "rel.stuck.reason.notAccepted";
    if (channel === "call") return "rel.stuck.reason.manualCall";
    if (!sellerId) return "rel.stuck.reason.noSeller";
    return "rel.stuck.reason.cronLag";
  }

  const stuckBefore = new Date(nowMs - STUCK_DAYS * 86400000).toISOString();

  const summaries: CampaignSummary[] = campaigns.map(c => {
    const cm = msgs.filter(m => m.campaign_id === c.id);
    const channels = new Set<string>();
    let sent = 0, queued = 0, failed = 0;
    let lastActivityAt: string | null = c.last_step_at ?? null;
    const stuckRows: typeof msgs = [];
    for (const m of cm) {
      const s = m.status ?? "";
      if (m.channel) channels.add(m.channel);
      if (s === "sent") {
        sent++;
        if (m.sent_at && (!lastActivityAt || m.sent_at > lastActivityAt)) lastActivityAt = m.sent_at;
      } else if (s === "queued") {
        queued++;
        const eligibleAt = (m.metadata?.eligible_at as string | undefined) ?? null;
        let isStuck = false;
        if (eligibleAt) {
          const t = Date.parse(eligibleAt);
          if (!isNaN(t) && t < nowMs - 60_000) isStuck = true;
        } else if (m.created_at && m.created_at < stuckBefore) {
          isStuck = true;
        }
        if (isStuck) stuckRows.push(m);
      } else if (s === "failed") {
        failed++;
      }
    }

    // Build per-card stuck buckets.
    const buckets = new Map<string, CampaignSummary["stuckBuckets"][number]>();
    for (const m of stuckRows) {
      const reason = classifyStuckReason(m, c.seller_id ?? null);
      const cur = buckets.get(reason) ?? { reason, count: 0, samples: [] };
      cur.count++;
      if (cur.samples.length < 2) {
        const first = m.leads?.primary_first_name ?? "";
        const last = m.leads?.primary_last_name ?? "";
        const leadName = (first + " " + last).trim() || (m.leads?.company_name ?? "(lead sin nombre)");
        const created = m.created_at ? Date.parse(m.created_at) : nowMs;
        const ageDays = Math.max(0, Math.round((nowMs - created) / 86400000));
        cur.samples.push({ leadName, channel: m.channel ?? "?", stepNumber: m.step_number ?? 0, ageDays });
      }
      buckets.set(reason, cur);
    }
    const stuckBuckets = Array.from(buckets.values()).sort((a, b) => b.count - a.count);

    const repliesData = c.lead_id ? repliesByLeadMap.get(c.lead_id) ?? { total: 0, positive: 0 } : { total: 0, positive: 0 };
    const base: CampaignSummary = {
      campaignId: c.id,
      campaignName: c.name ?? "(sin nombre)",
      status: c.status ?? "unknown",
      channels: Array.from(channels),
      totalSteps: Array.isArray(c.sequence_steps) ? (c.sequence_steps as unknown[]).length : 0,
      totalLeads: 1,
      messagesSent: sent,
      messagesQueued: queued,
      messagesStuck: stuckRows.length,
      messagesFailed: failed,
      replies: repliesData.total,
      positiveReplies: repliesData.positive,
      lastActivityAt,
      health: "healthy",
      stuckBuckets,
    };
    base.health = campaignHealth(base);
    return base;
  });

  // Sort: critical first, then warning, then by lastActivityAt desc, then name.
  const ord = (h: CampaignSummary["health"]) => h === "critical" ? 0 : h === "warning" ? 1 : 2;
  summaries.sort((a, b) => {
    if (ord(a.health) !== ord(b.health)) return ord(a.health) - ord(b.health);
    if (a.lastActivityAt && b.lastActivityAt) return b.lastActivityAt.localeCompare(a.lastActivityAt);
    if (a.lastActivityAt) return -1;
    if (b.lastActivityAt) return 1;
    return a.campaignName.localeCompare(b.campaignName);
  });
  return summaries;
}

// Drill-in for ONE campaign: stuck breakdown + failure reasons + per-step
// counts. Used by /admin/reliability?tenant=X&campaign=Y.
export async function getCampaignDetail(campaignId: string): Promise<CampaignDetail | null> {
  const svc = getSupabaseService();

  const { data: cRaw } = await svc
    .from("campaigns")
    .select("id, name, status, sequence_steps, lead_id, last_step_at, created_at, leads!inner(company_bio_id)")
    .eq("id", campaignId)
    .maybeSingle();
  if (!cRaw) return null;
  const c = (cRaw as unknown) as { id: string; name: string | null; status: string | null; sequence_steps: unknown; lead_id: string | null; last_step_at: string | null; created_at: string | null; leads: { company_bio_id: string | null } | null };

  const bioId = c.leads?.company_bio_id ?? null;
  if (!bioId) return null;

  const { data: bioRow } = await svc.from("company_bios").select("company_name").eq("id", bioId).maybeSingle();
  const bioName = (bioRow as { company_name: string | null } | null)?.company_name ?? "Unnamed";

  const { data: msgsRaw } = await svc
    .from("campaign_messages")
    .select("id, channel, step_number, status, sent_at, error_details, created_at, metadata, lead_id, leads(primary_first_name, primary_last_name, company_name, linkedin_connected, status), campaigns(seller_id)")
    .eq("campaign_id", campaignId)
    .limit(2000);
  const msgs = ((msgsRaw ?? []) as unknown) as Array<{
    id: string;
    channel: string | null;
    step_number: number | null;
    status: string | null;
    sent_at: string | null;
    error_details: string | null;
    created_at: string | null;
    metadata: Record<string, unknown> | null;
    lead_id: string | null;
    leads: { primary_first_name: string | null; primary_last_name: string | null; company_name: string | null; linkedin_connected: boolean | null; status: string | null } | null;
    campaigns: { seller_id: string | null } | null;
  }>;

  const nowMs = Date.now();
  const stuckBefore = new Date(Date.now() - STUCK_DAYS * 86400000).toISOString();
  let sent = 0, queued = 0, failed = 0, stuck = 0;
  const stuckRows: typeof msgs = [];
  const failedRows: Array<{ error_details: string | null }> = [];
  const stepBuckets = new Map<number, { sent: number; queued: number; stuck: number; failed: number; draft: number; channel: string }>();
  let lastActivityAt: string | null = c.last_step_at ?? null;
  const channels = new Set<string>();

  for (const m of msgs) {
    const ch = m.channel ?? "?";
    channels.add(ch);
    const step = m.step_number ?? 0;
    const b = stepBuckets.get(step) ?? { sent: 0, queued: 0, stuck: 0, failed: 0, draft: 0, channel: ch };
    const s = m.status ?? "";
    if (s === "sent") {
      sent++;
      b.sent++;
      if (m.sent_at && (!lastActivityAt || m.sent_at > lastActivityAt)) lastActivityAt = m.sent_at;
    } else if (s === "queued") {
      queued++;
      b.queued++;
      const eligibleAt = (m.metadata?.eligible_at as string | undefined) ?? null;
      const isStuck = eligibleAt
        ? (() => { const t = Date.parse(eligibleAt); return !isNaN(t) && t < nowMs - 60_000; })()
        : (m.created_at !== null && m.created_at < stuckBefore);
      if (isStuck) {
        stuck++;
        b.stuck++;
        stuckRows.push(m);
      }
    } else if (s === "failed") {
      failed++;
      b.failed++;
      failedRows.push({ error_details: m.error_details });
    } else if (s === "draft") {
      b.draft++;
    }
    stepBuckets.set(step, b);
  }

  const repliesData = c.lead_id ? await svc.from("lead_replies").select("classification").eq("lead_id", c.lead_id).limit(50) : { data: null };
  const replyRows = (repliesData.data ?? []) as Array<{ classification: string | null }>;
  const totalReplies = replyRows.length;
  const positiveReplies = replyRows.filter(r => r.classification === "positive").length;

  function classifyForDetail(m: typeof msgs[number]): string {
    const channel = (m.channel ?? "linkedin").toLowerCase();
    const step = m.step_number ?? 0;
    const leadStatus = m.leads?.status ?? null;
    const linkedinConnected = m.leads?.linkedin_connected === true;
    const meta = m.metadata ?? {};
    const lastRateLimit = (meta.last_rate_limit_at as string | undefined) ?? null;
    if (lastRateLimit) {
      const t = Date.parse(lastRateLimit);
      if (!isNaN(t) && t > nowMs - RATE_LIMIT_COOLDOWN_MS) return "Seller en cooldown por rate-limit";
    }
    if (leadStatus && ["closed_won", "closed_lost", "qualified"].includes(leadStatus)) {
      return "Lead en estado terminal";
    }
    if (channel === "linkedin" && step > 0 && !linkedinConnected) {
      return "Esperando que el lead acepte la conexión de LinkedIn";
    }
    if (channel === "call") return "Llamada manual pendiente";
    if (!m.campaigns?.seller_id) return "Campaña sin seller asignado";
    return "Cron del dispatcher no levantó este mensaje todavía";
  }

  const stuckBreakdown: CampaignDetail["stuckBreakdown"] = (() => {
    const buckets = new Map<string, CampaignDetail["stuckBreakdown"][number]>();
    for (const m of stuckRows) {
      const reason = classifyForDetail(m);
      const cur = buckets.get(reason) ?? { reason, count: 0, samples: [] };
      cur.count++;
      if (cur.samples.length < 5) {
        const first = m.leads?.primary_first_name ?? "";
        const last = m.leads?.primary_last_name ?? "";
        const leadName = (first + " " + last).trim() || (m.leads?.company_name ?? "(lead sin nombre)");
        const created = m.created_at ? Date.parse(m.created_at) : nowMs;
        const ageDays = Math.max(0, Math.round((nowMs - created) / 86400000));
        cur.samples.push({ leadName, channel: m.channel ?? "?", stepNumber: m.step_number ?? 0, ageDays, messageId: m.id });
      }
      buckets.set(reason, cur);
    }
    return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  })();

  const failureReasons = groupFailureReasons(failedRows);

  const steps = Array.from(stepBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([stepNumber, v]) => ({ stepNumber, channel: v.channel, sent: v.sent, queued: v.queued, stuck: v.stuck, failed: v.failed, draft: v.draft }));

  const base: CampaignDetail = {
    campaignId: c.id,
    campaignName: c.name ?? "(sin nombre)",
    status: c.status ?? "unknown",
    channels: Array.from(channels),
    totalSteps: Array.isArray(c.sequence_steps) ? (c.sequence_steps as unknown[]).length : 0,
    totalLeads: 1,
    messagesSent: sent,
    messagesQueued: queued,
    messagesStuck: stuck,
    messagesFailed: failed,
    replies: totalReplies,
    positiveReplies,
    lastActivityAt,
    health: "healthy",
    stuckBuckets: [], // detail view has its own (richer) stuckBreakdown
    bioId,
    bioName,
    stuckBreakdown,
    failureReasons,
    steps,
  };
  base.health = campaignHealth(base);
  return base;
}
