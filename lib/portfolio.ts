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
  byChannel: { channel: string; messages: number; leads: number }[];
  // Cumulative pipeline (all-time).
  totalLeads: number;
  activeLeads: number;
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
  const thisStart = new Date(now - days * 86400000).toISOString();
  const prevStart = new Date(now - 2 * days * 86400000).toISOString();
  const inThis = (ts: string | null) => !!ts && ts >= thisStart;
  const inPrev = (ts: string | null) => !!ts && ts >= prevStart && ts < thisStart;

  const { data: biosRaw } = await svc
    .from("company_bios")
    .select("id, company_name")
    .is("archived_at", null)
    .order("company_name");
  const bios = (biosRaw ?? []) as { id: string; company_name: string }[];
  const bioIds = bios.map(b => b.id);
  if (bioIds.length === 0) return [];

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
    .select("lead_id, started_at, created_at, leads!inner(company_bio_id)")
    .in("leads.company_bio_id" as string, bioIds)
    .gte("created_at", prevStart)
    .range(f, t));

  // ── Cumulative (all-time) ───────────────────────────────────────────────
  const campaigns = await pageAll((f, t) => svc
    .from("campaigns")
    .select("lead_id, company_bio_id, status")
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
  const leadBio = new Map<string, string>(); // lead_id -> bio (from leads)
  for (const l of leads) leadBio.set(l.id as string, l.company_bio_id as string);

  const blank = (): PortfolioCompany => ({
    bioId: "", name: "",
    contacted: 0, contactedPrev: 0, messages: 0, messagesPrev: 0,
    calls: 0, callsPrev: 0, replies: 0, repliesPrev: 0, positives: 0, positivesPrev: 0,
    byChannel: [], totalLeads: 0, activeLeads: 0, opportunities: 0, wins: 0,
  });
  const acc: Record<string, PortfolioCompany & { _cThis: Set<string>; _cPrev: Set<string>; _ch: Record<string, { m: number; leads: Set<string> }>; _active: Set<string>; _opp: Set<string>; _seenCall: Set<string> }> = {};
  for (const b of bios) {
    acc[b.id] = Object.assign(blank(), { bioId: b.id, name: b.company_name, _cThis: new Set<string>(), _cPrev: new Set<string>(), _ch: {} as Record<string, { m: number; leads: Set<string> }>, _active: new Set<string>(), _opp: new Set<string>(), _seenCall: new Set<string>() });
  }

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
    if (inThis(r.received_at as string)) { a.replies++; if (POS.has((r.classification as string) || "")) a.positives++; }
    else if (inPrev(r.received_at as string)) { a.repliesPrev++; if (POS.has((r.classification as string) || "")) a.positivesPrev++; }
  }

  for (const c of calls) {
    const a = acc[bioOf(c) as string]; if (!a) continue;
    const ts = (c.started_at as string) || (c.created_at as string);
    const key = minuteKey(c.lead_id as string, ts);
    if (a._seenCall.has(key)) continue;
    a._seenCall.add(key);
    if (inThis(c.created_at as string)) a.calls++;
    else if (inPrev(c.created_at as string)) a.callsPrev++;
  }

  for (const c of campaigns) {
    const a = acc[c.company_bio_id as string]; if (!a) continue;
    if ((c.status === "active" || c.status === "paused") && c.lead_id) a._active.add(c.lead_id as string);
  }
  for (const l of leads) {
    const a = acc[l.company_bio_id as string]; if (!a) continue;
    a.totalLeads++;
    if (l.transferred_to_odoo_at || l.status === "closed_won" || l.status === "qualified") a.wins++;
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
      .map(([channel, v]) => ({ channel, messages: v.m, leads: v.leads.size }))
      .sort((x, y) => y.messages - x.messages);
    const { _cThis, _cPrev, _ch, _active, _opp, _seenCall, ...clean } = a;
    return clean as PortfolioCompany;
  });
}
