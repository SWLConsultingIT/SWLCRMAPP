import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope } from "@/lib/scope";
import { renderPlaceholders } from "@/lib/placeholders";

// Returns the auto-reply template text for a given reply + classification
// so the inbox confirm modal can preview and edit it BEFORE sending.
// Read-only — does NOT send anything.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const classification = req.nextUrl.searchParams.get("classification") as "positive" | "negative" | null;
  if (classification !== "positive" && classification !== "negative") {
    return NextResponse.json({ text: null });
  }

  const { data: replyRow } = await supabase
    .from("lead_replies").select("campaign_id, lead_id").eq("id", id).maybeSingle();
  const campaignId = (replyRow as { campaign_id?: string } | null)?.campaign_id ?? null;
  const leadId = (replyRow as { lead_id?: string } | null)?.lead_id ?? null;
  if (!campaignId) return NextResponse.json({ text: null });

  const { data: camp } = await supabase
    .from("campaigns").select("name, metadata, sellers(name)").eq("id", campaignId).maybeSingle();
  const pick = (ar?: { positive?: string; negative?: string } | null) =>
    ((classification === "positive" ? ar?.positive : ar?.negative) ?? "").trim();

  const campMeta = (camp as { metadata?: { autoReplies?: { positive?: string; negative?: string } } } | null)?.metadata;
  let text = pick(campMeta?.autoReplies);

  if (!text) {
    const campName = (camp as { name?: string } | null)?.name ?? null;
    if (campName) {
      const { data: reqRows } = await supabase
        .from("campaign_requests").select("message_prompts").eq("name", campName).limit(8);
      for (const rr of (reqRows ?? [])) {
        const ar = (rr as { message_prompts?: { channelMessages?: { autoReplies?: { positive?: string; negative?: string } } } })
          ?.message_prompts?.channelMessages?.autoReplies;
        const t = pick(ar);
        if (t) { text = t; break; }
      }
    }
  }

  // Render the template so the confirm modal shows the REAL name/company, not
  // raw {{first_name}} placeholders. strict:false — this is a preview, and the
  // authoritative send (/api/inbox/reply) re-renders in strict mode. Strip any
  // leftover token so nothing raw is ever previewed either.
  if (text && leadId) {
    const { data: lead } = await supabase
      .from("leads")
      .select("primary_first_name, primary_last_name, company_name, primary_title_role, company_city, company_industry, company_country, company_website")
      .eq("id", leadId)
      .maybeSingle();
    const sellerName = (camp as { sellers?: { name?: string } | null } | null)?.sellers?.name ?? null;
    if (lead) {
      text = renderPlaceholders(text, lead as Record<string, unknown>, { name: sellerName }, { strict: false })
        .replace(/\{\{[^}]*\}\}/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
    }
  }

  return NextResponse.json({ text: text || null });
}
