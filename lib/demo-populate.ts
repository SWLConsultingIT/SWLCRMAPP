// ─── Demo auto-population ──────────────────────────────────────────────────
// One-shot scaffolding so a freshly-created demo tenant lands with realistic
// ICPs, leads, campaigns, and won/lost opportunities. Deterministic — no AI
// calls, ~1-2s round-trip. Used both by the Create-demo flow (when the user
// fills the URL+shape sliders) and by the standalone "Build demo data" modal
// to top up an existing demo.

import type { SupabaseClient } from "@supabase/supabase-js";
import { pickSeedLeads, emailFor, type DemoIndustryKey } from "@/lib/demo-seeds";
import { aiGenerateDemoData } from "@/lib/demo-ai";

export type DemoShapeConfig = {
  totalLeads: number;        // 0–50
  icps: number;              // 0–4
  campaigns: number;         // 0–4
  wonLeads: number;          // 0–10  (subset of totalLeads)
  lostLeads: number;         // 0–10  (subset of totalLeads)
  industryPreset: DemoIndustryKey;
};

export const DEFAULT_SHAPE: DemoShapeConfig = {
  totalLeads: 20,
  icps: 2,
  campaigns: 2,
  wonLeads: 3,
  lostLeads: 2,
  industryPreset: "mixed",
};

type ScrapedBio = {
  industry?: string | null;
  target_market?: string | null;
  value_proposition?: string | null;
  main_services?: string[] | null;
  location?: string | null;
};

// Map a free-text industry from the scrape to one of the seed pools we ship.
// Anything we don't recognize falls back to "mixed".
export function autoIndustryPreset(industry: string | null | undefined): DemoIndustryKey {
  if (!industry) return "mixed";
  const i = industry.toLowerCase();
  if (/(saas|tech|software|platform|app)/i.test(i)) return "saas";
  if (/(agency|marketing|advertising|creative|growth)/i.test(i)) return "agency";
  if (/(manufactur|industrial|engineering|fabricat|machining)/i.test(i)) return "manufacturing";
  if (/(restaurant|hotel|hospitality|food|qsr)/i.test(i)) return "hospitality";
  if (/(consult|outsourc|advisory|professional services)/i.test(i)) return "consulting";
  return "mixed";
}

