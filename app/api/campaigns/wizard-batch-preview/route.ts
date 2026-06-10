// POST /api/campaigns/wizard-batch-preview
//
// Tailored-mode review surface: for every lead in the batch, generate
// the {{tailored:hook}} + {{tailored:fit}} copy using that lead's
// publications / news / tech stack, validate the substituted output,
// and persist everything into campaign_requests.message_prompts.
// preview_outputs (jsonb existing column — no DDL needed).
//
// Idempotent by (campaign_request_id) — re-running just overwrites the
// preview_outputs key. The wizard calls this when the seller clicks
// "Validate full batch" in Step 3. The approve route later reads
// preview_outputs[leadId].manual_edit ?? generated to avoid a second
// Haiku spend per lead.
//
// Body: {
//   campaignRequestId?: string,    // when set, persist back to the row
//   leadIds: string[],             // 1-2000 leads (no cap; concurrency=10)
//   companyBioId: string,
//   icpProfileId?: string,
//   sellerId?: string,
//   steps: Array<{ channel; body; subject? }>,
//   connectionRequest?: string,
// }
//
// Returns: {
//   ok: true,
//   results: Array<{ leadId, name, company, role, slots: { hook, fit } | null, rendered: { connectionRequest?, steps[] }, violations: ViolationCode[] }>,
//   summary: { total, ok, withIssues, byCode: Record<ViolationCode, number> },
// }

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { findTailoredSlots, substituteTailoredSlots } from "@/lib/placeholders";
import { buildTailorUserPrompt, TAILOR_SYSTEM_PROMPT, type TailorContext, type TailorLead, type TailorIcp, type TailorCompanyBio } from "@/lib/tailor-prompt";
import { validateMessage, type Violation, type ViolationCode } from "@/lib/message-validator";

export const maxDuration = 300;

const MODEL = "claude-haiku-4-5-20251001";
const CONCURRENCY = 10;

type Slots = { hook: string; fit: string };

type StepIn = { channel: string; body: string; subject?: string | null };

type ResultRow = {
  leadId: string;
  name: string;
  company: string | null;
  role: string | null;
  slots: Slots | null;
  rendered: { connectionRequest?: string; steps: Array<{ channel: string; subject?: string | null; body: string }> };
  violations: ViolationCode[];
};

async function callHaiku(client: Anthropic, ctx: TailorContext): Promise<Slots | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 400,
        system: TAILOR_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildTailorUserPrompt(ctx) }],
      });
      const text = res.content
        .filter(c => c.type === "text")
        .map(c => (c as { type: "text"; text: string }).text)
        .join("");
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
      const parsed = JSON.parse(text.slice(start, end + 1)) as { hook?: string; fit?: string };
      if (typeof parsed.hook !== "string" || typeof parsed.fit !== "string") continue;
      return { hook: parsed.hook.trim(), fit: parsed.fit.trim() };
    } catch {
      // retry once
    }
  }
  return null;
}

