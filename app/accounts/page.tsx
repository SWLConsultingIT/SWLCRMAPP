import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getInstantlyConfig } from "@/lib/instantly-config";
import { C } from "@/lib/design";
import { UserCircle, Share2, Mail, Phone, Check, X } from "lucide-react";
import AccountsClient from "./AccountsClient";
import PageHero from "@/components/PageHero";

export const dynamic = "force-dynamic";

const AIRCALL_AUTH = Buffer.from(`${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`).toString("base64");

async function getInstantlyPool(bioId: string | null) {
  // Per-tenant Instantly API key (e.g. Arqy uses a different Hypergrowth
  // subscription than SWL). Falls back to env var INSTANTLY_API_KEY when
  // the tenant has no key set, or when there's no scope (super-admin
  // without impersonation, who shouldn't be hitting this page anyway).
  const apiKey = bioId
    ? (await getInstantlyConfig(bioId))?.apiKey ?? ""
    : (process.env.INSTANTLY_API_KEY ?? "");
  if (!apiKey) return null;
  try {
    // 60s revalidate — Instantly accounts (warmup score, daily limits) are
    // updated by Instantly itself on a slow rhythm and don't need second-
    // precision. Per-tenant cache tag so different Instantly accounts don't
    // share each other's listings in the route cache.
    const res = await fetch("https://api.instantly.ai/api/v2/accounts?limit=100", {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 60, tags: [`instantly-accounts-${bioId ?? "env"}`] },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const accounts = (data.items || []).map((a: any) => ({
      email: a.email,
      dailyLimit: a.daily_limit ?? 0,
      warmupStatus: a.warmup_status,
      setupPending: !!a.setup_pending,
      warmupScore: a.stat_warmup_score ?? 0,
    }));
    const totalLimit = accounts.reduce((s: number, a: any) => s + a.dailyLimit, 0);
    const warmupPending = accounts.filter((a: any) => a.setupPending).length;
    const ready = accounts.length - warmupPending;
    return {
      accounts,
      total: accounts.length,
      ready,
      warmupPending,
      totalDailyLimit: totalLimit,
    };
  } catch {
    return null;
  }
}

async function getAircallUsage() {
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const fromTs = Math.floor(monthStart.getTime() / 1000);

    // 60s revalidate is fine for this page — it shows aggregate usage
    // (minutes/calls per number this month). Real-time precision isn't needed.
    // Without this cache, every accounts-page nav hit Aircall twice (~2s each).
    const [numbersRes, callsRes] = await Promise.all([
      fetch("https://api.aircall.io/v1/numbers", {
        headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
        next: { revalidate: 60, tags: ["aircall-numbers"] },
      }),
      fetch(`https://api.aircall.io/v1/calls?from=${fromTs}&per_page=50&order=desc`, {
        headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
        next: { revalidate: 60, tags: ["aircall-calls"] },
      }),
    ]);

    const numbers = numbersRes.ok ? (await numbersRes.json()).numbers ?? [] : [];
    const calls = callsRes.ok ? (await callsRes.json()).calls ?? [] : [];

    const byNumber: Record<string, { seconds: number; calls: number }> = {};
    for (const c of calls) {
      const nid = c.number?.id ?? c.number_id;
      if (!nid) continue;
      if (!byNumber[nid]) byNumber[nid] = { seconds: 0, calls: 0 };
      byNumber[nid].seconds += c.duration ?? 0;
      byNumber[nid].calls++;
    }

    const numberCards = numbers.map((n: any) => {
      const usage = byNumber[n.id] ?? { seconds: 0, calls: 0 };
      return {
        id: n.id,
        name: n.name ?? n.digits,
        digits: n.digits,
        country: n.country ?? "—",
        availability: n.availability_status ?? "unknown",
        is_active: n.is_active !== false,
        minutes: Math.round(usage.seconds / 60),
        calls: usage.calls,
      };
    });

    return {
      numbers: numberCards,
      totalMinutes: numberCards.reduce((s: number, n: any) => s + n.minutes, 0),
      totalCalls: numberCards.reduce((s: number, n: any) => s + n.calls, 0),
    };
  } catch {
    return null;
  }
}

