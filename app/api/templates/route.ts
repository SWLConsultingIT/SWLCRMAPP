// Campaign templates — Phase 1A (Fran 2026-05-14).
//
// GET  /api/templates       — list templates for current tenant
// POST /api/templates       — create from a campaignId (extracts steps + messages)
//                             OR from raw body (advanced — direct definition)
//
// Tenant isolation: getUserScope drives company_bio_id. Templates with
// company_bio_id IS NULL (legacy seeds) are intentionally excluded — they're
// not in the message-content format the user-facing wizard expects.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

type SaveFromCampaignBody = {
  mode?: "from_campaign";
  campaignId: string;
  name: string;
  description?: string;
  tags?: string[];
};

type SaveFromScratchBody = {
  mode: "from_scratch";
  name: string;
  description?: string;
  tags?: string[];
  channels?: string[];
  sequence_steps: Array<{ channel: string; daysAfter: number }>;
  step_messages: {
    connectionRequest?: string;
    steps: Array<{ step: number; channel: string; subject?: string | null; body: string }>;
    autoReplies?: { positive?: string; negative?: string; question?: string };
  };
  attachments?: Array<{ filename: string; storage_path?: string; mime_type?: string; size_bytes?: number }>;
};

type SaveBody = SaveFromCampaignBody | SaveFromScratchBody;

export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ templates: [] });

  const svc = getSupabaseService();

  const url = new URL(req.url);
  const searchQ = url.searchParams.get("q")?.trim() ?? "";
  const channel = url.searchParams.get("channel")?.trim();

  let q = svc
    .from("campaign_templates")
    .select("id, name, description, channels, tags, usage_count, last_used_at, created_at, updated_at")
    .eq("company_bio_id", scope.companyBioId)
    .order("usage_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(100);

  if (searchQ.length > 0) {
    // ilike on name OR description. PostgREST or/ilike compose.
    q = q.or(`name.ilike.%${searchQ}%,description.ilike.%${searchQ}%`);
  }
  if (channel) {
    q = q.contains("channels", [channel]);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId || !scope.companyBioId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as SaveBody;
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // From-scratch path: user defined the sequence + messages directly in the
  // template editor, no source campaign. Skip the campaign-extraction logic
  // entirely and write straight to campaign_templates.
  if (body.mode === "from_scratch") {
    const fs = body as SaveFromScratchBody;
    if (!Array.isArray(fs.sequence_steps) || fs.sequence_steps.length === 0) {
      return NextResponse.json({ error: "sequence_steps is required and non-empty" }, { status: 400 });
    }
    if (!fs.step_messages || typeof fs.step_messages !== "object") {
      return NextResponse.json({ error: "step_messages is required" }, { status: 400 });
    }

    const channels = Array.isArray(fs.channels) && fs.channels.length > 0
      ? fs.channels
      : Array.from(new Set(fs.sequence_steps.map(s => s.channel).filter(Boolean))) as string[];

    const { data: created, error: insErr } = await svc
      .from("campaign_templates")
      .insert({
        company_bio_id: scope.companyBioId,
        name: fs.name.trim(),
        description: fs.description?.trim() ?? null,
        sequence_steps: fs.sequence_steps,
        step_messages: fs.step_messages,
        attachments: Array.isArray(fs.attachments) ? fs.attachments : [],
        tags: Array.isArray(fs.tags) ? fs.tags.slice(0, 10) : [],
        channels,
        created_by: scope.userId,
      })
      .select("id, name")
      .single();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    return NextResponse.json({ template: created });
  }

  // From-campaign path (original): extract sequence + messages + attachments
  // from an existing campaign + its campaign_messages rows.
  const fc = body as SaveFromCampaignBody;
  if (!fc.campaignId) {
    return NextResponse.json({ error: "campaignId is required when not in from_scratch mode" }, { status: 400 });
  }

  // Pull the source campaign + verify tenant ownership via the lead's bio_id
  // (campaigns table also has company_bio_id but we cross-check both).
  const { data: camp, error: campErr } = await svc
    .from("campaigns")
    .select("id, name, sequence_steps, channel, lead_id, company_bio_id, leads!inner(company_bio_id)")
    .eq("id", fc.campaignId)
    .maybeSingle();

  if (campErr || !camp) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  const lead = Array.isArray((camp as any).leads) ? (camp as any).leads[0] : (camp as any).leads;
  const ownerBioId = (camp as any).company_bio_id ?? lead?.company_bio_id;
  if (ownerBioId && ownerBioId !== scope.companyBioId) {
    return NextResponse.json({ error: "Forbidden (cross-tenant)" }, { status: 403 });
  }

  // Pull message content per step from the existing campaign_messages rows.
  // We capture the AS-IS content (with `{{first_name}}` etc still as
  // placeholders — these get re-rendered per lead when the dispatcher runs).
  const { data: msgs } = await svc
    .from("campaign_messages")
    .select("step_number, channel, content, metadata")
    .eq("campaign_id", fc.campaignId)
    .order("step_number", { ascending: true });

  // Shape step_messages like the wizard's `channelMessages` so the apply
  // path can hand it straight back to the campaign-create flow.
  const stepMessages = {
    connectionRequest: "",
    steps: [] as Array<{ step: number; channel: string; subject: string | null; body: string }>,
    autoReplies: { positive: "", negative: "" },
  };
  for (const m of msgs ?? []) {
    const stepNum = (m as any).step_number as number;
    const channel = (m as any).channel as string;
    const content = ((m as any).content as string) ?? "";
    if (stepNum === 0 && channel === "linkedin") {
      stepMessages.connectionRequest = content;
      continue;
    }
    const subject = ((m as any).metadata as { subject?: string } | null)?.subject ?? null;
    stepMessages.steps.push({ step: stepNum, channel, subject, body: content });
  }

  // Capture attachments from message metadata (Phase 1A: data-only, no UI yet).
  const attachments: Array<{ filename: string; storage_path: string; mime_type?: string; size_bytes?: number }> = [];
  for (const m of msgs ?? []) {
    const meta = ((m as any).metadata ?? {}) as { attachments?: unknown };
    if (Array.isArray(meta.attachments)) {
      for (const att of meta.attachments) {
        if (att && typeof att === "object" && (att as any).storage_path) {
          attachments.push(att as any);
        }
      }
    }
  }

  // Derive channels from sequence_steps for fast filtering on the list view.
  const seqSteps = Array.isArray((camp as any).sequence_steps) ? (camp as any).sequence_steps : [];
  const channels = Array.from(new Set(seqSteps.map((s: any) => s.channel).filter(Boolean))) as string[];

  const { data: created, error: insErr } = await svc
    .from("campaign_templates")
    .insert({
      company_bio_id: scope.companyBioId,
      name: fc.name.trim(),
      description: fc.description?.trim() ?? null,
      sequence_steps: seqSteps,
      step_messages: stepMessages,
      attachments,
      tags: Array.isArray(fc.tags) ? fc.tags.slice(0, 10) : [],
      channels,
      created_by: scope.userId,
    })
    .select("id, name")
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ template: created });
}