async function bulkParallel<I, O>(items: I[], fn: (item: I) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
  return out;
}

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  type Body = {
    campaignRequestId?: string;
    leadIds?: string[];
    companyBioId?: string;
    icpProfileId?: string;
    sellerId?: string;
    steps?: StepIn[];
    connectionRequest?: string;
  };
  const body = (await req.json().catch(() => ({}))) as Body;
  const { campaignRequestId, leadIds, companyBioId, icpProfileId, sellerId, steps, connectionRequest } = body;

  if (!Array.isArray(leadIds) || leadIds.length === 0) return NextResponse.json({ error: "leadIds required" }, { status: 400 });
  if (!companyBioId) return NextResponse.json({ error: "companyBioId required" }, { status: 400 });
  if (!Array.isArray(steps)) return NextResponse.json({ error: "steps required" }, { status: 400 });
  if (scope.isScoped && companyBioId !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Short-circuit: no tailored slots in the template → nothing to compute
  const stepsHaveSlots = steps.some(s => findTailoredSlots(s.body ?? "").length > 0 || (s.subject && findTailoredSlots(s.subject).length > 0));
  const crHasSlots = !!(connectionRequest && findTailoredSlots(connectionRequest).length > 0);
  if (!stepsHaveSlots && !crHasSlots) {
    return NextResponse.json({ ok: true, results: [], summary: { total: 0, ok: 0, withIssues: 0, byCode: {} }, reason: "no tailored slots in template" });
  }

  const svc = getSupabaseService();
  const [leadsRes, bioRes, sellerRes] = await Promise.all([
    svc.from("leads").select(`
      id, primary_first_name, primary_last_name, primary_title_role, primary_seniority, primary_headline,
      company_name, company_industry, company_sub_industry,
      organization_description, organization_short_desc, organization_technologies,
      recent_website_news, recent_linkedin_post, website_summary, industry_trends,
      employees, annual_revenue, call_talking_points,
      icp_profile_id, company_bio_id
    `).in("id", leadIds),
    svc.from("company_bios").select("company_name, tagline, value_proposition, differentiators, main_services, tone_of_voice").eq("id", companyBioId).maybeSingle(),
    sellerId ? svc.from("sellers").select("name").eq("id", sellerId).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const leadsRaw = (leadsRes.data ?? []) as Array<TailorLead & { icp_profile_id?: string | null; company_bio_id?: string | null }>;
  const bio: TailorCompanyBio = (bioRes.data ?? {}) as TailorCompanyBio;
  const sellerName = (sellerRes.data as { name?: string | null } | null)?.name ?? null;

  // Tenant leak guard
  const leak = leadsRaw.filter(l => l.company_bio_id !== companyBioId);
  if (leak.length > 0) return NextResponse.json({ error: `${leak.length} lead(s) belong to a different tenant` }, { status: 403 });

  const icpId = icpProfileId ?? leadsRaw.find(l => l.icp_profile_id)?.icp_profile_id ?? null;
  const icpRes = icpId
    ? await svc.from("icp_profiles").select("profile_name, target_industries, target_roles, pain_points, solutions_offered, notes").eq("id", icpId).maybeSingle()
    : { data: null };
  const icp = (icpRes.data ?? null) as TailorIcp | null;

  const client = new Anthropic({ apiKey });

  const results: ResultRow[] = await bulkParallel(leadsRaw, async (lead) => {
    const channel = steps[0]?.channel ?? "linkedin";
    const ctx: TailorContext = { lead, icp, companyBio: bio, seller: { name: sellerName }, stepChannel: channel };
    const slots = await callHaiku(client, ctx);
    const renderedSteps = steps.map(s => {
      const subject = s.subject ? substituteTailoredSlots(s.subject, slots ?? {}) : s.subject;
      const subBody = substituteTailoredSlots(s.body ?? "", slots ?? {});
      return { channel: s.channel, subject, body: subBody };
    });
    const renderedCR = connectionRequest ? substituteTailoredSlots(connectionRequest, slots ?? {}) : undefined;

    // Validate the substituted output (where the body finally sits).
    const allViolations: Violation[] = [];
    if (renderedCR) {
      const r = validateMessage({ type: "LINKEDIN_CONNECTION_REQUEST", body: renderedCR }, bio.company_name);
      allViolations.push(...r.violations);
    }
    for (const s of renderedSteps) {
      const r = validateMessage({ type: undefined, body: s.body }, bio.company_name);
      allViolations.push(...r.violations);
    }
    // De-dupe codes — the seller only cares which categories of issue exist on this lead, not per-step duplicates.
    const codes = Array.from(new Set(allViolations.map(v => v.code)));

    const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "(unnamed)";
    return {
      leadId: lead.id,
      name,
      company: lead.company_name ?? null,
      role: lead.primary_title_role ?? null,
      slots,
      rendered: { ...(renderedCR ? { connectionRequest: renderedCR } : {}), steps: renderedSteps },
      violations: codes,
    };
  });

  // Persist for the approve hand-off if this is bound to a campaign_request.
  // Round 3 fix #19: MERGE per-lead instead of overwriting the whole
  // preview_outputs map. If the seller re-runs the batch after editing
  // a single lead's hook/fit, we want to preserve their manual_edit on
  // the leads they didn't touch.
  if (campaignRequestId) {
    const { data: existing } = await svc.from("campaign_requests")
      .select("message_prompts")
      .eq("id", campaignRequestId)
      .maybeSingle();
    const currentMessagePrompts = ((existing?.message_prompts as Record<string, unknown> | null) ?? {});
    const existingPreviewOutputs = (currentMessagePrompts.preview_outputs && typeof currentMessagePrompts.preview_outputs === "object")
      ? currentMessagePrompts.preview_outputs as Record<string, Record<string, unknown>>
      : {};

    const mergedPreviewOutputs: Record<string, unknown> = { ...existingPreviewOutputs };
    for (const r of results) {
      const prev = (existingPreviewOutputs[r.leadId] ?? {}) as Record<string, unknown>;
      mergedPreviewOutputs[r.leadId] = {
        // Preserve any prior manual_edit so a re-run doesn't wipe
        // a seller's hand-tuned hook/fit.
        ...(prev.manual_edit ? { manual_edit: prev.manual_edit } : {}),
        hook: r.slots?.hook ?? null,
        fit: r.slots?.fit ?? null,
        violations: r.violations,
        generated_at: "wizard-batch-preview",
      };
    }
    const next = { ...currentMessagePrompts, preview_outputs: mergedPreviewOutputs };
    await svc.from("campaign_requests").update({ message_prompts: next }).eq("id", campaignRequestId);
  }

  const byCode: Partial<Record<ViolationCode, number>> = {};
  let withIssues = 0;
  for (const r of results) {
    if (r.violations.length > 0) withIssues++;
    for (const c of r.violations) byCode[c] = (byCode[c] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    results,
    summary: { total: results.length, ok: results.length - withIssues, withIssues, byCode },
  });
}
