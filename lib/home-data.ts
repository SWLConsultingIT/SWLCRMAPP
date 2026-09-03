// Home ("Tu día") data — the 4 action buckets + top-3 priorities, scoped to the
// tenant and, for seller-tier users, to their own assigned work.
//
// The bucket definitions are the SAME battle-tested rules as the dashboard's
// `todayLists` (lib/dashboard-data.ts) so the numbers never disagree:
//   · replies   → inbound replies pending human review (NOT call-outcome rows)
//   · calls     → canonical /queue "to call" predicate (lib/pending-calls)
//   · followup  → contacted ≥7d ago, never replied, no recent touch ("Sin seguimiento")
//   · unassigned→ leads not enrolled in any campaign
//
// Fetches are bio-scoped and paginated (lib/supabase-bulk) so they never hit
// the PostgREST 1000-row cap. Kept separate from getDashboardData so the Home
// stays light and fast (it must not run the 24 analytics aggregations).

import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, getMyAssignedSellerIds } from "@/lib/scope";
import { selectAllPages } from "@/lib/supabase-bulk";
import { computePendingCalls, type PendingCallCampaign, type PendingCallLead } from "@/lib/pending-calls";

const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);

export type HomeCounts = { replies: number; positives: number; calls: number; unassigned: number };
export type HomePriority = {
  kind: "reply" | "call";
  leadId: string;
  name: string | null;
  company: string;
  detail: string | null;        // reply: the message snippet (language-neutral)
  overdueDays: number | null;   // call: days overdue (0 = due today) — formatted client-side for i18n
  tag: string | null;
  when: string | null;
};
export type HomeData = {
  firstName: string | null;
  scope: "seller" | "team";
  counts: HomeCounts;
  priorities: HomePriority[];
};

type LeadRow = {
  id: string; primary_first_name: string | null; primary_last_name: string | null;
  company_name: string | null; icp_profile_id: string | null;
  primary_phone: string | null; primary_secondary_phone: string | null; allow_call: boolean | null;
  created_at: string | null;
};
type CampRow = { id: string; lead_id: string | null; seller_id: string | null; status: string | null; current_step: number | null; sequence_steps: unknown; last_step_at: string | null };
type ReplyRow = { id: string; lead_id: string | null; classification: string | null; channel: string | null; received_at: string | null; requires_human_review: boolean | null; review_status: string | null; reply_text: string | null };
type MsgRow = { id: string; campaign_id: string | null; step_number: number | null; status: string | null; sent_at: string | null; channel: string | null };

