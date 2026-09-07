// ─────────────────────────────────────────────────────────────────────────
// Static data for the five non-Overview tabs. Same contract as ./data.ts:
// every figure measured against the SWL Consulting tenant on 2026-09-07 and
// scoped to 8 Aug – 7 Sep 2026, EXCEPT where a row says otherwise.
//
// THE DEFINITION THIS FILE IS BUILT ON, and the one the live dashboard does
// not use: the period means ACTIVITY IN THE PERIOD, not leads loaded in the
// period. `lib/dashboard-data.ts:378` windows `leads.created_at` and then
// counts lifetime activity for whatever survives, which on a 30-day view
// erases four of the eight ICPs from the screen — including the best one.
//
// ── THREE CORRECTIONS made on 2026-09-07 after re-measuring ──────────────
//
// 1. CALLS. Dedup by lead+minute must PREFER THE REAL ROW over the
//    click-to-dial marker written at the same minute; taking whichever came
//    first threw real calls away. 562 rows → 354 after dedup → 282 real
//    calls, 123 connected (43.6%), 139 recorded, 78 with no outcome. The
//    earlier 189/75 was the first-row-wins artefact.
//
// 2. POSITIVE IS 1, NOT 0. One reply on 6 Sep on LinkedIn is classified
//    positive, and that lead IS inside the contacted-in-period cohort.
//
// 3. "FOLLOWED UP" IS NOT A FUNNEL STAGE. A reply stops the flow, so only
//    34 of the 65 leads that replied ever received a second message. It is
//    not a superset of Replied and cannot sit between it and Contacted.
//
// CALLS ARE NOT `campaign_messages`. They live in `calls` and attach to a
// flow through the lead, which is why a flow's channel mix shows no call
// segment while its call count is non-zero.
// ─────────────────────────────────────────────────────────────────────────

import type { Delta } from "./ui";

export const TABS = ["Overview", "ICPs", "Campaigns", "Channels", "Sellers", "Portfolio"] as const;
export type Tab = (typeof TABS)[number];

/** The four things we can do to a lead. One order, one colour, everywhere. */
export const CH_KEYS = ["li_cr", "li_dm", "email", "call"] as const;
export type ChKey = (typeof CH_KEYS)[number];
export type Touch = Record<ChKey, number>;

/* ═══ ICPs ════════════════════════════════════════════════════════════════
   `touch` = how many contact points went out on that channel (messages, and
   for calls, real dials). `reach` = how many distinct leads that was. Both
   are shown because "1,570 emails to 1,064 leads" is a different fact from
   either number alone — it is the follow-up depth. */

export type IcpRow = {
  name: string;
  contacted: number; replies: number; positive: number; rate: number;
  touch: Touch;
  reach: Touch;
  /** Of the leads reached on that channel, how many replied at all. */
  replied: Touch;
};

export const icps: IcpRow[] = [
  { name: "Odoo Implementation — Argentina", contacted: 95, replies: 9, positive: 0, rate: 9.5,
    touch: { li_cr: 71, li_dm: 38, email: 89, call: 18 },
    reach: { li_cr: 71, li_dm: 26, email: 89, call: 13 },
    replied: { li_cr: 8, li_dm: 8, email: 4, call: 3 } },
  { name: "Spanish Speaking Growth AI Sales", contacted: 204, replies: 16, positive: 0, rate: 7.8,
    touch: { li_cr: 198, li_dm: 115, email: 389, call: 148 },
    reach: { li_cr: 198, li_dm: 66, email: 203, call: 47 },
    replied: { li_cr: 16, li_dm: 15, email: 15, call: 6 } },
  { name: "UK Growth AI Sales", contacted: 309, replies: 19, positive: 0, rate: 6.1,
    touch: { li_cr: 0, li_dm: 33, email: 301, call: 0 },
    reach: { li_cr: 0, li_dm: 31, email: 301, call: 0 },
    replied: { li_cr: 0, li_dm: 2, email: 19, call: 0 } },
  { name: "Private Equity & VC Firms — Spain", contacted: 225, replies: 12, positive: 0, rate: 5.3,
    touch: { li_cr: 2, li_dm: 10, email: 431, call: 1 },
    reach: { li_cr: 2, li_dm: 7, email: 223, call: 1 },
    replied: { li_cr: 0, li_dm: 2, email: 12, call: 0 } },
  { name: "Italy Growth AI Sales", contacted: 42, replies: 2, positive: 0, rate: 4.8,
    touch: { li_cr: 3, li_dm: 0, email: 76, call: 36 },
    reach: { li_cr: 3, li_dm: 0, email: 42, call: 26 },
    replied: { li_cr: 0, li_dm: 0, email: 2, call: 0 } },
  { name: "Solar & Renewable Energy — USA", contacted: 105, replies: 2, positive: 0, rate: 1.9,
    touch: { li_cr: 36, li_dm: 14, email: 102, call: 1 },
    reach: { li_cr: 36, li_dm: 9, email: 102, call: 1 },
    replied: { li_cr: 1, li_dm: 1, email: 1, call: 1 } },
  { name: "Natural Ingredients USA", contacted: 242, replies: 1, positive: 0, rate: 0.4,
    touch: { li_cr: 118, li_dm: 0, email: 247, call: 30 },
    reach: { li_cr: 118, li_dm: 0, email: 241, call: 30 },
    replied: { li_cr: 1, li_dm: 0, email: 1, call: 0 } },
  { name: "Private Equity & VC Firms — USA", contacted: 1073, replies: 4, positive: 1, rate: 0.4,
    touch: { li_cr: 149, li_dm: 25, email: 1570, call: 48 },
    reach: { li_cr: 149, li_dm: 25, email: 1064, call: 41 },
    replied: { li_cr: 1, li_dm: 2, email: 4, call: 1 } },
];

