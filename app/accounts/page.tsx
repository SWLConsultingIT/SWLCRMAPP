import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { C } from "@/lib/design";
import { UserCircle } from "lucide-react";
import AccountsClient from "./AccountsClient";
import PageHero from "@/components/PageHero";

const INSTANTLY_KEY = process.env.INSTANTLY_API_KEY!;
const AIRCALL_AUTH = Buffer.from(`${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`).toString("base64");

async function getInstantlyPool() {
  try {
    const res = await fetch("https://api.instantly.ai/api/v2/accounts?limit=100", {
      headers: { Authorization: `Bearer ${INSTANTLY_KEY}` },
      cache: "no-store",
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

    const [numbersRes, callsRes] = await Promise.all([
      fetch("https://api.aircall.io/v1/numbers", {
        headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
        cache: "no-store",
      }),
      fetch(`https://api.aircall.io/v1/calls?from=${fromTs}&per_page=50&order=desc`, {
        headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
        cache: "no-store",
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

  // Resolve current user's scope
  const { data: { user } } = await supabase.auth.getUser();
  let userRole: string | null = null;
  let userCompanyBioId: string | null = null;
  let allowedEmails: string[] | null = null;
  let allowedAircallIds: number[] | null = null;

  if (user) {
    const svc = getSupabaseService();
    const { data: profile } = await svc
      .from("user_profiles")
      .select("role, company_bio_id")
      .eq("user_id", user.id)
      .single();
    userRole = profile?.role ?? null;
    userCompanyBioId = profile?.company_bio_id ?? null;

    if (userRole !== "admin" && userCompanyBioId) {
      const { data: bio } = await svc
        .from("company_bios")
        .select("email_accounts, aircall_number_ids")
        .eq("id", userCompanyBioId)
        .single();
      allowedEmails = (bio?.email_accounts as string[] | null) ?? [];
      allowedAircallIds = (bio?.aircall_number_ids as number[] | null) ?? [];
    }
  }

  // Sellers: admin sees all, client only sees sellers of their company
  let sellersQuery = supabase.from("sellers")
    .select("id, name, unipile_account_id, linkedin_daily_limit, active, company_bio_id")
    .eq("active", true)
    .order("name");
  if (userRole !== "admin" && userCompanyBioId) {
    sellersQuery = sellersQuery.eq("company_bio_id", userCompanyBioId);
  }

  const [
    { data: sellers },
    instantly,
    aircall,
  ] = await Promise.all([
    sellersQuery,
    getInstantlyPool(),
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

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const { data: todayMessages } = await supabase
    .from("campaign_messages")
    .select("id, campaign_id, channel, sent_at, campaigns(seller_id)")
    .gte("sent_at", todayISO)
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

  const { data: historyMessages } = await supabase
    .from("campaign_messages")
    .select("id, channel, sent_at, campaigns(seller_id)")
    .gte("sent_at", thirtyDaysISO)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(5000);

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
    };
  });

  const totalLinkedinSent = sellerCards.reduce((s, c) => s + c.linkedin.sent, 0);
  const totalLinkedinLimit = sellerCards.reduce((s, c) => s + (c.hasLinkedin ? c.linkedin.limit : 0), 0);
  const totalEmailSent = Object.values(usageToday).reduce((s, u) => s + u.email, 0);

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

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={UserCircle}
        section="Operations"
        title="Accounts & Usage"
        description="Monitor daily sending limits and account health across channels."
        accentColor={C.gold}
        status={{ label: "Active", active: true }}
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