export async function getHomeData(): Promise<HomeData> {
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId : null;
  const sellerIds = await getMyAssignedSellerIds(); // null = admin/owner/manager (whole team)
  const svc = getSupabaseService();

  // Greeting name — from the auth user's metadata (user_profiles has no name).
  let firstName: string | null = null;
  if (scope.userId) {
    try {
      const { data } = await svc.auth.admin.getUserById(scope.userId);
      const meta = data?.user?.user_metadata as Record<string, unknown> | undefined;
      const email = data?.user?.email as string | undefined;
      // Match /api/auth/me's display-name resolution (display_name is the primary
      // key the app stores names under; full_name/name were missing it).
      const nm = (meta?.display_name ?? meta?.name ?? meta?.full_name) as string | undefined;
      let first = nm ? nm.trim().split(/\s+/)[0] : "";
      if (!first && email) {
        const lp = email.split("@")[0].split(/[._-]+/)[0];
        first = lp ? lp.charAt(0).toUpperCase() + lp.slice(1) : "";
      }
      firstName = first || null;
    } catch { /* greeting falls back to no name */ }
  }

  const [leads, camps, replies, msgs] = await Promise.all([
    selectAllPages<LeadRow>("leads", () => {
      const q = svc.from("leads").select("id, primary_first_name, primary_last_name, company_name, icp_profile_id, primary_phone, primary_secondary_phone, allow_call, created_at, company_bio_id").order("id", { ascending: true });
      return (bioId ? q.eq("company_bio_id", bioId) : q) as never;
    }),
    selectAllPages<CampRow>("campaigns", () => {
      const q = svc.from("campaigns").select("id, lead_id, seller_id, status, current_step, sequence_steps, last_step_at, leads!inner(company_bio_id)").order("id", { ascending: true });
      return (bioId ? q.eq("leads.company_bio_id", bioId) : q) as never;
    }),
    selectAllPages<ReplyRow>("lead_replies", () => {
      const q = svc.from("lead_replies").select("id, lead_id, classification, channel, received_at, requires_human_review, review_status, reply_text, leads!inner(company_bio_id)").order("id", { ascending: true });
      return (bioId ? q.eq("leads.company_bio_id", bioId) : q) as never;
    }),
    selectAllPages<MsgRow>("campaign_messages", () => {
      const q = svc.from("campaign_messages").select("id, campaign_id, step_number, status, sent_at, channel, campaigns!inner(leads!inner(company_bio_id))").order("id", { ascending: true });
      return (bioId ? q.eq("campaigns.leads.company_bio_id", bioId) : q) as never;
    }),
  ]);

  const leadById = new Map(leads.map(l => [l.id, l]));

  // Seller scope: the set of leads owned by this seller's campaigns. null = team
  // (no restriction). Empty set = seller with no assignments → sees nothing.
  const sellerSet = new Set(sellerIds ?? []);
  const isSeller = sellerIds !== null;
  const myLeadIds: Set<string> | null = isSeller
    ? new Set(camps.filter(c => c.lead_id && c.seller_id && sellerSet.has(c.seller_id)).map(c => c.lead_id as string))
    : null;
  const mine = (leadId: string | null | undefined): boolean => !leadId ? false : (myLeadIds ? myLeadIds.has(leadId) : true);

  const repliedNonCallLeadIds = new Set<string>();
  for (const r of replies) if (r.lead_id && r.channel !== "call") repliedNonCallLeadIds.add(r.lead_id);

  // ── Replies bucket (pending review, non-call), newest first ──────────────
  const repliesSorted = [...replies].sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
  const repliesIds = new Set<string>();
  const positivesIds = new Set<string>();
  let topPositive: ReplyRow | null = null;
  for (const r of repliesSorted) {
    if (!r.lead_id || r.channel === "call" || !leadById.has(r.lead_id) || !mine(r.lead_id)) continue;
    const pending = r.requires_human_review === true || r.review_status === "pending";
    if (pending) repliesIds.add(r.lead_id);
    if (POSITIVE_CLASS.has(r.classification ?? "")) {
      positivesIds.add(r.lead_id);
      if (!topPositive && pending) topPositive = r;
    }
  }

  // ── Calls bucket (canonical pending-call predicate) ──────────────────────
  const handledCallStepsByCampaign = new Map<string, Set<number>>();
  for (const m of msgs) {
    if (m.channel !== "call" || !["sent", "skipped"].includes(m.status ?? "") || !m.campaign_id) continue;
    const set = handledCallStepsByCampaign.get(m.campaign_id) ?? new Set<number>();
    set.add(m.step_number as number);
    handledCallStepsByCampaign.set(m.campaign_id, set);
  }
  const callCamps = isSeller ? camps.filter(c => c.seller_id && sellerSet.has(c.seller_id)) : camps;
  const pendingCalls = computePendingCalls({
    campaigns: callCamps as unknown as PendingCallCampaign[],
    leadById: leadById as unknown as Map<string, PendingCallLead>,
    handledCallStepsByCampaign,
    repliedNonCallLeadIds,
    now: Date.now(),
  });
  const callLeadIds = new Set<string>();
  let topCall: { leadId: string; overdueDays: number } | null = null;
  for (const info of pendingCalls.values()) {
    if (!leadById.has(info.leadId) || callLeadIds.has(info.leadId)) continue;
    callLeadIds.add(info.leadId);
    if (!topCall || info.overdueDays > topCall.overdueDays) topCall = { leadId: info.leadId, overdueDays: info.overdueDays };
  }

  // ── Unassigned bucket (not in any campaign) — team-level (leads have no owner) ─
  const withCampaign = new Set<string>();
  for (const c of camps) if (c.lead_id) withCampaign.add(c.lead_id);
  const unassignedCount = isSeller ? 0 : leads.filter(l => !withCampaign.has(l.id)).length;

  // ── Top-3 priorities ─────────────────────────────────────────────────────
  const nameOf = (l: LeadRow | undefined) => l ? (`${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || null) : null;
  const priorities: HomePriority[] = [];
  if (topPositive?.lead_id) {
    const l = leadById.get(topPositive.lead_id);
    priorities.push({ kind: "reply", leadId: topPositive.lead_id, name: nameOf(l), company: l?.company_name ?? "—", detail: (topPositive.reply_text ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null, overdueDays: null, tag: "positive", when: topPositive.received_at });
  }
  if (topCall?.leadId) {
    const l = leadById.get(topCall.leadId);
    priorities.push({ kind: "call", leadId: topCall.leadId, name: nameOf(l), company: l?.company_name ?? "—", detail: null, overdueDays: topCall.overdueDays, tag: null, when: null });
  }
  return {
    firstName,
    scope: isSeller ? "seller" : "team",
    counts: {
      replies: repliesIds.size,
      positives: positivesIds.size,
      calls: callLeadIds.size,
      unassigned: unassignedCount,
    },
    priorities,
  };
}
