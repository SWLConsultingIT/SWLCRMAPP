import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";
import { NextRequest, NextResponse } from "next/server";

// Lists Aircall users and lets super_admin assign one to a seller. Without
// this mapping, dispatch-call / dial both fall back to "first user with
// available=true" globally — which steals calls between tenants when more
// than one seller is signed in (Lucia in SWL ringing on a Pathway lead's
// dispatch). Per-seller user_id resolution removes that.

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`,
).toString("base64");

type AircallUser = {
  id: number;
  name: string;
  email: string | null;
  available: boolean | null;
  availability_status: string | null;
};

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const usersRes = await fetch("https://api.aircall.io/v1/users?per_page=50", {
    headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
    next: { revalidate: 60 },
  });
  if (!usersRes.ok) {
    return NextResponse.json({ error: `Aircall ${usersRes.status}` }, { status: 502 });
  }
  const { users = [] } = (await usersRes.json()) as { users: AircallUser[] };

  const supabase = getSupabaseService();
  const { data: sellers } = await supabase
    .from("sellers")
    .select("id, name, aircall_user_id, company_bio_id, active")
    .order("name", { ascending: true });

  return NextResponse.json({
    aircallUsers: users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      available: u.available,
    })),
    sellers: sellers ?? [],
  });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const { sellerId, aircallUserId } = await req.json();
  if (!sellerId) return NextResponse.json({ error: "sellerId required" }, { status: 400 });
  // Pass `null` to clear the assignment; otherwise must be a numeric string.
  const value = aircallUserId === null || aircallUserId === undefined || aircallUserId === ""
    ? null
    : String(aircallUserId);
  const supabase = getSupabaseService();
  const { error } = await supabase
    .from("sellers")
    .update({ aircall_user_id: value })
    .eq("id", sellerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, aircall_user_id: value });
}
