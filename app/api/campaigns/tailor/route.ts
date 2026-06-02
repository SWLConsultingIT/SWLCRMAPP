// POST /api/campaigns/tailor
//
// Fills in the AI tailored slots ({{tailored:hook}} + {{tailored:fit}})
// for every campaign_messages row of a campaign that contains them,
// per Fran's "tailored messages per lead" spec (2026-06-02).
//
// Trigger: called by /api/campaigns/approve right after the
// campaign_messages rows are inserted (sync per spec — block until done
// for the seller). Also callable standalone with a campaignId to retry
// a failed run or refresh on demand.
//
// Body: { campaignId: string, dryRun?: boolean, leadIdsLimit?: number }
//   - dryRun: don't write — return the rendered output for inspection.
//   - leadIdsLimit: cap the lead set (used by the approve-preview UI to
//     show 3 sample renders without burning a full campaign worth of
//     Haiku calls).
//
// Concurrency: hard-capped at CONCURRENCY (10). With ~3s/Haiku call,
// 100 leads → ~30s wall clock. 200 leads → ~60s. The seller sees a
// blocked button during that window (spec: synchronous wait).
//
// Idempotency: rows whose content no longer contains any tailored slot
// are skipped, so re-running is safe. The render writes to BOTH
// campaign_messages.content AND metadata.rendered_content so the UI
// reflects the personalized output everywhere.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import {
  findTailoredSlots,
  substituteTailoredSlots,
  type TailoredSlots,
} from "@/lib/placeholders";
import {
  buildTailorUserPrompt,
  TAILOR_SYSTEM_PROMPT,
  type TailorContext,
  type TailorLead,
  type TailorIcp,
  type TailorCompanyBio,
} from "@/lib/tailor-prompt";

const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 10;
const MAX_RETRIES = 2;

type CampaignMessageRow = {
  id: string;
  lead_id: string;
  campaign_id: string;
  step_number: number;
  channel: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
};

