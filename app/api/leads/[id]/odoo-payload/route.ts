// GET /api/leads/[id]/odoo-payload — assembles the "Send to Odoo" review payload
// for a positive result (SWL demo tenant only). Gathers everything we already
// have — contact, company, the full conversation thread, a link to the live
// chat, and the seller's notes — so the SendToOdooPanel can show it for review
// before the push. AI-written summaries (conversation / company / profile /
// highlights) are generated in Fase 3 via n8n (LAW: AI only through n8n); here
// we surface the raw material + any stored pre-call brief so the seller can
// review/fill them.
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

const SWL_BIO = "7c02e222-be59-416d-9434-acf4685f8590";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const sb = await getSupabaseServer();

  const { data: lead } = await sb
    .from("leads")
    .select("id, company_bio_id, primary_first_name, primary_last_name, primary_title_role, primary_work_email, primary_phone, primary_linkedin_url, primary_headline, primary_seniority, company_name, company_industry, company_website, organization_description, employees, annual_revenue, current_channel, opportunity_notes, opportunity_next_action, call_talking_points")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  if ((lead as any).company_bio_id !== SWL_BIO) {
    return NextResponse.json({ error: "demo-only (SWL Consulting)" }, { status: 403 });
  }
  const L = lead as any;

  // Conversation: sent messages (ours) + inbound replies, merged + chronological.
  const [{ data: sent }, { data: replies }, { data: notes }] = await Promise.all([
    sb.from("campaign_messages").select("channel, content, sent_at, metadata").eq("lead_id", id).eq("status", "sent").order("sent_at", { ascending: true }),
    sb.from("lead_replies").select("channel, reply_text, classification, received_at, provider_thread_id").eq("lead_id", id).order("received_at", { ascending: true }),
    sb.from("lead_notes").select("content, author_name, created_at").eq("lead_id", id).order("created_at", { ascending: true }),
  ]);

  const history: Array<{ from: "us" | "lead"; channel: string | null; text: string; at: string | null }> = [];
  for (const m of sent ?? []) {
    const meta = (m as any).metadata ?? {};
    const text = (meta.rendered_content as string) || (m as any).content || "";
    if (text) history.push({ from: "us", channel: (m as any).channel ?? null, text, at: (m as any).sent_at ?? null });
  }
  for (const r of replies ?? []) {
    if ((r as any).reply_text) history.push({ from: "lead", channel: (r as any).channel ?? null, text: (r as any).reply_text, at: (r as any).received_at ?? null });
  }
  history.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

  const lastReply = (replies ?? []).length ? (replies as any[])[(replies as any[]).length - 1] : null;
  const threadId = lastReply?.provider_thread_id ?? null;

  const sellerComments = [
    L.opportunity_notes ? `Opportunity notes: ${L.opportunity_notes}` : null,
    ...(notes ?? []).map((n: any) => `${n.author_name ?? "Seller"}: ${n.content}`),
  ].filter(Boolean).join("\n\n");

  return NextResponse.json({
    contact: {
      name: `${L.primary_first_name ?? ""} ${L.primary_last_name ?? ""}`.trim(),
      role: L.primary_title_role ?? null,
      email: L.primary_work_email ?? null,
      phone: L.primary_phone ?? null,
      linkedin: L.primary_linkedin_url ?? null,
      headline: L.primary_headline ?? null,
      seniority: L.primary_seniority ?? null,
    },
    company: {
      name: L.company_name ?? null,
      industry: L.company_industry ?? null,
      website: L.company_website ?? null,
      description: L.organization_description ?? null,
      employees: L.employees ?? null,
      annualRevenue: L.annual_revenue ?? null,
    },
    conversation: {
      history,
      count: history.length,
      lastChannel: lastReply?.channel ?? L.current_channel ?? null,
      // Live link back into the app thread (LinkedIn chat id kept for reference).
      link: `/leads/${id}`,
      threadId,
    },
    // Editable drafts — pre-filled from what we have; AI summaries land in Fase 3.
    drafts: {
      conversationSummary: "",
      companySummary: L.organization_description ?? "",
      profileSummary: L.primary_headline ?? "",
      highlights: "",
      sellerComments,
      nextAction: L.opportunity_next_action ?? "",
    },
    hasBrief: Array.isArray(L.call_talking_points) && L.call_talking_points.length > 0,
    nextAction: L.opportunity_next_action ?? null,
  });
}
