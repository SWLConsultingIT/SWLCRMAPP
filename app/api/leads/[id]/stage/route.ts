import { NextRequest, NextResponse } from "next/server";
import { requireUser, assertTenant } from "@/lib/require-scope";

const SB_URL = "https://uljoengwmmwdqpcxnbjs.supabase.co/rest/v1";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const { id } = await params;
  const body = await req.json();

  const allowed = ["opportunity_stage", "opportunity_notes", "opportunity_next_action"];
  const patch: Record<string, string> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  // Tenant guard: the lead must belong to the caller's tenant.
  const lookup = await fetch(`${SB_URL}/leads?id=eq.${id}&select=company_bio_id`, { headers: H });
  if (!lookup.ok) return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  const rows = (await lookup.json()) as Array<{ company_bio_id: string | null }>;
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  const denied = assertTenant(g.scope, rows[0].company_bio_id);
  if (denied) return denied;

  const res = await fetch(`${SB_URL}/leads?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}
