import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

// Tenant-scoped settings — currently exposes call_classification_mode (per-tenant).
// Each tenant has its own value stored on company_bios.

async function getCompanyBioId() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return profile?.company_bio_id ?? null;
}

export async function GET() {
  const bioId = await getCompanyBioId();
  if (!bioId) return NextResponse.json({});

  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("call_classification_mode")
    .eq("id", bioId)
    .maybeSingle();

  return NextResponse.json({
    call_classification_mode: bio?.call_classification_mode ?? "manual",
  });
}

export async function PATCH(req: NextRequest) {
  const bioId = await getCompanyBioId();
  if (!bioId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  if (body.call_classification_mode === "manual" || body.call_classification_mode === "auto") {
    update.call_classification_mode = body.call_classification_mode;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { error } = await svc
    .from("company_bios")
    .update(update)
    .eq("id", bioId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...update });
}