export const icpsTotals = {
  contacted: 2295, replies: 65, positive: 1, rate: 2.8,
  touch: { li_cr: 577, li_dm: 235, email: 3205, call: 282 } as Touch,
};

export const icpsNote =
  "Eight ICPs sent in this period and all eight are listed — none is hidden behind a volume floor. The cohort is the 2,295 leads contacted in the window, so an ICP whose leads were loaded months ago still appears.";

export const icpTouchNote =
  "Contact points, not leads: the large number is how many went out, the small one how many distinct people received them. 1,570 emails to 1,064 leads in PE & VC — USA means most of that ICP got a follow-up; 89 emails to 89 leads in Odoo means nobody did. Calls come from the calls table rather than the sequence, which is why a flow can show calls without having a call step.";

export const icpMatrixNote =
  "Read a cell as: of the leads this ICP reached on that channel, how many replied at all. A lead reached on both LinkedIn and email is counted in both columns, so the columns do not add up to the ICP total — a multichannel flow touches the same person twice and the grid shows it rather than picking one.";

export const icpWorthALook = {
  title: "The two ICPs with the highest reply rate are the two smallest",
  facts: [
    "Odoo — Argentina: 9 of 95 contacted replied (9.5%), the highest rate of the eight, on 216 contact points.",
    "Private Equity & VC — USA: 4 of 1,073 contacted replied (0.4%), on 1,792 contact points — 42% of everything that went out.",
    "Spanish Speaking Growth AI absorbed 148 of the 282 calls this period and replied at 7.8%.",
  ],
};

/* ═══ CAMPAIGNS ═══════════════════════════════════════════════════════════
   Grouped by ICP, because comparing a PE flow against an Odoo flow compares
   two different markets. Within a group the rates are like-for-like. */

export type Step = { step: number; ch: ChKey; sent: number; leads: number; replied: number };

export type CampaignRow = {
  name: string; icp: string; status: "active" | "paused" | "completed";
  enrolled: number; contacted: number; followed: number;
  replies: number; positive: number; calls: number; connected: number;
  rate: number;
  touch: Touch;
  steps: Step[];
};

