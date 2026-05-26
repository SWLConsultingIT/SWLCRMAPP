import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope } from "@/lib/scope";

const ALLOWED_STATES = new Set(["approved", "rejected", "pending"]);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as { status?: string } | null;
  const status = body?.status;
  if (!status || !ALLOWED_STATES.has(status)) {
    return NextResponse.json({ error: "status must be approved|rejected|pending" }, { status: 400 });
  }

  // Tenant guard: scoped users can only mark their own replies. Cross-tenant
  // super_admin can mark anything. The join via leads enforces the tenant
  // because lead_replies has no company_bio_id of its own.
  const scope = await getUserScope();
  if (scope.isScoped && scope.companyBioId) {
    const { data: rep } = await supabase
      .from("lead_replies")
      .select("id, leads!inner(company_bio_id)")
      .eq("id", id)
      .single();
    const replyBioId = (rep as any)?.leads?.company_bio_id;
    if (!rep || replyBioId !== scope.companyBioId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  // Optional classification override — sent by the inbox quick-classify
  // buttons so a seller can both correct the AI's guess AND mark the row
  // reviewed in a single round trip.
  //
  // "follow_up" is NOT an enum value of reply_classification. It's a UI-only
  // intent meaning "I saw this, no classification change, campaign keeps
  // running, will respond manually later". Treat it as a review-only action
  // — mark the row reviewed but leave the AI's classification alone.
  // Writing it to the enum column was the cause of the 500 in production
  // (incident 2026-05-25: clicking the ❓ Follow-up button toasted
  // "invalid input value for enum reply_classification: 'follow_up'").
  const ENUM_CLASS = new Set(["positive", "negative", "question", "meeting_intent", "needs_info", "nurturing", "not_now", "unsubscribe", "spam", "auto_reply"]);
  const classOverride = (body as { classification?: string }).classification;
  const patch: Record<string, unknown> = {
    review_status: status,
    requires_human_review: status === "pending",
  };
  if (classOverride && ENUM_CLASS.has(classOverride)) {
    patch.classification = classOverride;
  }
  // follow_up falls through: no classification write, just the review_status
  // update above. Campaign / lead state stays untouched.

  const { data: replyRow, error } = await supabase
    .from("lead_replies")
    .update(patch)
    .eq("id", id)
    .select("lead_id, campaign_id, reply_text, channel")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ─── Cascade to campaign + lead state when the seller manually classifies ──
  // When the AI marked a reply ambiguous (or just wrong) and the seller picks
  // positive/negative from the Inbox, mirror the same side-effects the
  // automated handler does so the seller doesn't have to also stop the
  // campaign from another screen.
  //
  // - positive → pause campaign as 'completed' w/ stop_reason='lead_responded_positive',
  //              lead.status='qualified', lead.archived=true.
  // - negative → same, plus a 90-day lead_suppressions row so future
  //              renurture passes ignore this lead.
  // - follow_up / no override → no cascade.
  //
  // Wrapped in try/catch — the lead_replies update already succeeded; the
  // cascade is best-effort so a partial failure (e.g. campaign already
  // closed) doesn't surface as an error to the seller.
  const cascadeOn = classOverride === "positive" || classOverride === "negative";
  if (cascadeOn && replyRow) {
    const leadId = (replyRow as any).lead_id as string | null;
    const campaignId = (replyRow as any).campaign_id as string | null;
    const replyText = ((replyRow as any).reply_text as string | null) ?? "";
    const channel = ((replyRow as any).channel as string | null) ?? "linkedin";
    const stopReason = `lead_responded_${classOverride}`;
    const now = new Date().toISOString();

    const updates: Promise<unknown>[] = [];

    if (campaignId) {
      updates.push(
        supabase
          .from("campaigns")
          .update({
            status: "completed",
            stop_reason: stopReason,
            completed_at: now,
          })
          .eq("id", campaignId)
          // Don't reopen a campaign that's already terminal.
          .in("status", ["active", "paused"]) as unknown as Promise<unknown>,
      );
    }

    if (leadId) {
      const leadPatch: Record<string, unknown> = {
        responded: true,
        linkedin_connected: channel === "linkedin" ? true : undefined,
      };
      if (classOverride === "positive") {
        leadPatch.status = "qualified";
        leadPatch.archived = true;
        leadPatch.response_outcome = "interested";
      } else {
        leadPatch.status = "closed_lost";
        leadPatch.archived = true;
        leadPatch.response_outcome = "not_interested";
      }
      // Strip undefined keys before PATCH
      for (const k of Object.keys(leadPatch)) if (leadPatch[k] === undefined) delete leadPatch[k];
      updates.push(
        supabase.from("leads").update(leadPatch).eq("id", leadId) as unknown as Promise<unknown>,
      );

      if (classOverride === "negative") {
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        updates.push(
          supabase.from("lead_suppressions").insert({
            lead_id: leadId,
            channel,
            reason: "lead_responded_negative",
            negative_reply_text: replyText,
            source: "manual_inbox_classify",
            active: true,
            expires_at: expiresAt,
          }) as unknown as Promise<unknown>,
        );
      }
    }

    await Promise.all(updates).catch(() => { /* best-effort */ });
  }

  return NextResponse.json({ ok: true, cascadeApplied: cascadeOn });
}
