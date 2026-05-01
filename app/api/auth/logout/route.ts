import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { DEMO_SESSION_COOKIE } from "@/lib/scope";

export async function POST() {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  const res = NextResponse.json({ ok: true });
  // Clear the tenant brand cookie so the next visit to /login shows the SWL
  // default gold instead of the previous tenant's color.
  res.headers.append("Set-Cookie", "swl-brand=; Path=/; Max-Age=0; SameSite=Lax");
  // Clear the demo impersonation cookie. If an admin entered a demo tenant
  // and then logged out without exiting demo mode, the cookie used to survive
  // the auth flip — so the next admin login was still served as the demo
  // identity (role faked to "client", admin menu hidden, top-right showing
  // the demo company). Tenant-leak class bug; clear the cookie at the door.
  res.headers.append(
    "Set-Cookie",
    `${DEMO_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return res;
}