export const campaigns: CampaignRow[] = [
  { name: "Odoo Implementation — Argentina · Multicanal", icp: "Odoo Implementation — Argentina",
    status: "active", enrolled: 99, contacted: 97, followed: 75, replies: 9, positive: 0, calls: 20, connected: 14, rate: 9.3,
    touch: { li_cr: 72, li_dm: 38, email: 91, call: 20 },
    steps: [
      { step: 0, ch: "li_cr", sent: 72, leads: 72, replied: 8 },
      { step: 2, ch: "li_dm", sent: 12, leads: 12, replied: 5 },
      { step: 4, ch: "email", sent: 91, leads: 91, replied: 4 },
      { step: 5, ch: "li_dm", sent: 22, leads: 22, replied: 4 },
    ] },
  { name: "Growth AI Sales — LATAM", icp: "Spanish Speaking Growth AI Sales",
    status: "active", enrolled: 221, contacted: 202, followed: 199, replies: 16, positive: 0, calls: 114, connected: 45, rate: 7.9,
    touch: { li_cr: 197, li_dm: 115, email: 387, call: 114 },
    steps: [
      { step: 0, ch: "li_cr", sent: 197, leads: 197, replied: 16 },
      { step: 1, ch: "email", sent: 201, leads: 201, replied: 15 },
      { step: 2, ch: "li_dm", sent: 54, leads: 54, replied: 13 },
      { step: 4, ch: "email", sent: 186, leads: 186, replied: 6 },
      { step: 5, ch: "li_dm", sent: 54, leads: 54, replied: 4 },
    ] },
  { name: "UK Growth AI Sales · Multichannel Vol I", icp: "UK Growth AI Sales",
    status: "active", enrolled: 398, contacted: 309, followed: 23, replies: 19, positive: 0, calls: 0, connected: 0, rate: 6.1,
    touch: { li_cr: 0, li_dm: 33, email: 301, call: 0 },
    steps: [
      { step: 1, ch: "email", sent: 100, leads: 100, replied: 2 },
      { step: 2, ch: "li_dm", sent: 1, leads: 1, replied: 0 },
      { step: 4, ch: "email", sent: 201, leads: 201, replied: 17 },
      { step: 5, ch: "li_dm", sent: 29, leads: 29, replied: 2 },
    ] },
  { name: "Private Equity & VC Firms — Spain · Multichannel", icp: "Private Equity & VC Firms — Spain",
    status: "active", enrolled: 381, contacted: 225, followed: 212, replies: 12, positive: 0, calls: 0, connected: 0, rate: 5.3,
    touch: { li_cr: 2, li_dm: 10, email: 431, call: 0 },
    steps: [
      { step: 0, ch: "li_cr", sent: 2, leads: 2, replied: 0 },
      { step: 1, ch: "email", sent: 223, leads: 223, replied: 12 },
      { step: 2, ch: "li_dm", sent: 7, leads: 7, replied: 2 },
      { step: 4, ch: "email", sent: 208, leads: 208, replied: 2 },
      { step: 5, ch: "li_dm", sent: 3, leads: 3, replied: 0 },
    ] },
  { name: "Solar & Renewable Energy — USA · Multichannel", icp: "Solar & Renewable Energy — USA",
    status: "active", enrolled: 203, contacted: 105, followed: 39, replies: 2, positive: 0, calls: 1, connected: 0, rate: 1.9,
    touch: { li_cr: 36, li_dm: 14, email: 102, call: 1 },
    steps: [
      { step: 0, ch: "li_cr", sent: 36, leads: 36, replied: 1 },
      { step: 1, ch: "email", sent: 102, leads: 102, replied: 1 },
      { step: 2, ch: "li_dm", sent: 14, leads: 14, replied: 1 },
    ] },
  { name: "Natural Ingredients USA · LinkedIn + Email", icp: "Natural Ingredients USA",
    status: "active", enrolled: 243, contacted: 242, followed: 123, replies: 1, positive: 0, calls: 29, connected: 13, rate: 0.4,
    touch: { li_cr: 118, li_dm: 0, email: 247, call: 29 },
    steps: [
      { step: 0, ch: "li_cr", sent: 118, leads: 118, replied: 1 },
      { step: 1, ch: "email", sent: 241, leads: 241, replied: 1 },
      { step: 4, ch: "email", sent: 6, leads: 6, replied: 0 },
    ] },
  { name: "Private Equity & VC Firms — USA · Multichannel", icp: "Private Equity & VC Firms — USA",
    status: "active", enrolled: 1166, contacted: 1073, followed: 597, replies: 4, positive: 1, calls: 43, connected: 15, rate: 0.4,
    touch: { li_cr: 149, li_dm: 25, email: 1570, call: 43 },
    steps: [
      { step: 0, ch: "li_cr", sent: 149, leads: 149, replied: 1 },
      { step: 1, ch: "email", sent: 1064, leads: 1064, replied: 4 },
      { step: 2, ch: "li_dm", sent: 24, leads: 24, replied: 1 },
      { step: 4, ch: "email", sent: 506, leads: 506, replied: 0 },
    ] },
  { name: "CAMPAIGN_INSURANCE", icp: "Italy Growth AI Sales",
    status: "active", enrolled: 24, contacted: 18, followed: 16, replies: 2, positive: 0, calls: 0, connected: 0, rate: 11.1,
    touch: { li_cr: 1, li_dm: 0, email: 34, call: 0 },
    steps: [
      { step: 0, ch: "li_cr", sent: 1, leads: 1, replied: 0 },
      { step: 1, ch: "email", sent: 18, leads: 18, replied: 2 },
      { step: 4, ch: "email", sent: 16, leads: 16, replied: 1 },
    ] },
  { name: "CAMPAIGN_RE_ASSET_SGR", icp: "Italy Growth AI Sales",
    status: "active", enrolled: 24, contacted: 24, followed: 18, replies: 0, positive: 0, calls: 32, connected: 17, rate: 0,
    touch: { li_cr: 2, li_dm: 0, email: 42, call: 32 },
    steps: [
      { step: 0, ch: "li_cr", sent: 2, leads: 2, replied: 0 },
      { step: 1, ch: "email", sent: 24, leads: 24, replied: 0 },
      { step: 4, ch: "email", sent: 18, leads: 18, replied: 0 },
    ] },
];

/* ── What opens when you expand a flow. Everything below is measured on
      THAT FLOW'S OWN COHORT — the leads it contacted in the window — so the
      detail reconciles with the row above it rather than being a second,
      differently-scoped query. ─────────────────────────────────────────── */

