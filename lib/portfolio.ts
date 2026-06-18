// Cross-tenant portfolio comparison — SUPER-ADMIN only.
//
// Powers the dashboard "Portfolio" tab: pick which companies to compare and
// see each one's weekly activity (contacted / calls / replies / positives)
// with week-over-week trend, plus cumulative pipeline (active / opportunities
// / wins). It's the live, multi-client version of the weekly status PDF.
//
// All queries group by tenant in JS (one query per table, not per company) and
// use .range() to dodge PostgREST's 1000-row cap.

import { getSupabaseService } from "@/lib/supabase-service";

export type PortfolioCompany = {
  bioId: string;
  name: string;
  // Weekly windows (current vs the equal-length window before it).
  contacted: number;        contactedPrev: number;
  messages: number;         messagesPrev: number;
  calls: number;            callsPrev: number;
  replies: number;          repliesPrev: number;
  positives: number;        positivesPrev: number;
  meetings: number;         meetingsPrev: number;
  winsPeriod: number;       winsPeriodPrev: number;
  byChannel: { channel: string; messages: number; leads: number }[];
  // Per-seller activity this period (calls + outcomes attributed to the seller).
  sellers: { name: string; calls: number; leads: number; replies: number; positives: number }[];
  // Cumulative pipeline (all-time).
  totalLeads: number;
  activeLeads: number;
  activeFlows: number;
  opportunities: number;
  wins: number;
};

const POS = new Set(["positive", "meeting_intent"]);

type Row = Record<string, unknown>;
async function pageAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function minuteKey(lead: string, ts: string | null): string {
  if (!ts) return `${lead}-x`;
  // YYYYMMDDHHMM — dedupe the 2-rows-per-call Aircall pattern.
  return `${lead}-${ts.slice(0, 16)}`;
}

