import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAdminMenu } from "@/lib/scope";

const SB_URL = "https://uljoengwmmwdqpcxnbjs.supabase.co/rest/v1";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// List sellers for a tenant.
//
// Two modes (kept on one endpoint to avoid proliferation):
//
//   - Admin mode (default): used by the Team UI invite modal. Returns
//     `{ id, name, userId }` for tenant-owned sellers only. Gated to
//     owner/manager/super_admin via canViewAdminMenu.
//
//   - Usable mode (?usable=1): used by campaign-launch flows. Returns the
//     sellers a tenant can actually use — own + shared via admin "Sellers
//     shared with this client". No admin gate (every authed user in the
//     tenant needs this to launch a campaign). Returns
//     `{ id, name, linkedin_daily_limit, active }`.
export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const usable = url.searchParams.get("usable") === "1" || url.searchParams.get("active") === "1";

  // Resolve tenant — super_admin can override via ?bioId, everyone else is
  // pinned to their own scope.
  const requestedBioId = url.searchParams.get("bioId");
  let bioId: string | null;
  if (scope.tier === "super_admin") {
    bioId = requestedBioId ?? scope.companyBioId;
  } else {
    bioId = scope.companyBioId;
  }
  if (!bioId) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const svc = getSupabaseService();

  if (usable) {
    const { data } = await svc
      .from("sellers")
      .select("id, name, linkedin_daily_limit, active, company_bio_id, shared_with_company_bio_ids")
      .or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`)
      .eq("active", true)
      .order("name", { ascending: true });
    return NextResponse.json({
      sellers: (data ?? []).map(s => ({
        id: s.id as string,
        name: (s.name as string) ?? "(unnamed)",
        linkedin_daily_limit: (s.linkedin_daily_limit as number | null) ?? null,
      })),
    });
  }

  // Admin mode (existing behavior — must stay gated).
  if (!canViewAdminMenu(scope.tier)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data } = await svc
    .from("sellers")
    .select("id, name, user_id")
    .eq("company_bio_id", bioId)
    .order("name", { ascending: true });

  return NextResponse.json({
    sellers: (data ?? []).map(s => ({
      id: s.id as string,
      name: (s.name as string) ?? "(unnamed)",
      userId: (s.user_id as string | null) ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const allowed = [
    "name", "active",
    "linkedin_account_id", "linkedin_daily_limit", "linkedin_connections_limit",
    "email_account", "email_daily_limit",
    "whatsapp_account", "whatsapp_daily_limit",
    "instagram_account", "telegram_account",
    "unipile_account_id", "call_daily_limit",
  ];
  const payload: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) payload[k] = body[k];

  if (!payload.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const res = await fetch(`${SB_URL}/sellers`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data }, { status: res.status });
  return NextResponse.json({ ok: true, seller: data[0] });
}