export type FlowDetail = {
  /** Reply events by the channel they arrived on. */
  replyCh: { linkedin: number; email: number };
  /** Reply events by classification. */
  replyCls: { positive: number; needsInfo: number; followUp: number; negative: number };
  replyLeads: number; replyEvents: number;
  /** Median days from this flow's first message to that lead's first reply. */
  medianDays: number | null;
  calls: number; connected: number;
  callCls: { positive: number; needsInfo: number; followUp: number; negative: number; voicemail: number; wrongNumber: number; unclassified: number };
  /** Where the cohort stands now. */
  status: { active: number; completed: number; closedLost: number };
};

const FD = (d: Partial<FlowDetail> & { replyLeads: number; replyEvents: number }): FlowDetail => ({
  replyCh: { linkedin: 0, email: 0 },
  replyCls: { positive: 0, needsInfo: 0, followUp: 0, negative: 0 },
  medianDays: null, calls: 0, connected: 0,
  callCls: { positive: 0, needsInfo: 0, followUp: 0, negative: 0, voicemail: 0, wrongNumber: 0, unclassified: 0 },
  status: { active: 0, completed: 0, closedLost: 0 },
  ...d,
});

export const flowDetail: Record<string, FlowDetail> = {
  "Odoo Implementation — Argentina · Multicanal": FD({
    replyCh: { linkedin: 16, email: 0 },
    replyCls: { positive: 0, needsInfo: 3, followUp: 1, negative: 12 },
    replyLeads: 9, replyEvents: 16, medianDays: 2.5,
    calls: 20, connected: 14,
    callCls: { positive: 0, needsInfo: 0, followUp: 0, negative: 1, voicemail: 1, wrongNumber: 5, unclassified: 13 },
    status: { active: 4, completed: 90, closedLost: 3 },
  }),
  "Growth AI Sales — LATAM": FD({
    replyCh: { linkedin: 21, email: 0 },
    replyCls: { positive: 0, needsInfo: 5, followUp: 8, negative: 8 },
    replyLeads: 16, replyEvents: 21, medianDays: 3.0,
    calls: 114, connected: 45,
    callCls: { positive: 0, needsInfo: 0, followUp: 4, negative: 11, voicemail: 67, wrongNumber: 2, unclassified: 30 },
    status: { active: 9, completed: 186, closedLost: 7 },
  }),
  "UK Growth AI Sales · Multichannel Vol I": FD({
    replyCh: { linkedin: 3, email: 17 },
    replyCls: { positive: 0, needsInfo: 12, followUp: 3, negative: 5 },
    replyLeads: 19, replyEvents: 20, medianDays: 22.6,
    status: { active: 105, completed: 204, closedLost: 0 },
  }),
  "Private Equity & VC Firms — Spain · Multichannel": FD({
    replyCh: { linkedin: 3, email: 10 },
    replyCls: { positive: 0, needsInfo: 8, followUp: 3, negative: 2 },
    replyLeads: 12, replyEvents: 13, medianDays: 0.0,
    status: { active: 9, completed: 214, closedLost: 2 },
  }),
  "Solar & Renewable Energy — USA · Multichannel": FD({
    replyCh: { linkedin: 1, email: 1 },
    replyCls: { positive: 0, needsInfo: 1, followUp: 1, negative: 0 },
    replyLeads: 2, replyEvents: 2, medianDays: 19.5,
    calls: 1, connected: 0,
    callCls: { positive: 0, needsInfo: 0, followUp: 0, negative: 0, voicemail: 1, wrongNumber: 0, unclassified: 0 },
    status: { active: 2, completed: 103, closedLost: 0 },
  }),
  "Natural Ingredients USA · LinkedIn + Email": FD({
    replyCh: { linkedin: 2, email: 0 },
    replyCls: { positive: 0, needsInfo: 2, followUp: 0, negative: 0 },
    replyLeads: 1, replyEvents: 2, medianDays: 3.0,
    calls: 29, connected: 13,
    callCls: { positive: 0, needsInfo: 0, followUp: 12, negative: 1, voicemail: 14, wrongNumber: 2, unclassified: 0 },
    status: { active: 117, completed: 124, closedLost: 1 },
  }),
  "Private Equity & VC Firms — USA · Multichannel": FD({
    replyCh: { linkedin: 2, email: 2 },
    replyCls: { positive: 1, needsInfo: 0, followUp: 1, negative: 2 },
    replyLeads: 4, replyEvents: 4, medianDays: 2.7,
    calls: 43, connected: 15,
    callCls: { positive: 0, needsInfo: 0, followUp: 0, negative: 1, voicemail: 27, wrongNumber: 1, unclassified: 14 },
    status: { active: 541, completed: 529, closedLost: 3 },
  }),
  "CAMPAIGN_INSURANCE": FD({
    replyCh: { linkedin: 0, email: 2 },
    replyCls: { positive: 0, needsInfo: 0, followUp: 0, negative: 2 },
    replyLeads: 2, replyEvents: 2, medianDays: 0.0,
    status: { active: 16, completed: 1, closedLost: 1 },
  }),
  "CAMPAIGN_RE_ASSET_SGR": FD({
    replyLeads: 0, replyEvents: 0,
    calls: 32, connected: 17,
    callCls: { positive: 0, needsInfo: 2, followUp: 5, negative: 2, voicemail: 9, wrongNumber: 6, unclassified: 8 },
    status: { active: 22, completed: 0, closedLost: 2 },
  }),
};

