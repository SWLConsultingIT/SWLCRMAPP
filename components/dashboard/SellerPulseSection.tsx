import { getSellerActivity, getTeamMembers } from "@/lib/dashboard-data";
import SellerPulseTable from "@/components/dashboard/SellerPulseTable";

// The Seller Pulse table needs getSellerActivity + getTeamMembers, which each
// call the SLOW GoTrue admin `listUsers` (all project users) just to map user
// ids → display names. Those two calls used to sit in the dashboard's blocking
// Promise.all, so EVERY dashboard load waited on them even though they only feed
// the Sellers tab. Fetching them here, behind a <Suspense> boundary in
// app/page.tsx, keeps them off the initial-load critical path — the shell +
// other tabs paint immediately and this section streams in when ready.

type CallsRow = { sellerId: string; made?: number; byDay?: Record<string, { made?: number } | undefined> };
type Perf = { id: string; pendingCalls: number; replied: number; positive: number };

export default async function SellerPulseSection({
  bioId, callOutcomesBySeller, sellerPerformance, periodLabel,
}: {
  bioId: string | null;
  callOutcomesBySeller: CallsRow[];
  sellerPerformance: Perf[];
  periodLabel: string;
}) {
  const __tSellers = performance.now();
  const [sellerActivity, teamMembers] = await Promise.all([
    getSellerActivity(bioId),
    getTeamMembers(bioId),
  ]);
  // Perf (temporary): these each call the GoTrue admin listUsers; streamed via
  // Suspense so they don't block the initial dashboard, but timed for attribution.
  console.log(`[DASH-PERF] sellers_listUsers (getSellerActivity + getTeamMembers, Suspense): ${(performance.now() - __tSellers).toFixed(0)}ms / ${teamMembers.length} members`);

  // Argentina is UTC-3 — match dashboard-data.ts so "today" is local midnight.
  const todayStr = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const callsRowBySellerId = new Map<string, CallsRow>();
  for (const row of callOutcomesBySeller) callsRowBySellerId.set(row.sellerId, row);
  const pendingBySellerId = new Map<string, number>();
  const repliedBySellerId = new Map<string, number>();
  const positiveBySellerId = new Map<string, number>();
  for (const s of sellerPerformance) {
    pendingBySellerId.set(s.id, s.pendingCalls);
    repliedBySellerId.set(s.id, s.replied);
    positiveBySellerId.set(s.id, s.positive);
  }

  const sellers = teamMembers.map(m => {
    const callsRow = (m.sellerId ? callsRowBySellerId.get(m.sellerId) : null) ?? callsRowBySellerId.get(m.userId);
    const bd = callsRow?.byDay;
    const callsToday = bd?.[todayStr]?.made ?? 0;
    const callsPeriod = callsRow?.made ?? 0;
    const lastCallAt = bd
      ? Object.keys(bd).filter(d => (bd[d]?.made ?? 0) > 0).sort().at(-1) ?? null
      : null;
    const activity = m.sellerId ? sellerActivity.get(m.sellerId) : null;
    return {
      id: m.userId,
      name: m.displayName,
      userId: m.userId,
      lastSeenAt: m.lastSeenAt,
      lastCallAt,
      callsToday,
      callsPeriod,
      pendingCalls: m.sellerId ? (pendingBySellerId.get(m.sellerId) ?? 0) : 0,
      repliedPeriod: m.sellerId ? (repliedBySellerId.get(m.sellerId) ?? 0) : 0,
      positivePeriod: m.sellerId ? (positiveBySellerId.get(m.sellerId) ?? 0) : 0,
      linkedinStatus: (activity as { linkedinStatus?: string | null } | null)?.linkedinStatus ?? null,
      linkedinStatusNote: (activity as { linkedinStatusNote?: string | null } | null)?.linkedinStatusNote ?? null,
    };
  });

  return <section><SellerPulseTable sellers={sellers} periodLabel={periodLabel} /></section>;
}