async function getData() {
  const supabase = await getSupabaseServer();

  // Use the shared scope helper so demo-impersonation and tenant boundaries
  // are respected uniformly. Previously this page filtered "if not admin",
  // which meant the SWL super-admin saw sellers from every tenant — including
  // Graeme (Pathway). /accounts is an OPERATIONAL page (per-seller daily
  // usage, edits, etc.), not a super-admin cross-tenant view, so we always
  // scope to the current user's bio. The cross-tenant view lives at /admin.
  const { getUserScope } = await import("@/lib/scope");
  const scope = await getUserScope();
  const userCompanyBioId = scope.companyBioId;
  let allowedEmails: string[] | null = null;
  let allowedAircallIds: number[] | null = null;

  if (userCompanyBioId) {
    const svc = getSupabaseService();
    const { data: bio } = await svc
      .from("company_bios")
      .select("email_accounts, aircall_number_ids")
      .eq("id", userCompanyBioId)
      .single();
    allowedEmails = (bio?.email_accounts as string[] | null) ?? [];
    allowedAircallIds = (bio?.aircall_number_ids as number[] | null) ?? [];
  }

  // Sellers scoped to the current bio: own sellers + sellers shared from other
  // tenants via admin "Sellers shared with this client". No cross-tenant leak.
  let sellersQuery = supabase.from("sellers")
    .select("id, name, unipile_account_id, linkedin_daily_limit, active, company_bio_id, shared_with_company_bio_ids")
    .eq("active", true)
    .order("name");
  if (userCompanyBioId) {
    sellersQuery = sellersQuery.or(`company_bio_id.eq.${userCompanyBioId},shared_with_company_bio_ids.cs.{${userCompanyBioId}}`);
  }

  const [
    { data: sellers },
    instantly,
    aircall,
  ] = await Promise.all([
    sellersQuery,
    getInstantlyPool(userCompanyBioId),
    getAircallUsage(),
  ]);

  // Filter Instantly accounts + aircall by allowed lists (admin bypasses)
  const filteredInstantly = instantly && allowedEmails !== null
    ? (() => {
        const allowSet = new Set(allowedEmails.map(e => e.toLowerCase()));
        const filtered = instantly.accounts.filter((a: any) => allowSet.has(String(a.email).toLowerCase()));
        const readyCount = filtered.filter((a: any) => !a.setupPending).length;
        return {
          accounts: filtered,
          total: filtered.length,
          ready: readyCount,
          warmupPending: filtered.length - readyCount,
          totalDailyLimit: filtered.reduce((s: number, a: any) => s + a.dailyLimit, 0),
        };
      })()
    : instantly;

  const filteredAircall = aircall && allowedAircallIds !== null
    ? (() => {
        const allowSet = new Set(allowedAircallIds.map(Number));
        const filtered = aircall.numbers.filter((n: any) => allowSet.has(Number(n.id)));
        return {
          numbers: filtered,
          totalMinutes: filtered.reduce((s: number, n: any) => s + n.minutes, 0),
          totalCalls: filtered.reduce((s: number, n: any) => s + n.calls, 0),
        };
      })()
    : aircall;

  // Rolling 24h window — matches the dispatcher's daily-cap accounting
  // (see /api/cron/dispatch-queue: `since24h = nowMs - DAY_MS`). Previously
  // this used `setHours(0,0,0,0)` which resolves to UTC midnight on Vercel
  // and silently dropped sends that the dispatcher still counts against
  // the seller's daily cap. On 2026-05-27 Fran saw Lucho's card at 0/50
  // while LinkedIn was already 422-rate-limiting him — the UI told a
  // different story than the dispatcher. Rolling 24h aligns the two.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: todayMessages } = await supabase
    .from("campaign_messages")
    .select("id, campaign_id, channel, sent_at, campaigns(seller_id)")
    .gte("sent_at", since24h)
    .not("sent_at", "is", null);

  const usageToday: Record<string, { linkedin: number; email: number; call: number }> = {};
  for (const msg of todayMessages ?? []) {
    const sellerId = (msg.campaigns as any)?.seller_id;
    if (!sellerId) continue;
    if (!usageToday[sellerId]) usageToday[sellerId] = { linkedin: 0, email: 0, call: 0 };
    const ch = msg.channel as "linkedin" | "email" | "call";
    if (ch in usageToday[sellerId]) usageToday[sellerId][ch]++;
  }

  // Last 30 days history
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysISO = thirtyDaysAgo.toISOString();

  // Scoped to the active tenant via the campaigns→leads join — same reason as
  // the email count above: without it a super_admin's 30-day history table
  // mixed in every other tenant's sends (they surfaced as "Unknown" seller).
  let historyQuery = supabase
    .from("campaign_messages")
    .select("id, channel, sent_at, campaigns!inner(seller_id, leads!inner(company_bio_id))")
    .gte("sent_at", thirtyDaysISO)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(5000);
  if (userCompanyBioId) {
    historyQuery = historyQuery.eq("campaigns.leads.company_bio_id", userCompanyBioId);
  }
  const { data: historyMessages } = await historyQuery;

  const historyMap: Record<string, { date: string; sellerId: string; sellerName: string; channel: string; count: number }> = {};
  const sellerNameMap: Record<string, string> = {};
  for (const s of sellers ?? []) sellerNameMap[s.id] = s.name;

  for (const msg of historyMessages ?? []) {
    const sellerId = (msg.campaigns as any)?.seller_id;
    if (!sellerId) continue;
    const date = msg.sent_at!.slice(0, 10);
    const ch = msg.channel ?? "unknown";
    const key = `${date}:${sellerId}:${ch}`;
    if (!historyMap[key]) {
      historyMap[key] = { date, sellerId, sellerName: sellerNameMap[sellerId] ?? "Unknown", channel: ch, count: 0 };
    }
    historyMap[key].count++;
  }

  const history = Object.values(historyMap).sort((a, b) => b.date.localeCompare(a.date));

  // Sellers with LinkedIn only (email pulled out to Instantly pool section)
  const sellerCards = (sellers ?? []).map(s => {
    const usage = usageToday[s.id] ?? { linkedin: 0, email: 0, call: 0 };
    const linkedinLimit = s.linkedin_daily_limit ?? 15;
    const linkedinPct = linkedinLimit > 0 ? Math.round((usage.linkedin / linkedinLimit) * 100) : 0;

    return {
      id: s.id,
      name: s.name,
      hasLinkedin: !!s.unipile_account_id,
      unipileId: s.unipile_account_id,
      linkedin: { sent: usage.linkedin, limit: linkedinLimit, pct: Math.min(linkedinPct, 100) },
      calls: usage.call,
      // Seller is "shared" when the viewer's tenant is NOT its primary owner.
      // Used by the UI to badge the card and gate destructive actions.
      isShared: !!userCompanyBioId && s.company_bio_id !== userCompanyBioId,
    };
  });

  const totalLinkedinSent = sellerCards.reduce((s, c) => s + c.linkedin.sent, 0);
  const totalLinkedinLimit = sellerCards.reduce((s, c) => s + (c.hasLinkedin ? c.linkedin.limit : 0), 0);

  // Email "sent today" MUST be scoped to the active tenant — the Instantly
  // pool capacity it's compared against (instantly.totalDailyLimit) is this
  // tenant's inboxes only. campaign_messages carries no company_bio_id and
  // RLS gives a super_admin every tenant's rows (is_auth_admin bypass), so
  // summing the global usageToday here showed Pathway "111 / 60 — Pool at
  // capacity" when Pathway had only sent 28 (the other 83 were SWL's). Count
  // through the campaigns→leads join, filtered to the active bio.
  // LinkedIn stays per-seller-global on purpose: a shared seller's LinkedIn
  // daily cap is enforced at the account level across every tenant, matching
  // how dispatch-queue accounts for it.
  let emailSentQuery = supabase
    .from("campaign_messages")
    .select("id, campaigns!inner(leads!inner(company_bio_id))", { count: "exact", head: true })
    .eq("channel", "email")
    .gte("sent_at", since24h)
    .not("sent_at", "is", null);
  if (userCompanyBioId) {
    emailSentQuery = emailSentQuery.eq("campaigns.leads.company_bio_id", userCompanyBioId);
  }
  const { count: scopedEmailSent } = await emailSentQuery;
  const totalEmailSent = scopedEmailSent ?? 0;

  return {
    sellers: sellerCards,
    history,
    instantly: filteredInstantly,
    aircall: filteredAircall,
    totals: {
      linkedinSent: totalLinkedinSent,
      linkedinLimit: totalLinkedinLimit,
      emailSent: totalEmailSent,
    },
  };
}