export const flowDetailNote =
  "Everything in here is measured on this flow's own cohort — the leads it contacted in the window — so it reconciles with the row above. Median days is from this flow's first message to that lead to their first reply. Calls attach to the flow through the lead, not through a step, which is why a flow with no call step can still show dials. 8 of the 282 calls belong to flows that sent nothing this period and appear on none of these rows.";

/** The rate floor: below this a flow shows counts but no percentage. */
export const RATE_FLOOR = 25;

/** ICP → its flows. Groups ranked by the ICP's own reply rate. */
export const campaignGroups = (() => {
  const by = new Map<string, CampaignRow[]>();
  for (const c of campaigns) {
    if (!by.has(c.icp)) by.set(c.icp, []);
    by.get(c.icp)!.push(c);
  }
  return [...by.entries()].map(([icp, flows]) => {
    const contacted = flows.reduce((a, f) => a + f.contacted, 0);
    const replies = flows.reduce((a, f) => a + f.replies, 0);
    const calls = flows.reduce((a, f) => a + f.calls, 0);
    const touch = flows.reduce((a, f) => {
      for (const k of CH_KEYS) a[k] += f.touch[k];
      return a;
    }, { li_cr: 0, li_dm: 0, email: 0, call: 0 } as Touch);
    return {
      icp, flows, contacted, replies, calls, touch,
      rate: contacted ? +((replies / contacted) * 100).toFixed(1) : 0,
    };
  }).sort((a, b) => b.rate - a.rate);
})();

export const campaignsNote =
  "Nine flows sent in this period, grouped by the ICP they target — a rate is only comparable against another flow aimed at the same market. Flows under 25 leads contacted show their counts but no rate. Every flow is marked active, so status is not a filter worth offering yet.";

export const stepsNote =
  "A step figure is: of the leads that received this step, how many replied at any point afterwards. It is not attribution — a lead reached on four steps counts on all four. Read the shape of the sequence, not the individual number. Manual seller replies (step −1) are excluded because they only exist after a lead has already replied.";

export const campaignsRemoved =
  "Won and Lost are not shown. The won status has never been set on any flow, so the tile was always 0; lost mixes a negative reply with a manually closed lead, which are two different events under one number.";

/* ═══ CHANNELS ════════════════════════════════════════════════════════════
   Four cards, because four is how many things we can do to a lead, and the
   card is the right object: each channel keeps its own numerator, its own
   denominator and its own outcome mix, side by side, with nothing forced
   onto a shared scale. The head-to-head underneath ranks ONLY the two that
   are the same measurement. */

export type ChannelCard = {
  key: ChKey; label: string; icon: "in" | "dm" | "email" | "call";
  sent: number; sentLabel: string;
  reach: number; reachLabel: string;
  result: number; resultLabel: string;
  rate: number; rateLabel: string;
  delta: Delta;
  comparable: boolean;
  outcomes: { label: string; n: number; tone: "good" | "info" | "neutral" | "bad" | "muted" }[];
  caveat: string;
};

export const channelCards: ChannelCard[] = [
  { key: "li_cr", label: "LinkedIn invitation", icon: "in",
    sent: 577, sentLabel: "invitations sent", reach: 575, reachLabel: "leads invited",
    result: 16, resultLabel: "accepted", rate: 2.8, rateLabel: "accept rate", delta: null, comparable: false,
    outcomes: [
      { label: "Accepted", n: 16, tone: "good" },
      { label: "Pending or declined", n: 559, tone: "muted" },
    ],
    caveat: "Acceptance has no timestamp, so this is anchored on the invitation date and counted as of today. An accept rate is not a reply rate." },
  { key: "li_dm", label: "LinkedIn DM", icon: "dm",
    sent: 235, sentLabel: "messages sent", reach: 160, reachLabel: "leads reached",
    result: 28, resultLabel: "replied", rate: 17.5, rateLabel: "reply rate",
    delta: { v: 12.2, unit: "pp" }, comparable: true,
    outcomes: [
      { label: "Interested", n: 1, tone: "good" },
      { label: "Needs info", n: 14, tone: "info" },
      { label: "Follow up", n: 10, tone: "neutral" },
      { label: "Not interested", n: 23, tone: "bad" },
    ],
    caveat: "A DM only goes out after an invitation was accepted, so its audience is pre-qualified — part of why the rate is high." },
  { key: "email", label: "Email", icon: "email",
    sent: 3205, sentLabel: "emails sent", reach: 2265, reachLabel: "leads reached",
    result: 32, resultLabel: "replied", rate: 1.4, rateLabel: "reply rate",
    delta: { v: -0.8, unit: "pp" }, comparable: true,
    outcomes: [
      { label: "Interested", n: 0, tone: "good" },
      { label: "Needs info", n: 17, tone: "info" },
      { label: "Follow up", n: 7, tone: "neutral" },
      { label: "Not interested", n: 9, tone: "bad" },
    ],
    caveat: "94% of everything that goes out. 3,205 emails to 2,265 leads means most of the list received a follow-up." },
  { key: "call", label: "Calls", icon: "call",
    sent: 282, sentLabel: "real dials", reach: 236, reachLabel: "leads dialled",
    result: 123, resultLabel: "connected", rate: 43.6, rateLabel: "connect rate",
    delta: null, comparable: false,
    outcomes: [
      { label: "Interested", n: 1, tone: "good" },
      { label: "Needs info", n: 4, tone: "info" },
      { label: "Follow up", n: 22, tone: "neutral" },
      { label: "Not interested", n: 18, tone: "bad" },
      { label: "Voicemail", n: 143, tone: "muted" },
      { label: "Wrong number", n: 16, tone: "muted" },
      { label: "No outcome logged", n: 78, tone: "muted" },
    ],
    caveat: "A connect rate is not a reply rate. 72 click-to-dial markers were removed; 78 real dials have no outcome logged and stay in the denominator." },
];

