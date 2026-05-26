// Returns the full chronological conversation for a lead — outbound messages
// we sent (campaign_messages) merged with inbound replies (lead_replies) and
// connection-accept events. Used by the Inbox right pane so the seller sees
// the actual back-and-forth, not just the latest reply in isolation.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const runtime = "nodejs";

type ThreadEntry = {
  id: string;
  direction: "outbound" | "inbound" | "event";
  channel: string | null;
  body: string;
  subject?: string | null;
  at: string;
  classification?: string | null;
  stepNumber?: number | null;
  kind?: string;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { leadId } = await params;
  if (!leadId) return NextResponse.json({ error: "missing leadId" }, { status: 400 });

  const svc = getSupabaseService();

  // Tenant gate — only fetch threads for leads in the caller's tenant scope.
  // Super_admin sees everything.
  if (scope.isScoped && scope.companyBioId) {
    const { data: lead } = await svc
      .from("leads")
      .select("company_bio_id")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead || lead.company_bio_id !== scope.companyBioId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  const [messagesRes, repliesRes] = await Promise.all([
    svc
      .from("campaign_messages")
      .select("id, step_number, channel, content, status, sent_at, scheduled_for, created_at, metadata")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true }),
    svc
      .from("lead_replies")
      .select("id, channel, reply_text, received_at, classification")
      .eq("lead_id", leadId)
      .order("received_at", { ascending: true }),
  ]);

  const entries: ThreadEntry[] = [];

  for (const m of messagesRes.data ?? []) {
    // Only include messages that actually went out OR are queued/sent (skip pure drafts
    // that the seller hasn't sent yet — they're not part of the lead's experience).
    const status = (m as any).status as string | null;
    if (status !== "sent" && status !== "dispatching" && status !== "queued") continue;
    const sentAt = (m as any).sent_at || (m as any).scheduled_for || (m as any).created_at;
    const meta = ((m as any).metadata ?? {}) as Record<string, unknown>;
    // Some workflows write the rendered (placeholder-interpolated) body to
    // metadata.rendered_content; prefer that over the template if present.
    const renderedFromMeta = typeof meta.rendered_content === "string" ? (meta.rendered_content as string) : null;
    const body = renderedFromMeta || ((m as any).content as string | null) || "";
    entries.push({
      id: `out-${(m as any).id}`,
      direction: "outbound",
      channel: (m as any).channel ?? null,
      body,
      at: sentAt,
      stepNumber: (m as any).step_number ?? null,
      kind: status === "sent" ? "sent" : status,
    });
  }

  for (const r of repliesRes.data ?? []) {
    entries.push({
      id: `in-${(r as any).id}`,
      direction: "inbound",
      channel: (r as any).channel ?? null,
      body: (r as any).reply_text || "",
      at: (r as any).received_at,
      classification: (r as any).classification ?? null,
    });
  }

  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return NextResponse.json({ thread: entries });
}