export default async function AccountsPage() {
  const data = await getData();

  // Per-channel connection status — gives the seller an instant "is the
  // outreach channel ready to use?" answer without scrolling through the
  // detail sections below. Sellers used to ask support "why can't I send?"
  // when really their inbox wasn't connected — this header answers it.
  const linkedinReady = data.sellers.filter(s => s.hasLinkedin).length;
  const linkedinTotal = data.sellers.length;
  const emailReady = data.instantly?.ready ?? 0;
  const emailTotal = data.instantly?.total ?? 0;
  const callsReady = data.aircall?.numbers.filter((n: { is_active: boolean }) => n.is_active).length ?? 0;
  const callsTotal = data.aircall?.numbers.length ?? 0;

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={UserCircle}
        section="Operations"
        title="Accounts & Usage"
        description="Monitor daily sending limits and account health across channels."
        accentColor={C.gold}
        status={{ label: "Active", active: true }}
        stats={[
          { label: "LinkedIn ready", value: `${linkedinReady}/${linkedinTotal}`, tone: linkedinReady > 0 ? "positive" : "warning" },
          { label: "Email ready", value: `${emailReady}/${emailTotal}`, tone: emailReady > 0 ? "positive" : "warning" },
          { label: "Calls ready", value: `${callsReady}/${callsTotal}`, tone: callsReady > 0 ? "positive" : "warning" },
          { label: "LinkedIn sent today", value: `${data.totals.linkedinSent}/${data.totals.linkedinLimit}`, tone: "neutral" },
        ]}
      />

      <ConnectionStatusHeader
        linkedin={{ ready: linkedinReady, total: linkedinTotal, label: "sellers with LinkedIn" }}
        email={{ ready: emailReady, total: emailTotal, label: "inboxes ready" }}
        calls={{ ready: callsReady, total: callsTotal, label: "Aircall numbers active" }}
      />

      <AccountsClient
        sellers={JSON.parse(JSON.stringify(data.sellers))}
        history={JSON.parse(JSON.stringify(data.history))}
        instantly={JSON.parse(JSON.stringify(data.instantly))}
        aircall={JSON.parse(JSON.stringify(data.aircall))}
        totals={data.totals}
      />
    </div>
  );
}

