import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { UserCircle } from "lucide-react";
import AccountsClient from "./AccountsClient";
import PageHero from "@/components/PageHero";

async function getData() {
  // Get all active sellers with their accounts
  const { data: sellers } = await supabase
    .from("sellers")
    .select("id, name, unipile_account_id, email_account, linkedin_daily_limit, email_daily_limit, active")
    .eq("active", true)
    .order("name");

  // Get today's start (UTC)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  // Get all campaign_messages sent today, joined with campaigns to get seller_id + channel
  const { data: todayMessages } = await supabase
    .from("campaign_messages")
    .select("id, campaign_id, channel, sent_at, campaigns(seller_id)")
    .gte("sent_at", todayISO)
    .not("sent_at", "is", null);

  // Count messages per seller per channel today
  const usageToday: Record<string, { linkedin: number; email: number; call: number }> = {};
  for (const msg of todayMessages ?? []) {
    const sellerId = (msg.campaigns as any)?.seller_id;
    if (!sellerId) continue;
    if (!usageToday[sellerId]) usageToday[sellerId] = { linkedin: 0, email: 0, call: 0 };
    const ch = msg.channel as "linkedin" | "email" | "call";
    if (ch in usageToday[sellerId]) usageToday[sellerId][ch]++;
  }

  // Get last 30 days of messages for history
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

  // Aggregate by date + seller + channel
  const historyMap: Record<string, { date: string; sellerId: string; sellerName: string; channel: string; count: number }> = {};
  const sellerNameMap: Record<string, string> = {};
  for (const s of sellers ?? []) sellerNameMap[s.id] = s.name;

  for (const msg of historyMessages ?? []) {
    const sellerId = (msg.campaigns as any)?.seller_id;
    if (!sellerId) continue;
    const date = msg.sent_at!.slice(0, 10); // YYYY-MM-DD
    const ch = msg.channel ?? "unknown";
    const key = `${date}:${sellerId}:${ch}`;
    if (!historyMap[key]) {
      historyMap[key] = { date, sellerId, sellerName: sellerNameMap[sellerId] ?? "Unknown", channel: ch, count: 0 };
    }
    historyMap[key].count++;
  }

  const history = Object.values(historyMap).sort((a, b) => b.date.localeCompare(a.date));

  // Build seller cards data
  const sellerCards = (sellers ?? []).map(s => {
    const usage = usageToday[s.id] ?? { linkedin: 0, email: 0, call: 0 };
    const linkedinLimit = s.linkedin_daily_limit ?? 15;
    const emailLimit = s.email_daily_limit ?? 50;
    const linkedinPct = linkedinLimit > 0 ? Math.round((usage.linkedin / linkedinLimit) * 100) : 0;
    const emailPct = emailLimit > 0 ? Math.round((usage.email / emailLimit) * 100) : 0;

    return {
      id: s.id,
      name: s.name,
      hasLinkedin: !!s.unipile_account_id,
      hasEmail: !!s.email_account,
      emailAccount: s.email_account,
      unipileId: s.unipile_account_id,
      linkedin: { sent: usage.linkedin, limit: linkedinLimit, pct: Math.min(linkedinPct, 100) },
      email: { sent: usage.email, limit: emailLimit, pct: Math.min(emailPct, 100) },
      calls: usage.call,
    };
  });

  // Team totals
  const totalLinkedinSent = sellerCards.reduce((s, c) => s + c.linkedin.sent, 0);
  const totalLinkedinLimit = sellerCards.reduce((s, c) => s + (c.hasLinkedin ? c.linkedin.limit : 0), 0);
  const totalEmailSent = sellerCards.reduce((s, c) => s + c.email.sent, 0);
  const totalEmailLimit = sellerCards.reduce((s, c) => s + (c.hasEmail ? c.email.limit : 0), 0);

  return {
    sellers: sellerCards,
    history,
    totals: {
      linkedinSent: totalLinkedinSent,
      linkedinLimit: totalLinkedinLimit,
      emailSent: totalEmailSent,
      emailLimit: totalEmailLimit,
    },
  };
}

export default async function AccountsPage() {
  const { sellers, history, totals } = await getData();

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={UserCircle}
        section="Operations"
        title="Accounts & Usage"
        description="Monitor daily sending limits and account health across your team."
        accentColor={C.gold}
        status={{ label: "Active", active: true }}
      />

      <AccountsClient
        sellers={JSON.parse(JSON.stringify(sellers))}
        history={JSON.parse(JSON.stringify(history))}
        totals={totals}
      />
    </div>
  );
}