export async function getPortfolioComparison(days = 7): Promise<PortfolioCompany[]> {
  const svc = getSupabaseService();
  const now = Date.now();
  // days <= 0 → all-time. The "this" window becomes everything (since epoch)
  // and the "prev" window collapses to empty, so trend deltas read as "—".
  const allTime = days <= 0;
  const thisStart = allTime ? new Date(0).toISOString() : new Date(now - days * 86400000).toISOString();
  const prevStart = allTime ? new Date(0).toISOString() : new Date(now - 2 * days * 86400000).toISOString();
  const inThis = (ts: string | null) => !!ts && ts >= thisStart;
  const inPrev = (ts: string | null) => !!ts && ts >= prevStart && ts < thisStart;

  // Exclude demo tenants (e.g. Gruppo Everest) — their sellers/leads are
  // fictional and must not show up in the portfolio metrics.
  const { data: biosRaw } = await svc
    .from("company_bios")
    .select("id, company_name, is_demo")
    .is("archived_at", null)
    .order("company_name");
  const bios = ((biosRaw ?? []) as { id: string; company_name: string; is_demo: boolean | null }[])
    .filter(b => !b.is_demo);
  const bioIds = bios.map(b => b.id);
  if (bioIds.length === 0) return [];

  // Sellers — for attributing calls/replies to a person.
  const { data: sellersRaw } = await svc.from("sellers").select("id, name, user_id");
  const sellers = (sellersRaw ?? []) as { id: string; name: string; user_id: string | null }[];
  const sidName = new Map(sellers.map(s => [s.id, s.name]));
  const uidName = new Map(sellers.filter(s => s.user_id).map(s => [s.user_id as string, s.name]));

  // ── Activity (last 2 windows) ───────────────────────────────────────────
  const msgs = await pageAll((f, t) => svc
    .from("campaign_messages")
    .select("lead_id, channel, company_bio_id, sent_at")
    .in("company_bio_id", bioIds)
    .eq("status", "sent")
    .gte("sent_at", prevStart)
    .range(f, t));

  const repliesAll = await pageAll((f, t) => svc
    .from("lead_replies")
    .select("lead_id, classification, received_at, leads!inner(company_bio_id)")
    .in("leads.company_bio_id" as string, bioIds)
    .gte("received_at", prevStart)
    .range(f, t));

  const calls = await pageAll((f, t) => svc
    .from("calls")
    .select("lead_id, started_at, created_at, dialed_by_user_id, seller_id, leads!inner(company_bio_id)")
    .in("leads.company_bio_id" as string, bioIds)
    .gte("created_at", prevStart)
    .range(f, t));

  // ── Cumulative (all-time) ───────────────────────────────────────────────
  const campaigns = await pageAll((f, t) => svc
    .from("campaigns")
    .select("lead_id, company_bio_id, status, seller_id")
    .in("company_bio_id", bioIds)
    .range(f, t));

  const leads = await pageAll((f, t) => svc
    .from("leads")
    .select("id, company_bio_id, status, transferred_to_odoo_at")
    .in("company_bio_id", bioIds)
    .range(f, t));

  const allPos = await pageAll((f, t) => svc
    .from("lead_replies")
    .select("lead_id, leads!inner(company_bio_id)")
    .in("leads.company_bio_id" as string, bioIds)
    .in("classification", ["positive", "meeting_intent"])
    .range(f, t));

  // ── Aggregate per tenant ────────────────────────────────────────────────
  // lead -> seller_id (first campaign wins) for attributing calls/replies.
  const leadSeller = new Map<string, string>();
  for (const c of campaigns) {
    const lid = c.lead_id as string | null, sid = c.seller_id as string | null;
    if (lid && sid && !leadSeller.has(lid)) leadSeller.set(lid, sid);
  }

  type SellerStat = { name: string; calls: number; replies: number; positives: number; _leads: Set<string> };
  type Acc = PortfolioCompany & {
    _cThis: Set<string>; _cPrev: Set<string>; _ch: Record<string, { m: number; leads: Set<string> }>;
    _active: Set<string>; _opp: Set<string>; _seenCall: Set<string>; _callLeads: Set<string>;
    _sellers: Record<string, SellerStat>;
  };
  const blank = (): PortfolioCompany => ({
    bioId: "", name: "",
    contacted: 0, contactedPrev: 0, messages: 0, messagesPrev: 0,
    calls: 0, callsPrev: 0, replies: 0, repliesPrev: 0, positives: 0, positivesPrev: 0,
    meetings: 0, meetingsPrev: 0, winsPeriod: 0, winsPeriodPrev: 0,
    byChannel: [], sellers: [], totalLeads: 0, activeLeads: 0, activeFlows: 0, opportunities: 0, wins: 0,
  });
  const acc: Record<string, Acc> = {};
  for (const b of bios) {
    acc[b.id] = Object.assign(blank(), {
      bioId: b.id, name: b.company_name,
      _cThis: new Set<string>(), _cPrev: new Set<string>(), _ch: {} as Record<string, { m: number; leads: Set<string> }>,
      _active: new Set<string>(), _opp: new Set<string>(), _seenCall: new Set<string>(), _callLeads: new Set<string>(),
      _sellers: {} as Record<string, SellerStat>,
    });
  }
  const sellerStat = (a: Acc, name: string): SellerStat => (a._sellers[name] ??= { name, calls: 0, replies: 0, positives: 0, _leads: new Set() });

  for (const m of msgs) {
    const a = acc[m.company_bio_id as string]; if (!a) continue;
    const lead = m.lead_id as string; const ch = (m.channel as string) || "otro";
    if (inThis(m.sent_at as string)) {
      a.messages++; a._cThis.add(lead);
      const c = (a._ch[ch] ??= { m: 0, leads: new Set() }); c.m++; c.leads.add(lead);
    } else if (inPrev(m.sent_at as string)) { a.messagesPrev++; a._cPrev.add(lead); }
  }

  const bioOf = (r: Row): string | undefined => {
    const j = r.leads as { company_bio_id?: string } | { company_bio_id?: string }[] | undefined;
    if (Array.isArray(j)) return j[0]?.company_bio_id;
    return j?.company_bio_id;
  };

  for (const r of repliesAll) {
    const a = acc[bioOf(r) as string]; if (!a) continue;
    const cls = (r.classification as string) || "";
    const isPos = POS.has(cls); const isMeet = cls === "meeting_intent";
    if (inThis(r.received_at as string)) {
      a.replies++; if (isPos) a.positives++; if (isMeet) a.meetings++;
      const ls = leadSeller.get(r.lead_id as string);
      const nm = ls && sidName.has(ls) ? sidName.get(ls)! : "__unassigned__";
      const st = sellerStat(a, nm); st.replies++; if (isPos) st.positives++;
    } else if (inPrev(r.received_at as string)) { a.repliesPrev++; if (isPos) a.positivesPrev++; if (isMeet) a.meetingsPrev++; }
  }

  const callSeller = (c: Row): string => {
    const uid = c.dialed_by_user_id as string | null;
    if (uid && uidName.has(uid)) return uidName.get(uid)!;
    const sid = c.seller_id as string | null;
    if (sid && sidName.has(sid)) return sidName.get(sid)!;
    const ls = leadSeller.get(c.lead_id as string);
    if (ls && sidName.has(ls)) return sidName.get(ls)!;
    return "__unassigned__";
  };
  for (const c of calls) {
    const a = acc[bioOf(c) as string]; if (!a) continue;
    const lead = c.lead_id as string;
    const ts = (c.started_at as string) || (c.created_at as string);
    const key = minuteKey(lead, ts);
    if (a._seenCall.has(key)) continue;
    a._seenCall.add(key);
    if (inThis(c.created_at as string)) {
      a.calls++; a._callLeads.add(lead);
      const st = sellerStat(a, callSeller(c)); st.calls++; st._leads.add(lead);
    } else if (inPrev(c.created_at as string)) a.callsPrev++;
  }

  for (const c of campaigns) {
    const a = acc[c.company_bio_id as string]; if (!a) continue;
    if (c.status === "active" || c.status === "paused") {
      a.activeFlows++;
      if (c.lead_id) a._active.add(c.lead_id as string);
    }
  }
  for (const l of leads) {
    const a = acc[l.company_bio_id as string]; if (!a) continue;
    a.totalLeads++;
    const odoo = l.transferred_to_odoo_at as string | null;
    if (odoo || l.status === "closed_won" || l.status === "qualified") a.wins++;
    // Wins THIS period — only the Odoo transfer is timestamped, so window on it.
    if (inThis(odoo)) a.winsPeriod++;
    else if (inPrev(odoo)) a.winsPeriodPrev++;
  }
  for (const r of allPos) {
    const a = acc[bioOf(r) as string]; if (!a) continue;
    a._opp.add(r.lead_id as string);
  }

  return bios.map(b => {
    const a = acc[b.id];
    a.contacted = a._cThis.size; a.contactedPrev = a._cPrev.size;
    a.activeLeads = a._active.size; a.opportunities = a._opp.size;
    a.byChannel = Object.entries(a._ch)
      // Drop campaign_messages' own 'call' rows — those are queued call-step
      // markers, NOT real calls. Real calls come from the calls table below,
      // so keeping both produced a duplicate "Call" row. (Fix 2026-06-18)
      .filter(([channel]) => channel !== "call")
      .map(([channel, v]) => ({ channel, messages: v.m, leads: v.leads.size }));
    // Calls aren't campaign_messages — append the real (deduped) call count so
    // the breakdown isn't "email only" when a tenant also dialed (Arqy).
    if (a.calls > 0) a.byChannel.push({ channel: "call", messages: a.calls, leads: a._callLeads.size });
    a.byChannel.sort((x, y) => y.messages - x.messages);
    a.sellers = Object.values(a._sellers)
      .map(s => ({ name: s.name, calls: s.calls, leads: s._leads.size, replies: s.replies, positives: s.positives }))
      .filter(s => s.calls > 0 || s.replies > 0)
      .sort((x, y) => y.calls - x.calls || y.replies - x.replies);
    const { _cThis, _cPrev, _ch, _active, _opp, _seenCall, _callLeads, _sellers, ...clean } = a;
    return clean as PortfolioCompany;
  });
}
