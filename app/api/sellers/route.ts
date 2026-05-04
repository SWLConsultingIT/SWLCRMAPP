import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAdminMenu } from "@/lib/scope";

const SB_URL = "https://uljoengwmmwdqpcxnbjs.supabase.co/rest/v1";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// List sellers for a tenant — used by the Team UI invite modal so admins can
// link a seller-tier user to an existing seller record. Returns id, name, and
// the current user_id link (if any) so the UI can disable already-linked
// sellers in the picker.
//
// Authorization: super_admin (any tenant) or owner/manager of the requested tenant.
export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewAdminMenu(scope.tier)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const requestedBioId = url.searchParams.get("bioId");
  let bioId: string | null;
  if (scope.tier === "super_admin") {
    bioId = requestedBioId ?? scope.companyBioId;
  } else {
    bioId = scope.companyBioId;
  }
  if (!bioId) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const svc = getSupabaseService();
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