type ChannelStatus = { ready: number; total: number; label: string };

function ConnectionStatusHeader({ linkedin, email, calls }: {
  linkedin: ChannelStatus;
  email: ChannelStatus;
  calls: ChannelStatus;
}) {
  return (
    <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
      <ChannelStatusCard icon={Share2} channel="LinkedIn" status={linkedin} color={C.linkedin ?? "#0A66C2"} />
      <ChannelStatusCard icon={Mail} channel="Email" status={email} color={C.email ?? "#059669"} />
      <ChannelStatusCard icon={Phone} channel="Calls" status={calls} color="#F97316" />
    </div>
  );
}

function ChannelStatusCard({ icon: Icon, channel, status, color }: {
  icon: typeof Share2;
  channel: string;
  status: ChannelStatus;
  color: string;
}) {
  // "Ready" = at least one connected account / number / inbox available to
  // actually send today. "Not set up" surfaces the empty case explicitly so
  // sellers don't blame the wider app when the underlying channel is missing.
  const isReady = status.ready > 0;
  return (
    <div
      className="rounded-xl border px-4 py-3 flex items-center gap-3"
      style={{
        backgroundColor: C.card,
        borderColor: isReady ? `color-mix(in srgb, ${color} 30%, ${C.border})` : C.border,
        boxShadow: isReady ? `inset 3px 0 0 ${color}` : `inset 3px 0 0 ${C.textDim}`,
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      >
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: C.textMuted }}>
          {channel}
        </p>
        <div className="flex items-center gap-1.5">
          {isReady ? (
            <Check size={13} style={{ color }} strokeWidth={2.5} />
          ) : (
            <X size={13} style={{ color: C.textDim }} strokeWidth={2.5} />
          )}
          <p className="text-sm font-bold" style={{ color: C.textPrimary }}>
            {isReady ? `${status.ready}${status.total ? ` / ${status.total}` : ""}` : "Not set up"}
          </p>
          <p className="text-[11px]" style={{ color: C.textMuted }}>
            {isReady ? status.label : "no accounts connected"}
          </p>
        </div>
      </div>
    </div>
  );
}
