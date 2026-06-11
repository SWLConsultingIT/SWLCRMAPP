import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Floor for `sellers.linkedin_daily_limit`.
//
// Per Fran 2026-06-11: the daily INVITE cap is set MANUALLY per account in
// /accounts and is the source of truth. This cron no longer runs an automatic
// age-based ramp — the old 5/8/12/20 curve never matched reality (accounts
// were hand-tuned to 15/40/50, which fell outside the ramp set, so the ramp
// did nothing anyway). It now does ONE thing: give a brand-new account that
// has NO cap yet (`linkedin_daily_limit IS NULL`) a conservative starting
// floor so it can't fire at the enforcement default (20) before anyone
// configures it. Any account that already has a value — ANY value — is left
// untouched. The operator owns the number from then on, via /accounts.

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const NEW_ACCOUNT_FLOOR = 5;

function authorized(req: NextRequest, scopeRole: string | null): boolean {
  if (scopeRole === "admin") return true;
  if (!CRON_SECRET) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${CRON_SECRET}`;
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }

async function handle(req: NextRequest) {
  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (!authorized(req, scope.role ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();

  // Only active sellers with a Unipile account (the dispatcher routes through
  // Unipile). We touch ONLY rows whose cap is still NULL.
  const { data: sellers, error: sellersErr } = await svc
    .from("sellers")
    .select("id, name, linkedin_daily_limit, unipile_account_id")
    .eq("active", true)
    .not("unipile_account_id", "is", null);

  if (sellersErr) {
    return NextResponse.json({ error: sellersErr.message }, { status: 500 });
  }

  const initialized: Array<{ id: string; name: string | null; to: number }> = [];
  const skipped: Array<{ id: string; name: string | null; reason: string }> = [];

  for (const s of sellers ?? []) {
    const current = (s as any).linkedin_daily_limit ?? null;
    // Manual value present → never touch it. The operator owns the number.
    if (current !== null) {
      skipped.push({ id: s.id, name: s.name, reason: `manual (current=${current})` });
      continue;
    }
    // No cap configured yet → seed a conservative floor so it never inherits
    // the enforcement default (20) un-warmed.
    const { error: updErr } = await svc
      .from("sellers")
      .update({ linkedin_daily_limit: NEW_ACCOUNT_FLOOR })
      .eq("id", s.id);
    if (updErr) {
      skipped.push({ id: s.id, name: s.name, reason: `db_error: ${updErr.message}` });
      continue;
    }
    initialized.push({ id: s.id, name: s.name, to: NEW_ACCOUNT_FLOOR });
  }

  return NextResponse.json({
    ok: true,
    processed: sellers?.length ?? 0,
    initialized: initialized.length,
    initialized_rows: initialized,
    skipped,
  });
}
