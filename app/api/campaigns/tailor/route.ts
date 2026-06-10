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
    /** Per-lead {hook, fit} cached from a previous wizard-batch-preview
     *  run. When supplied, the tailor route reuses these slots instead
     *  of paying for a second Haiku call per lead — exactly the
     *  hand-off the wizard's Step 3 review surface produces. */
    previewOutputs?: Record<string, { hook?: string | null; fit?: string | null; manual_edit?: { hook?: string | null; fit?: string | null } }>;
  };
  const { campaignId, dryRun = false, leadIdsLimit, previewOutputs } = body;
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
  // super_admin operates cross-tenant by design (the /admin Pending-Approvals
  // flow approves any client's request). Without this bypass, a super_admin
  // who had switched the tenant cookie to e.g. Arqy got `isScoped=true` +
  // `companyBioId=Arqy`, so approving an SWL request 403'd every tailor call →
  // approve returned "Failed to approve" (2026-06-10). owner/manager stay
  // scoped to their own tenant.
  if (scope.tier !== "super_admin" && scope.isScoped && campaign.company_bio_id !== scope.companyBioId) {
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
  // Idempotency: include rows whose content STILL has slots OR whose
  // metadata.has_tailored_slots was stamped at INSERT time. Without
  // the metadata fallback, a re-run after a partial tailor would see
  // already-substituted content (no `{{tailored:*}}` left), skip the
  // row entirely, and lose any manual_edits the seller made later.
  const hasSlotMeta = (m: CampaignMessageRow): boolean => {
    const meta = m.metadata as Record<string, unknown> | null;
    return !!(meta && meta.has_tailored_slots === true);
  };
  const slotted = allMsgs.filter(m => m.content && (findTailoredSlots(m.content).length > 0 || hasSlotMeta(m)));
  if (slotted.length === 0) {
    return NextResponse.json({ ok: true, tailored: 0, reason: "no slots in this campaign" });
  }

  // Fran 2026-06-09: tailored slots now go in EVERY step body, not
  // just first-touch. So we tailor every campaign_messages row that
  // contains slots. The Haiku call is one-per-(lead, channel) — the
  // hook+fit it returns are reused across that lead's follow-ups in
  // the same channel so the per-lead voice stays coherent across the
  // sequence (e.g. all 3 LinkedIn DMs to William reference his post
  // the same way). Email follow-ups get the same hook+fit as the
  // email intro for the same lead.
  const tailoringTargets = slotted; // every slotted row gets filled
  // Cap for the preview UI: when set, slice the unique (lead, channel)
  // pairs to leadIdsLimit so we don't blow Haiku quota on previews.
  const uniqueLeadChannels = new Map<string, CampaignMessageRow>();
  for (const m of [...slotted].sort((a, b) => a.step_number - b.step_number)) {
    const key = `${m.lead_id}:${m.channel}`;
    if (!uniqueLeadChannels.has(key)) uniqueLeadChannels.set(key, m);
  }
  const allLeadChannels = Array.from(uniqueLeadChannels.values());
  const sampledLeadChannels = leadIdsLimit && leadIdsLimit > 0
    ? allLeadChannels.slice(0, leadIdsLimit)
    : allLeadChannels;
  const sampledKeys = new Set(sampledLeadChannels.map(m => `${m.lead_id}:${m.channel}`));
  // targets = the (lead, channel) pairs we actually call Haiku for.
  const targets = sampledLeadChannels;
  // Apply targets = every slotted row whose (lead, channel) is in the sample.
  const applyTargets = tailoringTargets.filter(m => sampledKeys.has(`${m.lead_id}:${m.channel}`));

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

  // ONE Haiku call per (lead, channel). The hook+fit returned gets
  // applied to EVERY slotted row in that (lead, channel) so the
  // sequence stays coherent across follow-ups (same per-lead voice
  // referenced in step 0, step 1, step 2, etc.).
  type LeadChannelSlots = { lead_id: string; channel: string; slots: TailoredSlots | null };
  const perLeadChannel: LeadChannelSlots[] = await bulkParallel(targets, async (row) => {
    const lead = leadById.get(row.lead_id);
    if (!lead) return { lead_id: row.lead_id, channel: row.channel, slots: null };

    // Reuse path — if the wizard already generated + (optionally) the
    // seller edited a hook/fit for this lead in Step 3, use those
    // instead of paying for another Haiku call.
    const cached = previewOutputs?.[row.lead_id];
    if (cached) {
      const edit = cached.manual_edit;
      const hook = (edit?.hook && edit.hook.trim()) || (cached.hook && cached.hook.trim()) || "";
      const fit = (edit?.fit && edit.fit.trim()) || (cached.fit && cached.fit.trim()) || "";
      if (hook && fit) {
        return { lead_id: row.lead_id, channel: row.channel, slots: { hook, fit } };
      }
    }

    const ctx: TailorContext = {
      lead,
      icp,
      companyBio,
      seller: { name: sellerName },
      stepChannel: row.channel,
    };
    const slots = await callHaiku(client, ctx);
    return { lead_id: row.lead_id, channel: row.channel, slots };
  });

  // Map (lead, channel) → slots so we can apply to every slotted row.
  const slotsByKey = new Map<string, TailoredSlots>();
  for (const x of perLeadChannel) {
    if (x.slots) slotsByKey.set(`${x.lead_id}:${x.channel}`, x.slots);
  }

  type TailorResult = { row: CampaignMessageRow; slots: TailoredSlots | null; renderedContent: string | null };
  const results: TailorResult[] = applyTargets.map(row => {
    const slots = slotsByKey.get(`${row.lead_id}:${row.channel}`) ?? null;
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
    totalCandidates: applyTargets.length,
    haikuCalls: targets.length,
    processed: results.length,
  });
}