export const channelWhatsApp =
  "WhatsApp is wired end-to-end but sent nothing in this period, so it has no card rather than a card of zeros.";

export const headToHeadNote =
  "Only LinkedIn DM and Email are ranked here: same measurement, same window, same unit — leads that replied over leads reached. Invitation acceptance and call connect rate are real numbers with real bases, but they measure different events, so putting all four on one axis would invite a comparison none of them can carry.";

export const channelWorthALook = {
  title: "Email carries 94% of the volume and 49% of the replies",
  facts: [
    "Email: 3,205 messages reached 2,265 leads; 32 replied (1.4%).",
    "LinkedIn DM: 235 messages reached 160 leads; 28 replied (17.5%).",
    "The two are the same measurement over the same window, so the 12.2 pp gap is like-for-like. What it does not say is why — a DM only goes out after an invitation was accepted, so the people who receive one are not the same population as the people who receive an email.",
  ],
};

/* ═══ SELLERS ═════════════════════════════════════════════════════════════
   The team control centre. Six levels: team health · seller performance ·
   compare · calls · consistency · insights.

   QUEUE, and why the number is not the obvious one. `campaign_messages` has
   9,366 rows that are not `sent`: 5,825 `draft` (later steps of a sequence
   that is not due yet — not a backlog) and 3,541 `queued`, of which only
   1,734 sit in a flow that is still `active`. The other 1,807 are queued
   inside paused or finished flows and will never go out. So Queue = queued
   in an active flow. It is CURRENT STOCK, not period activity, and it is
   labelled as such wherever it appears.

   ATTRIBUTION. Everything here is attributed by the flow's LinkedIn sender,
   except calls, which use the dialler first. 65 of the 66 leads that replied
   in the period are attributable; the one that is not is reported on its own
   and never spread across the rows. */

export type Seller = {
  name: string;
  contacted: number;
  /** Contact points, not leads. li = cr + dm. */
  li: number; cr: number; dm: number; email: number;
  sent: number;
  calls: number;
  replies: number; replyRate: number;
  positive: number;
  /** queued messages sitting in a flow that is still active — current stock */
  queue: number;
  lastActive: string;
};

export const sellers: Seller[] = [
  { name: "Juan",              contacted: 1299, li: 204, cr: 159, dm: 45, email: 1793, sent: 1997, calls: 29,  replies: 19, replyRate: 1.5, positive: 1, queue: 1362, lastActive: "6 Sep" },
  { name: "Lucho",             contacted: 519,  li: 163, cr: 146, dm: 17, email: 729,  sent: 892,  calls: 51,  replies: 14, replyRate: 2.7, positive: 0, queue: 274,  lastActive: "7 Sep" },
  { name: "Francisco Fontana", contacted: 137,  li: 119, cr: 66,  dm: 53, email: 192,  sent: 311,  calls: 0,   replies: 9,  replyRate: 6.6, positive: 0, queue: 9,    lastActive: "3 Sep" },
  { name: "Isaac",             contacted: 119,  li: 145, cr: 90,  dm: 55, email: 179,  sent: 324,  calls: 0,   replies: 7,  replyRate: 5.9, positive: 0, queue: 0,    lastActive: "1 Sep" },
  { name: "Lucia",             contacted: 115,  li: 176, cr: 113, dm: 63, email: 172,  sent: 348,  calls: 166, replies: 11, replyRate: 9.6, positive: 0, queue: 2,    lastActive: "3 Sep" },
  { name: "Andrea Tizi",       contacted: 106,  li: 5,   cr: 3,   dm: 2,  email: 140,  sent: 145,  calls: 36,  replies: 5,  replyRate: 4.7, positive: 0, queue: 87,   lastActive: "1 Sep" },
];

