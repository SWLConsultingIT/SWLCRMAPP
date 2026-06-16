// Per-tenant reliability history — last 50 notable events, derived
// from existing tables (no new migration). Pulls:
//   • campaign_messages failures (status='failed' + error_details)
//   • inbound replies (lead_replies)
//   • notable sends (last few `sent` rows for context)
//   • seller cooldown entries (`last_rate_limit_at` set)
//
// Ordered by timestamp descending, capped at 50. The intent is "what
// happened in this tenant recently?", not a perfect audit log — if we
// need that, a `reliability_events` table is the next step.

import { getSupabaseService } from "@/lib/supabase-service";

const HISTORY_LIMIT = 50;
const WINDOW_DAYS = 7;

export type HistoryEvent = {
  type: "send" | "reply" | "failure" | "cooldown";
  occurredAt: string; // ISO
  leadName: string | null;
  campaignName: string | null;
  channel: string | null;
  detail: string | null; // error snippet / reply classification / etc.
};

export async function getTenantHistory(bioId: string): Promise<HistoryEvent[]> {
  const svc = getSupabaseService();
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

  const [sentRes, failedRes, repliesRes, cooldownRes] = await Promise.all([
    svc.from("campaign_messages")
      .select("id, channel, sent_at, leads!inner(company_bio_id, primary_first_name, primary_last_name, company_name), campaigns(name)")
      .eq("status", "sent")
      .gte("sent_at", since)
      .eq("leads.company_bio_id", bioId)
      .order("sent_at", { ascending: false })
      .limit(20),
    svc.from("campaign_messages")
      .select("id, channel, created_at, error_details, leads!inner(company_bio_id, primary_first_name, primary_last_name, company_name), campaigns(name)")
      .eq("status", "failed")
      .gte("created_at", since)
      .eq("leads.company_bio_id", bioId)
      .order("created_at", { ascending: false })
      .limit(30),
    svc.from("lead_replies")
      .select("id, channel, received_at, classification, leads!inner(company_bio_id, primary_first_name, primary_last_name, company_name), campaigns(name)")
      .gte("received_at", since)
      .eq("leads.company_bio_id", bioId)
      .order("received_at", { ascending: false })
      .limit(30),
    svc.from("sellers")
      .select("id, name, last_rate_limit_at, company_bio_id, shared_with_company_bio_ids")
      .gte("last_rate_limit_at", since)
      .order("last_rate_limit_at", { ascending: false })
      .limit(30),
  ]);

  type LeadJoin = { primary_first_name: string | null; primary_last_name: string | null; company_name: string | null } | null;
  type CampJoin = { name: string | null } | null;
  const leadName = (l: LeadJoin) => {
    if (!l) return null;
    const n = ((l.primary_first_name ?? "") + " " + (l.primary_last_name ?? "")).trim();
    return n || l.company_name;
  };

  const events: HistoryEvent[] = [];

  for (const r of (((sentRes.data ?? []) as unknown) as Array<{ channel: string | null; sent_at: string | null; leads: LeadJoin; campaigns: CampJoin }>).slice(0, 10)) {
    if (!r.sent_at) continue;
    events.push({ type: "send", occurredAt: r.sent_at, leadName: leadName(r.leads), campaignName: r.campaigns?.name ?? null, channel: r.channel, detail: null });
  }
  for (const r of ((failedRes.data ?? []) as unknown) as Array<{ channel: string | null; created_at: string | null; error_details: string | null; leads: LeadJoin; campaigns: CampJoin }>) {
    if (!r.created_at) continue;
    events.push({ type: "failure", occurredAt: r.created_at, leadName: leadName(r.leads), campaignName: r.campaigns?.name ?? null, channel: r.channel, detail: (r.error_details ?? "").slice(0, 140) });
  }
  for (const r of ((repliesRes.data ?? []) as unknown) as Array<{ channel: string | null; received_at: string | null; classification: string | null; leads: LeadJoin; campaigns: CampJoin }>) {
    if (!r.received_at) continue;
    events.push({ type: "reply", occurredAt: r.received_at, leadName: leadName(r.leads), campaignName: r.campaigns?.name ?? null, channel: r.channel, detail: r.classification ?? null });
  }
  // Cooldown events: include only sellers that are owned by or shared with this bio.
  for (const s of (cooldownRes.data ?? []) as Array<{ name: string; last_rate_limit_at: string | null; company_bio_id: string | null; shared_with_company_bio_ids: string[] | null }>) {
    if (!s.last_rate_limit_at) continue;
    const isOwn = s.company_bio_id === bioId;
    const isShared = Array.isArray(s.shared_with_company_bio_ids) && s.shared_with_company_bio_ids.includes(bioId);
    if (!isOwn && !isShared) continue;
    events.push({ type: "cooldown", occurredAt: s.last_rate_limit_at, leadName: null, campaignName: null, channel: null, detail: `Seller ${s.name} → cooldown` });
  }

  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return events.slice(0, HISTORY_LIMIT);
}
