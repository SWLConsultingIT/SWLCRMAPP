// ─────────────────────────────────────────────────────────────────────────
// Static data for the Diagnostic Console. Every figure below was measured
// against the SWL Consulting tenant on 2026-09-07 and is scoped to the
// SELECTED PERIOD — 8 Aug to 7 Sep 2026 — not to the workspace lifetime.
//
// That distinction is the whole point of this revision. The previous version
// labelled the screen "30 days" and showed lifetime totals (3,155 loaded /
// 2,977 contacted / 104 replied / 3 positive), which is the same defect the
// audit found on the live dashboard. The period figures are very different,
// and one of them matters a lot: there were no positive replies at all.
//
// Every metric here carries source, numerator, denominator, window and dedup
// key in `provenance` below. Anything that could not satisfy all five is in
// `notMeasured` and is not rendered as a number anywhere.
// ─────────────────────────────────────────────────────────────────────────

export type Delta = { v: number; unit: "pp" | "pct" } | null;

export const period = {
  label: "Last 30 days",
  range: "8 Aug – 7 Sep 2026",
  prior: "9 Jul – 7 Aug 2026",
  presets: ["Today", "7 days", "30 days", "90 days", "All time"],
};

/* ── Funnel, on one cohort. Leads loaded (1,491) and enrolled (1,910) in the
      window are NOT supersets of the 2,295 contacted — most contacted leads
      were loaded earlier — so they are context beside the opening, not
      stages here. ──────────────────────────────────────────────────────── */
export const funnel = {
  /** Contacted → Replied → Positive. Each stage is the SAME cohort filtered
   *  further, so the chain is a strict subset.
   *
   *  "Followed up" was a stage here and it was wrong: a reply STOPS the flow,
   *  so only 34 of the 65 leads that replied ever received a second message.
   *  It is not a superset of Replied and cannot sit between the two. It is
   *  now context beside the funnel, where it belongs. */
  stages: [
    { key: "contacted", label: "Contacted", n: 2295, delta: { v: 279, unit: "pct" } as Delta,
      def: "Leads that received at least one message in this period. Deduplicated by lead." },
    { key: "replied", label: "Replied", n: 65, delta: { v: 306, unit: "pct" } as Delta,
      def: "Of the contacted cohort, the leads that wrote back within the period on LinkedIn, email or WhatsApp. A logged call outcome is not a reply." },
    { key: "positive", label: "Positive", n: 1, delta: null as Delta,
      def: "Replies classified positive or meeting-intent. One in this period, on LinkedIn, on 6 September." },
  ],
  notAdvanced: [
    { n: 993,  text: "of the contacted received a single message" },
    { n: 1302, text: "received two or more" },
    { n: 64,   text: "replies were not classified positive" },
  ],
  cohortNote: "One further lead replied in this period but was contacted before it, so it sits outside this cohort — 66 leads replied in total.",
};

/* ── Channels. Two groups that are NOT the same measurement. ───────────── */
export const replyRates = {
  title: "Reply rates",
  note: "same measurement, comparable",
  rows: [
    { key: "dm", label: "LinkedIn DM", icon: "dm" as const,
      sent: 219, reached: 160, replies: 28, rate: 17.5, delta: { v: 12.2, unit: "pp" } as Delta },
    { key: "email", label: "Email", icon: "email" as const,
      sent: 3205, reached: 2265, replies: 32, rate: 1.4, delta: { v: -0.8, unit: "pp" } as Delta },
  ],
};

export const otherChannel = {
  title: "Other channel metrics",
  note: "different measurement each — not reply rates",
  rows: [
    { key: "invites", label: "LinkedIn invitation acceptance", icon: "in" as const,
      value: 2.8, num: 16, den: 575, unit: "accepted",
      basis: "of the 575 leads invited in this period, accepted as of today",
      delta: null as Delta,
      caveat: "acceptance has no timestamp, so this is anchored on the invitation date" },
    { key: "calls", label: "Calls connect rate", icon: "call" as const,
      value: 43.6, num: 123, den: 282, unit: "connected",
      basis: "real dials in the period, excluding click-to-dial markers",
      delta: null as Delta,
      caveat: "78 of the 282 have no outcome logged" },
  ],
};

/* ── The LinkedIn note. Facts only: two measurements and their sizes. No
      claim about cause, about what is reachable, or about a bottleneck. ── */
export const linkedinNote = {
  title: "LinkedIn invitation acceptance deserves attention",
  facts: [
    "16 of 575 invitations sent this period have been accepted (2.8%).",
    "LinkedIn DMs reached 160 leads and 28 of them replied (17.5%).",
    "Email reached 2,265 leads and 32 of them replied (1.4%).",
  ],
};

/* ── Ranked lists. Sort key stated on screen. ──────────────────────────── */
export const rankedBy = "Reply rate";

export const campaigns = [
  { name: "Odoo Implementation — Argentina",  contacted: 97,   replies: 9,  rate: 9.3 },
  { name: "Growth AI Sales — LATAM",          contacted: 202,  replies: 16, rate: 7.9 },
  { name: "UK Growth AI Sales — Vol I",       contacted: 309,  replies: 19, rate: 6.1 },
  { name: "PE & VC Firms — Spain",            contacted: 225,  replies: 12, rate: 5.3 },
  { name: "Solar & Renewable Energy — USA",   contacted: 105,  replies: 2,  rate: 1.9 },
  { name: "Natural Ingredients — USA",        contacted: 242,  replies: 1,  rate: 0.4 },
  { name: "PE & VC Firms — USA",              contacted: 1073, replies: 4,  rate: 0.4 },
];
export const campaignsNote = "8 campaigns sent in this period. Those with fewer than 20 leads contacted are not shown — a rate off a handful of leads is noise.";

