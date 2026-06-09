// POST /api/campaigns/preview-tailor
//
// Renders the tailored slot output for a handful of sample leads BEFORE
// the campaign is approved, so the seller can sanity-check the AI's
// hook + fit quality without burning a full campaign approve cycle.
//
// Companion to /api/campaigns/tailor — same prompt builder + Haiku
// model, but takes leadIds + template steps inline instead of looking
// them up from an existing campaign. Capped at PREVIEW_MAX_LEADS to
// keep latency under ~10s.
//
// Body:
//   {
//     leadIds: string[],          // 1-PREVIEW_MAX_LEADS sample leads
//     icpProfileId?: string,      // optional ICP override (ICP otherwise inferred from each lead)
//     companyBioId: string,       // tenant bio for OUR company context
//     sellerId?: string,          // optional — used only for seller.name in the prompt
//     steps: Array<{ channel: string; body: string; subject?: string | null }>,
//                                 // step bodies as the wizard currently has them
//     connectionRequest?: string  // LinkedIn invite copy, if any
//   }
//
// Returns:
//   {
//     ok: true,
//     leads: [
//       {
//         leadId, name, company, role,
//         slots: { hook, fit } | null,
//         rendered: { connectionRequest?: string, steps: { channel, body, subject? }[] }
//       }, ...
//     ]
//   }

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
const PREVIEW_MAX_LEADS = 3;
const CONCURRENCY = 3;

async function callHaiku(client: Anthropic, ctx: TailorContext): Promise<TailoredSlots | null> {
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
    // Same JSON extractor as the V8 Assemble Campaign — robust to
    // prose/fences wrapping the JSON.
    const start = text.indexOf("{");
    if (start === -1) return null;
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
    if (end === -1) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as { hook?: string; fit?: string };
    if (typeof parsed.hook !== "string" || typeof parsed.fit !== "string") return null;
    return { hook: parsed.hook.trim(), fit: parsed.fit.trim() };
  } catch {
    return null;
  }
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

  type Body = {
    leadIds?: string[];
    icpProfileId?: string;
    companyBioId?: string;
    sellerId?: string;
    steps?: Array<{ channel: string; body: string; subject?: string | null }>;
    connectionRequest?: string;
  };
  const body = (await req.json().catch(() => ({}))) as Body;
  const { leadIds, icpProfileId, companyBioId, sellerId, steps, connectionRequest } = body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) return NextResponse.json({ error: "leadIds required" }, { status: 400 });
  if (!companyBioId) return NextResponse.json({ error: "companyBioId required" }, { status: 400 });
  if (!Array.isArray(steps)) return NextResponse.json({ error: "steps required" }, { status: 400 });
  if (scope.isScoped && companyBioId !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  // Short-circuit: if no step OR the connection request contains a
  // tailored slot, the preview adds nothing — return immediately.
  const stepsHaveSlots = (steps ?? []).some(s => findTailoredSlots(s.body ?? "").length > 0 || (s.subject && findTailoredSlots(s.subject).length > 0));
  const crHasSlots = !!(connectionRequest && findTailoredSlots(connectionRequest).length > 0);
  if (!stepsHaveSlots && !crHasSlots) {
    return NextResponse.json({ ok: true, leads: [], reason: "no tailored slots in template" });
  }

  const svc = getSupabaseService();
  const limitedLeadIds = leadIds.slice(0, PREVIEW_MAX_LEADS);

  // Load lead rows + bio + (optionally) ICPs.
  const [leadsRes, bioRes, sellerRes] = await Promise.all([
    svc.from("leads")
      .select(`
        id, primary_first_name, primary_last_name, primary_title_role, primary_seniority, primary_headline,
        company_name, company_industry, company_sub_industry,
        organization_description, organization_short_desc, organization_technologies,
        recent_website_news, recent_linkedin_post, website_summary, industry_trends,
        employees, annual_revenue, call_talking_points,
        icp_profile_id, company_bio_id
      `)
      .in("id", limitedLeadIds),
    svc.from("company_bios").select("company_name, tagline, value_proposition, differentiators, main_services, tone_of_voice").eq("id", companyBioId).maybeSingle(),
    sellerId ? svc.from("sellers").select("name").eq("id", sellerId).maybeSingle() : Promise.resolve({ data: null as { name?: string | null } | null }),
  ]);
  const leadsRaw = (leadsRes.data ?? []) as Array<TailorLead & { icp_profile_id?: string | null; company_bio_id?: string | null }>;
  const companyBio: TailorCompanyBio = bioRes.data ?? {};
  const sellerName = (sellerRes.data as { name?: string | null } | null)?.name ?? null;

  // Tenant guard: every lead must belong to the requested bio.
  const leakLeads = leadsRaw.filter(l => l.company_bio_id !== companyBioId);
  if (leakLeads.length > 0) {
    return NextResponse.json({ error: `${leakLeads.length} lead(s) belong to a different tenant` }, { status: 403 });
  }

  // ICP: prefer the override if given, otherwise pull the per-lead ICP
  // (they should all share one given the one-ICP-per-campaign law).
  const icpIdToFetch = icpProfileId ?? leadsRaw.find(l => l.icp_profile_id)?.icp_profile_id ?? null;
  const icpRes = icpIdToFetch
    ? await svc.from("icp_profiles").select("profile_name, target_industries, target_roles, pain_points, solutions_offered, notes").eq("id", icpIdToFetch).maybeSingle()
    : { data: null };
  const icp: TailorIcp | null = (icpRes.data as TailorIcp | null) ?? null;

  const client = new Anthropic({ apiKey });

  // For each lead: fire ONE Haiku call (one (hook,fit) per lead) and
  // substitute into every step body + the CR. Preview is intentionally
  // simpler than the production tailor — no per-channel slot pass.
  const out = await bulkParallel(leadsRaw, async (lead) => {
    const firstChannel = steps[0]?.channel ?? "linkedin";
    const ctx: TailorContext = {
      lead,
      icp,
      companyBio,
      seller: { name: sellerName },
      stepChannel: firstChannel,
    };
    const slots = await callHaiku(client, ctx);
    const renderedSteps = (steps ?? []).map(s => ({
      channel: s.channel,
      subject: s.subject ? substituteTailoredSlots(s.subject, slots ?? {}) : s.subject,
      body: substituteTailoredSlots(s.body ?? "", slots ?? {}),
    }));
    const renderedCR = connectionRequest ? substituteTailoredSlots(connectionRequest, slots ?? {}) : undefined;
    return {
      leadId: lead.id,
      name: `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "(unnamed)",
      company: lead.company_name ?? null,
      role: lead.primary_title_role ?? null,
      slots,
      rendered: {
        ...(renderedCR !== undefined ? { connectionRequest: renderedCR } : {}),
        steps: renderedSteps,
      },
    };
  });

  return NextResponse.json({ ok: true, leads: out });
}
