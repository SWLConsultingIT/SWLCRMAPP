import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope } from "@/lib/scope";

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
    .from("lead_replies").select("campaign_id").eq("id", id).maybeSingle();
  const campaignId = (replyRow as { campaign_id?: string } | null)?.campaign_id ?? null;
  if (!campaignId) return NextResponse.json({ text: null });

  const { data: camp } = await supabase
    .from("campaigns").select("name, metadata").eq("id", campaignId).maybeSingle();
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

  return NextResponse.json({ text: text || null });
}
