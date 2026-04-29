import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserScope, DEMO_SESSION_COOKIE } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

// POST /api/admin/demos/enter  body: { bioId: string }
// Sets the demo-impersonation cookie. Admin-only. The cookie is HttpOnly so
// client JS can't tamper; readable in server components / RSC + API routes.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (scope.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { bioId } = (await req.json().catch(() => ({}))) as { bioId?: string };
  if (!bioId || typeof bioId !== "string") {
    return NextResponse.json({ error: "bioId required" }, { status: 400 });
  }

  // Enforce that the target is a real demo tenant — never let an admin
  // enter "demo mode" pointed at a real client.
  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("id, company_name, is_demo")
    .eq("id", bioId)
    .eq("is_demo", true)
    .maybeSingle();
  if (!bio?.id) {
    return NextResponse.json({ error: "Not a demo tenant" }, { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.set(DEMO_SESSION_COOKIE, bio.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8h — demo sessions die at end of working day
  });

  return NextResponse.json({ ok: true, bioId: bio.id, companyName: bio.company_name });
}