async function callHaiku(client: Anthropic, ctx: TailorContext): Promise<TailoredSlots | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 400,
        system: TAILOR_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildTailorUserPrompt(ctx) }],
      });
      const text = msg.content
        .filter(c => c.type === "text")
        .map(c => (c as { type: "text"; text: string }).text)
        .join("");
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch {
        // Same robust parser as the V8 generator's Assemble Campaign:
        // walk from the first `{` and track brace depth across strings.
        const start = text.indexOf("{");
        if (start === -1) continue;
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let i = start; i < text.length; i++) {
          const ch = text[i];
          if (esc) { esc = false; continue; }
          if (ch === "\\") { esc = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === "{") depth++;
          else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end === -1) continue;
        try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { continue; }
      }
      const obj = parsed as { hook?: string; fit?: string } | null;
      if (!obj || typeof obj.hook !== "string" || typeof obj.fit !== "string") continue;
      return { hook: obj.hook.trim(), fit: obj.fit.trim() };
    } catch {
      if (attempt === MAX_RETRIES) return null;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

// Bounded-parallelism mapper. Plain Promise.all on the whole array would
// fire N Anthropic requests at once and likely 429. This processes in
// rolling batches of CONCURRENCY, retaining input order in the output.
async function bulkParallel<I, O>(items: I[], fn: (item: I, idx: number) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    campaignId?: string;
    dryRun?: boolean;
    leadIdsLimit?: number;
  };
  const { campaignId, dryRun = false, leadIdsLimit } = body;
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const svc = getSupabaseService();

  // Campaign + tenant guard.
  const { data: campaign } = await svc
    .from("campaigns")
    .select("id, name, company_bio_id, seller_id, icp_profile_id, sellers(name)")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (scope.isScoped && campaign.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sellerName = (Array.isArray((campaign as { sellers?: unknown }).sellers)
    ? ((campaign as { sellers?: Array<{ name?: string }> }).sellers?.[0]?.name)
    : ((campaign as { sellers?: { name?: string } }).sellers?.name)) ?? null;

  // Bio + ICP.
  const [bioRes, icpRes] = await Promise.all([
    svc.from("company_bios").select("company_name, tagline, value_proposition, differentiators, main_services, tone_of_voice").eq("id", campaign.company_bio_id).maybeSingle(),
    campaign.icp_profile_id
      ? svc.from("icp_profiles").select("profile_name, target_industries, target_roles, pain_points, solutions_offered, notes").eq("id", campaign.icp_profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const companyBio: TailorCompanyBio = bioRes.data ?? {};
  const icp: TailorIcp | null = (icpRes.data as TailorIcp | null) ?? null;

  // Pull every campaign_messages row + only keep the ones with tailored
  // slots. We do this AFTER loading bio/icp so we can skip the entire
  // tailor pass quickly when no row of the campaign carries slots.
  const { data: msgsRaw } = await svc
    .from("campaign_messages")
    .select("id, lead_id, campaign_id, step_number, channel, content, metadata")
    .eq("campaign_id", campaignId);
  const allMsgs = (msgsRaw ?? []) as CampaignMessageRow[];
  const slotted = allMsgs.filter(m => m.content && findTailoredSlots(m.content).length > 0);
  if (slotted.length === 0) {
    return NextResponse.json({ ok: true, tailored: 0, reason: "no slots in this campaign" });
  }

  // Per the seller spec: only tailor the FIRST occurrence of each
  // channel per lead. So group by lead → keep min(step_number) per
  // channel. Follow-up steps that happen to use a slot are skipped on
  // purpose (the seller assumes the lead already knows the company by
  // step 2+).
  const firstTouchKeys = new Set<string>();
  const firstTouches: CampaignMessageRow[] = [];
  const byLeadChannelStep = [...slotted].sort((a, b) => a.step_number - b.step_number);
  for (const m of byLeadChannelStep) {
    const key = `${m.lead_id}:${m.channel}`;
    if (firstTouchKeys.has(key)) continue;
    firstTouchKeys.add(key);
    firstTouches.push(m);
  }

  // Optional cap for the preview UI.
  const targets = leadIdsLimit && leadIdsLimit > 0 ? firstTouches.slice(0, leadIdsLimit) : firstTouches;

  // Load the lead rows we need.
  const leadIds = [...new Set(targets.map(t => t.lead_id))];
  const { data: leadsData } = await svc
    .from("leads")
    .select(`
      id, primary_first_name, primary_last_name, primary_title_role, primary_seniority, primary_headline,
      company_name, company_industry, company_sub_industry,
      organization_description, organization_short_desc, organization_technologies,
      recent_website_news, recent_linkedin_post, website_summary, industry_trends,
      employees, annual_revenue, call_talking_points
    `)
    .in("id", leadIds);
  const leadById = new Map<string, TailorLead>((leadsData ?? []).map(l => [l.id, l as TailorLead]));

  // Group rows by lead so a single Haiku call per lead-channel can fill
  // multiple slots. Today the contract is one (hook,fit) per first-
  // touch — channel-specific tone differences are encoded in the prompt
  // via `stepChannel`.
  const client = new Anthropic({ apiKey });

  type TailorResult = { row: CampaignMessageRow; slots: TailoredSlots | null; renderedContent: string | null };
  const results: TailorResult[] = await bulkParallel(targets, async (row) => {
    const lead = leadById.get(row.lead_id);
    if (!lead) return { row, slots: null, renderedContent: null };
    const ctx: TailorContext = {
      lead,
      icp,
      companyBio,
      seller: { name: sellerName },
      stepChannel: row.channel,
    };
    const slots = await callHaiku(client, ctx);
    if (!slots) return { row, slots: null, renderedContent: null };
    const renderedContent = substituteTailoredSlots(row.content ?? "", slots);
    return { row, slots, renderedContent };
  });

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      tailored: results.filter(r => r.slots).length,
      results: results.map(r => ({
        messageId: r.row.id,
        leadId: r.row.lead_id,
        channel: r.row.channel,
        step_number: r.row.step_number,
        slots: r.slots,
        renderedContent: r.renderedContent,
      })),
    });
  }

  // Persist. Same row may be touched once (one channel = one tailor
  // call). Do not touch rows where Haiku failed — they keep the raw
  // template, and the dispatcher's unresolved-placeholder guard will
  // mark them needs-attention instead of silently shipping.
  let written = 0;
  for (const r of results) {
    if (!r.slots || !r.renderedContent) continue;
    const prevMeta = (r.row.metadata && typeof r.row.metadata === "object") ? r.row.metadata : {};
    await svc.from("campaign_messages").update({
      content: r.renderedContent,
      metadata: {
        ...prevMeta,
        rendered_content: r.renderedContent,
        tailored: { hook: r.slots.hook, fit: r.slots.fit, tailored_at: new Date().toISOString() },
      },
    }).eq("id", r.row.id);
    written += 1;
  }

  return NextResponse.json({
    ok: true,
    tailored: written,
    failed: results.length - written,
    totalCandidates: firstTouches.length,
    processed: results.length,
  });
}