export const sellers = [
  { name: "Lucia",             contacted: 115,  replies: 11, rate: 9.6 },
  { name: "Francisco Fontana", contacted: 137,  replies: 9,  rate: 6.6 },
  { name: "Isaac",             contacted: 119,  replies: 7,  rate: 5.9 },
  { name: "Andrea Tizi",       contacted: 106,  replies: 5,  rate: 4.7 },
  { name: "Lucho",             contacted: 519,  replies: 14, rate: 2.7 },
  { name: "Juan",              contacted: 1299, replies: 19, rate: 1.5 },
];
export const sellersNote = "Attribution is by the flow's assigned seller. Replies that arrive without a flow cannot be attributed and are excluded, not spread across the rows.";

/* ── Reply quality. Events, and the lead count they came from. ─────────── */
export const replyQuality = {
  events: 81,
  leads: 66,
  rows: [
    { label: "Not interested", n: 32, tone: "bad"     as const },
    { label: "Needs info",     n: 31, tone: "info"    as const },
    { label: "Follow up",      n: 17, tone: "neutral" as const },
    { label: "Interested",     n: 1,  tone: "good"    as const },
    { label: "Auto-reply",     n: 0,  tone: "muted"   as const },
  ],
  note: "81 replies from 66 leads — a lead can reply more than once, so events exceed leads.",
};

/* ── Activity. Daily, both windows, real. ──────────────────────────────── */
export const activity = {
  sent:    [177,117,57,37,16,142,50,17,45,0,3,0,0,0,0,0,312,54,166,958,594,16,23,334,266,176,109,113,105,109,19],
  replies: [3,2,5,0,3,1,2,0,2,1,2,0,0,0,0,0,4,2,3,8,7,2,2,20,4,4,2,1,0,1,0],
  prior:   [0,0,0,0,0,0,0,0,4,0,0,125,20,68,26,29,32,1,4,0,4,1,0,0,0,397,18,73,20,378,0],
  totals: { sent: 4015, replies: 81 },
};

/* ── Timing. The 81 reply events, all 7 days, out-of-hours included. ───── */
export const timing = {
  tz: "America/Buenos_Aires",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  blocks: ["9–12", "12–15", "15–18", "18–21", "other"],
  grid: [
    [1, 18, 9, 0, 2],
    [3,  3, 0, 0, 2],
    [0,  2, 2, 1, 5],
    [3,  3, 5, 0, 0],
    [0,  2, 6, 0, 2],
    [0,  1, 0, 0, 4],
    [1,  1, 1, 0, 4],
  ],
  total: 81,
};

/* ── Workspace stock. Not part of the period funnel. ───────────────────── */
/** How much of the list has actually been worked. The three parts PARTITION
 *  the total exactly — 2,977 + 103 + 75 = 3,155 — which is what makes the bar
 *  readable. The previous version put four numbers on one line across two
 *  different time windows, and none of them added up to another.
 *
 *  All-time on purpose: this is stock, and a stock figure windowed to 30 days
 *  answers a different question. Intake sits apart, below, clearly labelled. */
export const workspace = {
  total: 3155,
  parts: [
    { label: "contacted at some point", n: 2977 },
    { label: "in a flow, never messaged", n: 103 },
    { label: "never enrolled", n: 75 },
  ],
  intake: { n: 1491, label: "added during this period" },
};

/* ── Not rendered anywhere. Kept so the omissions stay on the record: these
      are decisions, not oversights. Fran asked for the on-screen section to
      go (2026-09-07); the metrics themselves remain absent from the UI. ─── */
export const notMeasured = [
  { name: "Meetings", why: "no meeting event exists. `qualified` means a positive reply reached the CRM, which is a different thing" },
  { name: "Won", why: "the status exists and has never been used, so the rate cannot move" },
  { name: "Lost", why: "the available figure mixes negative replies with a manual closed-lost status; the definition is not settled" },
  { name: "Acceptance within a period", why: "`linkedin_connected` is a boolean with no timestamp, so only the invitation date can be windowed" },
];

/* ── Provenance. Rendered nowhere; kept so every number on the screen can
      be traced without opening a query. ─────────────────────────────────── */
export const provenance = [
  { metric: "Contacted", source: "campaign_messages.status='sent'", window: "sent_at in period", dedup: "lead_id" },
  { metric: "Replied", source: "lead_replies, channel != 'call'", window: "received_at in period", dedup: "lead_id" },
  { metric: "Positive", source: "lead_replies.classification in (positive, meeting_intent)", window: "received_at in period", dedup: "lead_id" },
  { metric: "Reply events", source: "lead_replies, channel != 'call'", window: "received_at in period", dedup: "row" },
  { metric: "LinkedIn DM reply rate", source: "campaign_messages channel='linkedin' step>=1", window: "sent_at in period", dedup: "lead_id" },
  { metric: "Email reply rate", source: "campaign_messages channel='email'", window: "sent_at in period", dedup: "lead_id" },
  { metric: "Invitation acceptance", source: "leads.linkedin_connected over leads invited in period", window: "invitation sent_at in period; acceptance as of today", dedup: "lead_id" },
  { metric: "Calls connect rate", source: "calls, flow-metrics-lib isRealCall / isConnected", window: "started_at in period", dedup: "lead + minute, preferring the real row over the dial marker" },
];

export const filters = {
  campaigns: ["All campaigns", ...campaigns.map(c => c.name)],
  icps: ["All ICPs", "PE & VC Firms", "Growth AI Sales", "Natural Ingredients", "Solar & Renewables"],
  sellers: ["All sellers", ...sellers.map(s => s.name)],
};