export const teamHealth = {
  activeSellers: 6,
  totalSellers: 6,
  contacted: 2295,
  sent: 4017,
  calls: 282,
  replies: 65,
  positive: 1,
  replyRate: 2.8,
  connectRate: 43.6,
  queue: 1734,
  /** replies in the window that no flow can be tied to — never redistributed */
  unattributedReplies: 1,
};

/** Ordered by severity. The first three are shown; the rest sit behind
 *  "View all". Every one is a count with its denominator — no prose. */
export const teamAlerts: { level: "warn" | "info"; text: string }[] = [
  { level: "warn", text: "78 of 282 calls missing outcome (28%)" },
  { level: "warn", text: "2 of 6 sellers made no calls" },
  { level: "warn", text: "Juan holds 1,362 of 1,734 queued messages (79%)" },
  { level: "info", text: "Andrea Tizi sent on 6 of 31 days" },
  { level: "info", text: "1 reply could not be attributed to a seller" },
];

/* ── calls, first view: 9 columns instead of 13 ─────────────────────────── */

export type SellerCall = {
  name: string;
  attempted: number; connected: number; connectRate: number;
  interested: number; followUp: number; negative: number;
  noAnswer: number; unclassified: number;
  /** drill-down only */
  voicemail: number; wrongNumber: number; recorded: number; avgSecs: number; activeDays: number;
};

export const sellerCalls: SellerCall[] = [
  { name: "Lucia",   attempted: 166, connected: 72, connectRate: 43, interested: 1, followUp: 5, negative: 12, noAnswer: 94, unclassified: 54, voicemail: 87, wrongNumber: 7, recorded: 84, avgSecs: 35, activeDays: 9 },
  { name: "Lucho",   attempted: 51,  connected: 17, connectRate: 33, interested: 0, followUp: 1, negative: 1,  noAnswer: 34, unclassified: 15, voicemail: 33, wrongNumber: 1, recorded: 24, avgSecs: 39, activeDays: 3 },
  { name: "Andrea Tizi", attempted: 36, connected: 20, connectRate: 56, interested: 0, followUp: 7, negative: 4, noAnswer: 16, unclassified: 9, voicemail: 10, wrongNumber: 6, recorded: 18, avgSecs: 56, activeDays: 6 },
  { name: "Juan",    attempted: 29,  connected: 14, connectRate: 48, interested: 0, followUp: 13, negative: 1, noAnswer: 15, unclassified: 0,  voicemail: 13, wrongNumber: 2, recorded: 13, avgSecs: 64, activeDays: 1 },
  { name: "Francisco Fontana", attempted: 0, connected: 0, connectRate: 0, interested: 0, followUp: 0, negative: 0, noAnswer: 0, unclassified: 0, voicemail: 0, wrongNumber: 0, recorded: 0, avgSecs: 0, activeDays: 0 },
  { name: "Isaac",   attempted: 0,   connected: 0,  connectRate: 0, interested: 0, followUp: 0, negative: 0,  noAnswer: 0,  unclassified: 0,  voicemail: 0,  wrongNumber: 0, recorded: 0,  avgSecs: 0,  activeDays: 0 },
];

export const sellerCallsTotal: SellerCall = {
  name: "Team", attempted: 282, connected: 123, connectRate: 44,
  interested: 1, followUp: 26, negative: 18, noAnswer: 159, unclassified: 78,
  voicemail: 143, wrongNumber: 16, recorded: 139, avgSecs: 41, activeDays: 13,
};

/* ── consistency: 31 days, 8 Aug → 7 Sep, index 0 = 8 Aug ───────────────── */

const D31 = (m: Record<number, number>): number[] => {
  const out: number[] = new Array(31).fill(0);
  for (const k of Object.keys(m)) out[Number(k)] = m[Number(k)];
  return out;
};

export const sellerDaily: Record<string, { sent: number[]; calls: number[] }> = {
  "Juan": { sent: D31({ 0: 78, 1: 1, 2: 8, 3: 3, 4: 7, 5: 37, 6: 15, 7: 3, 8: 1, 19: 1162, 20: 52, 23: 33, 24: 184, 25: 79, 26: 81, 27: 88, 28: 81, 29: 84 }), calls: D31({ 27: 29 }) },
  "Lucho": { sent: D31({ 0: 25, 1: 1, 2: 3, 5: 36, 6: 14, 7: 4, 8: 1, 20: 223, 23: 289, 24: 97, 25: 79, 26: 26, 27: 25, 28: 27, 29: 28, 30: 14 }), calls: D31({ 25: 1, 26: 49, 27: 1 }) },
  "Francisco Fontana": { sent: D31({ 0: 60, 2: 8, 3: 4, 4: 3, 5: 5, 10: 1, 16: 112, 17: 3, 18: 57, 19: 17, 20: 27, 21: 4, 22: 7, 23: 2, 26: 1 }), calls: D31({}) },
  "Isaac": { sent: D31({ 0: 23, 2: 13, 5: 30, 6: 13, 7: 8, 8: 1, 10: 1, 16: 99, 17: 22, 18: 64, 19: 3, 20: 29, 21: 2, 22: 6, 23: 9, 24: 1 }), calls: D31({}) },
  "Lucia": { sent: D31({ 2: 31, 3: 27, 4: 1, 5: 34, 6: 11, 7: 6, 8: 1, 10: 1, 16: 116, 17: 14, 18: 54, 19: 7, 20: 26, 21: 7, 22: 10, 24: 1, 26: 1 }), calls: D31({ 10: 12, 11: 9, 16: 12, 17: 15, 23: 22, 25: 29, 26: 10, 27: 17, 30: 40 }) },
  "Andrea Tizi": { sent: D31({ 0: 62, 1: 44, 4: 2, 8: 34, 23: 2, 24: 1 }), calls: D31({ 2: 14, 3: 3, 5: 3, 24: 6, 26: 1, 27: 9 }) },
};

