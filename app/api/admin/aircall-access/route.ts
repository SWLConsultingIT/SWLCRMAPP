import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";
import { NextRequest, NextResponse } from "next/server";

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
).toString("base64");

type AircallNumber = { id: number; name: string; digits: string; country: string };

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const supabase = getSupabaseService();
  const [res, { data: bios }] = await Promise.all([
    fetch("https://api.aircall.io/v1/numbers", {
      headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
      next: { revalidate: 300 },
    }),
    supabase.from("company_bios").select("id, company_name, aircall_number_ids, aircall_user_id").order("company_name"),
  ]);
  const { numbers = [] } = (await res.json()) as { numbers: AircallNumber[] };
  return NextResponse.json({ numbers, companies: bios ?? [] });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const body = await req.json();
  const { companyBioId, aircallNumberIds, aircallUserId } = body;
  if (!companyBioId) return NextResponse.json({ error: "Missing companyBioId" }, { status: 400 });
  const supabase = getSupabaseService();
  // Build patch object — only update fields that were sent. Lets the UI
  // mutate numbers and the tenant default user independently.
  const patch: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "aircallNumberIds")) {
    patch.aircall_number_ids = Array.isArray(aircallNumberIds) ? aircallNumberIds : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "aircallUserId")) {
    patch.aircall_user_id = aircallUserId === null || aircallUserId === undefined || aircallUserId === ""
      ? null
      : String(aircallUserId);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const { error } = await supabase.from("company_bios").update(patch).eq("id", companyBioId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