// ── ICP templates ─────────────────────────────────────────────────────────
function icpTemplates(scraped: ScrapedBio, count: number, industryHint: string | null): Array<{
  profile_name: string;
  target_industries: string[];
  target_roles: string[];
  company_size: string;
  geography: string[];
  pain_points: string;
  solutions_offered: string;
  notes: string;
}> {
  const ind = industryHint ?? scraped.industry ?? "B2B";
  const valueProp = scraped.value_proposition ?? "Streamlined operations and predictable growth";
  const services = scraped.main_services && scraped.main_services.length > 0
    ? scraped.main_services.slice(0, 3).join(", ")
    : "Core services";
  const geo = scraped.location ? [scraped.location] : ["United States", "United Kingdom"];

  // Pool of templates — we slice up to `count`. Each template targets a
  // different buyer persona so the demo's lead list feels segmented.
  const pool = [
    {
      profile_name: `Decision-makers · ${ind}`,
      target_industries: [ind],
      target_roles: ["CEO", "Founder", "Managing Director", "Owner"],
      company_size: "10-100",
      geography: geo,
      pain_points: "Manual sales workflows, inconsistent outbound results, low pipeline visibility.",
      solutions_offered: `${services}. ${valueProp}.`,
      notes: "Auto-generated for demo. Top-of-funnel buyer persona.",
    },
    {
      profile_name: `Operations leaders · ${ind}`,
      target_industries: [ind],
      target_roles: ["COO", "VP Operations", "Director of Operations"],
      company_size: "20-200",
      geography: geo,
      pain_points: "Hand-off friction between sales/ops, missed SLAs, low forecast accuracy.",
      solutions_offered: services,
      notes: "Auto-generated for demo. Ops-side buyer.",
    },
    {
      profile_name: `Revenue leaders · ${ind}`,
      target_industries: [ind],
      target_roles: ["CRO", "VP Sales", "Head of Revenue"],
      company_size: "30-300",
      geography: geo,
      pain_points: "Pipeline coverage below 3x, ramp-time too slow, low rep productivity.",
      solutions_offered: `${services}. ${valueProp}.`,
      notes: "Auto-generated for demo. Revenue-side buyer.",
    },
    {
      profile_name: `Marketing leaders · ${ind}`,
      target_industries: [ind],
      target_roles: ["CMO", "VP Marketing", "Head of Demand Gen"],
      company_size: "30-300",
      geography: geo,
      pain_points: "Inbound only converts at <2%, MQL→SQL handoff broken, paid CAC rising.",
      solutions_offered: services,
      notes: "Auto-generated for demo. Marketing-side buyer.",
    },
  ];
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

// ── Campaign sequence templates ──────────────────────────────────────────
function campaignNames(count: number, industryHint: string): string[] {
  const pool = [
    `Q1 ${industryHint} Outreach`,
    `Pilot — ${industryHint} Operators`,
    `Re-engagement — ${industryHint}`,
    `Decision-maker Sweep`,
  ];
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

function sequenceSteps(scraped: ScrapedBio): unknown[] {
  const valueProp = scraped.value_proposition ?? "predictable pipeline without the legwork";
  const service = scraped.main_services?.[0] ?? "our service";
  return [
    {
      step_number: 0,
      channel: "linkedin",
      type: "connection_request",
      delay_days: 0,
      body: `Hi {{first_name}}, working on {{role}} at {{company_name}} — would love to connect.`,
    },
    {
      step_number: 1,
      channel: "linkedin",
      type: "dm",
      delay_days: 2,
      body: `Hey {{first_name}}, ${valueProp}. We help teams like {{company_name}} with ${service}. Worth a 15-min chat?`,
    },
    {
      step_number: 2,
      channel: "email",
      type: "email",
      delay_days: 4,
      subject: `Quick idea for {{company_name}}`,
      body: `Hey {{first_name}} — saw {{company_name}} and thought of one quick thing. ${valueProp}. Open to a call?`,
    },
    {
      step_number: 3,
      channel: "linkedin",
      type: "dm",
      delay_days: 7,
      body: `Following up — happy to send a 1-pager if easier than a call.`,
    },
  ];
}

// ── Status distribution ───────────────────────────────────────────────────
type LeadStatus = "new" | "contacted" | "connected" | "qualified" | "closed_won" | "closed_lost";

function distributeStatuses(total: number, won: number, lost: number): LeadStatus[] {
  const w = Math.min(won, total);
  const l = Math.min(lost, total - w);
  const remaining = total - w - l;

  // Realistic-ish split for the rest: 35% new, 35% contacted, 20% connected, 10% qualified
  const newCount = Math.floor(remaining * 0.35);
  const contactedCount = Math.floor(remaining * 0.35);
  const connectedCount = Math.floor(remaining * 0.2);
  const qualifiedCount = remaining - newCount - contactedCount - connectedCount;

  const statuses: LeadStatus[] = [
    ...Array(w).fill("closed_won"),
    ...Array(l).fill("closed_lost"),
    ...Array(qualifiedCount).fill("qualified"),
    ...Array(connectedCount).fill("connected"),
    ...Array(contactedCount).fill("contacted"),
    ...Array(newCount).fill("new"),
  ];

  // Shuffle so won/lost aren't all clustered at the top of the leads list.
  for (let i = statuses.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [statuses[i], statuses[j]] = [statuses[j], statuses[i]];
  }
  return statuses;
}

// ── Main entry point ──────────────────────────────────────────────────────
export async function populateDemo(
  svc: SupabaseClient,
  bioId: string,
  scraped: ScrapedBio,
  config: DemoShapeConfig
): Promise<{
  insertedLeads: number;
  insertedIcps: number;
  insertedCampaigns: number;
  wonLeads: number;
  lostLeads: number;
}> {
  const { totalLeads, icps, campaigns: campaignsCount, wonLeads, lostLeads, industryPreset } = config;
  const industryHint = scraped.industry ?? "B2B";

  // 0) AI tailoring ─────────────────────────────────────────────────────────
  // First try to synthesize tailored data from the scrape (LATAM finance →
  // LATAM finance prospects + Spanish copy; UK manufacturing → UK leads + EN).
  // Falls back to canned pools below when OpenAI is unavailable or returns
  // unparseable output.
  const ai = totalLeads > 0
    ? await aiGenerateDemoData(scraped, { leads: totalLeads, icps, campaigns: campaignsCount })
    : null;

  // 1) ICPs ────────────────────────────────────────────────────────────────
  // Prefer the AI-generated personas when present — they reference the
  // seller's actual value prop + services. Fall back to canned templates.
  const icpRows = (ai?.icps && ai.icps.length > 0
    ? ai.icps as Array<ReturnType<typeof icpTemplates>[number]>
    : icpTemplates(scraped, icps, industryHint)
  ).map(i => ({
    ...i,
    company_bio_id: bioId,
    status: "approved",
    execution_status: "completed",
  }));
  const insertedIcps = icpRows.length > 0
    ? (await svc.from("icp_profiles").insert(icpRows).select("id")).data ?? []
    : [];

  // 2) Leads (with status distribution) ────────────────────────────────────
  const seedLeads = ai?.leads && ai.leads.length > 0
    ? ai.leads
    : pickSeedLeads(industryPreset, totalLeads);
  const statuses = distributeStatuses(totalLeads, wonLeads, lostLeads);
  const leadRows = seedLeads.map((s, i) => {
    const status = statuses[i] ?? "new";
    // Round-robin: each lead lands on a different ICP if we created any.
    const icpId = insertedIcps.length > 0 ? insertedIcps[i % insertedIcps.length].id : null;
    return {
      company_bio_id: bioId,
      icp_profile_id: icpId,
      primary_first_name: s.first,
      primary_last_name: s.last,
      primary_title_role: s.role,
      primary_seniority: s.seniority,
      primary_work_email: emailFor(s.first, s.last, s.company),
      primary_linkedin_url: s.linkedin,
      company_name: s.company,
      company_industry: s.industry,
      company_country: s.country,
      employees: s.employees,
      status,
      // Won leads also get an opportunity_stage for the Opportunities page.
      opportunity_stage: status === "closed_won" ? "won" : status === "qualified" ? "negotiation" : null,
      allow_linkedin: true,
      allow_email: true,
      current_channel: status !== "new" ? "linkedin" : null,
      source_tool: "demo_seed",
      source_universe: "demo",
    };
  });

  const insertedLeads = leadRows.length > 0
    ? (await svc.from("leads").insert(leadRows).select("id, status")).data ?? []
    : [];

  // 3) Campaigns ───────────────────────────────────────────────────────────
  // One row per (campaign-name, lead) since that's how the schema models it.
  // Skip "new" leads and won/lost completed leads handled separately.
  const cnames = campaignNames(campaignsCount, industryHint);
  const sequence = sequenceSteps(scraped);
  let insertedCampaigns = 0;

  if (cnames.length > 0 && insertedLeads.length > 0) {
    const campaignRows = insertedLeads
      .map((lead, i) => {
        // Determine campaign status based on the lead's status.
        const leadStatus = lead.status as LeadStatus;
        let campaignStatus: string;
        let stopReason: string | null = null;
        if (leadStatus === "new") return null; // no campaign for fresh leads
        if (leadStatus === "closed_won") { campaignStatus = "completed"; stopReason = "positive_response"; }
        else if (leadStatus === "closed_lost") { campaignStatus = "completed"; stopReason = "negative_response"; }
        else if (leadStatus === "qualified") { campaignStatus = "completed"; stopReason = "positive_response"; }
        else { campaignStatus = "active"; }

        const cname = cnames[i % cnames.length];
        return {
          lead_id: lead.id,
          name: cname,
          channel: "linkedin",
          status: campaignStatus,
          current_step: campaignStatus === "active" ? 1 : sequence.length,
          sequence_steps: sequence,
          stop_reason: stopReason,
          started_at: new Date(Date.now() - Math.random() * 14 * 86400_000).toISOString(),
          last_step_at: new Date(Date.now() - Math.random() * 7 * 86400_000).toISOString(),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (campaignRows.length > 0) {
      const { data: campRes } = await svc.from("campaigns").insert(campaignRows).select("id");
      insertedCampaigns = campRes?.length ?? 0;
    }
  }

  return {
    insertedLeads: insertedLeads.length,
    insertedIcps: insertedIcps.length,
    insertedCampaigns,
    wonLeads: leadRows.filter(l => l.status === "closed_won").length,
    lostLeads: leadRows.filter(l => l.status === "closed_lost").length,
  };
}