export const WINDOW_DAYS = 31;
export const WINDOW_START = "8 Aug";
export const WINDOW_END = "7 Sep";

/** A rate is only ranked above this many contacted leads. */
export const MIN_SAMPLE = 100;

/* ── insights: four, each one a label and a value ───────────────────────── */

export const sellerInsights: { label: string; who: string; value: string; note: string; tone?: "warn" }[] = [
  { label: "Highest reply rate", who: "Lucia", value: "9.6%", note: "11 of 115 contacted" },
  { label: "Highest volume", who: "Juan", value: "1,299", note: "contacted · 57% of the team" },
  { label: "Most calls", who: "Lucia", value: "166", note: "of 282 team dials" },
  { label: "Needs attention", who: "Lucia", value: "54", note: "calls with no outcome logged", tone: "warn" },
];

/* ═══ PORTFOLIO ═══════════════════════════════════════════════════════════ */

export type Tenant = {
  name: string;
  leads: number; activeFlows: number;
  contacted: number; contactedPrev: number;
  messages: number; calls: number;
  replies: number; repliesPrev: number;
  rate: number; positive: number;
};

export const tenants: Tenant[] = [
  { name: "SWL Consulting", leads: 3155, activeFlows: 1037, contacted: 2295, contactedPrev: 606, messages: 4016, calls: 282, replies: 66, repliesPrev: 16, rate: 2.9, positive: 1 },
  { name: "Arqy", leads: 288, activeFlows: 128, contacted: 154, contactedPrev: 167, messages: 216, calls: 16, replies: 12, repliesPrev: 2, rate: 7.8, positive: 1 },
  { name: "De Vera Grill", leads: 1260, activeFlows: 81, contacted: 93, contactedPrev: 39, messages: 180, calls: 0, replies: 24, repliesPrev: 11, rate: 25.8, positive: 0 },
  { name: "Grupo IEB", leads: 314, activeFlows: 22, contacted: 63, contactedPrev: 182, messages: 91, calls: 11, replies: 5, repliesPrev: 9, rate: 7.9, positive: 2 },
];

export const tenantsDormant = [
  { name: "Pathway Commercial Finance", leads: 1976, why: "offboarded 29 Jul; flows paused, data kept" },
  { name: "HealthTech Bio Actives", leads: 299, why: "no flow has sent yet" },
  { name: "Miranda Bosch", leads: 210, why: "no flow has sent yet" },
  { name: "Kaneka Probiotics", leads: 9, why: "no flow has sent yet" },
];

export const portfolioTotals = { contacted: 2605, messages: 4503, replies: 107, tenants: 4, dormant: 4 };

export const portfolioNote =
  "Four of the eight live tenants sent something in this period; the other four are listed below with the reason rather than shown as rows of zeros. Demo tenants are excluded. Over a 7-day window only two tenants have activity and SWL is 99.8% of it, which is why the default here is 30 days.";

export const portfolioRemoved =
  "Meetings and Wins are not columns. There is no meeting event in the schema, and the won status has never been set on any tenant — both would be guaranteed zeros across all eight, which is worse than absent because a zero reads as a result.";

export const portfolioWorthALook = {
  title: "The smallest active tenant has the highest reply rate by 9×",
  facts: [
    "De Vera Grill: 24 of 93 contacted replied (25.8%), on 180 messages and no calls.",
    "SWL Consulting: 66 of 2,295 contacted replied (2.9%), on 4,016 messages — 89% of the portfolio volume.",
    "Grupo IEB contacted 63 this period against 182 in the previous one, and is the only tenant whose volume fell.",
  ],
};

export const portfolioVerdict =
  "This tab earns its place: it is the only cross-tenant view in the product and it backs the weekly status PDF at /reports/portfolio-print. What it does not earn is a 12-metric grid — at this size the answer fits in one row per client.";

export const portfolioCompareNote =
  "Pick clients to compare them head to head on the same axes. With none picked every active client is listed; the comparison panel appears once two or more are selected.";
