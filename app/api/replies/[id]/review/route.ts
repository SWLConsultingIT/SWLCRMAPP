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

  const { error } = await supabase
    .from("lead_replies")
    .update(patch)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
