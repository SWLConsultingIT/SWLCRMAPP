import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { DEMO_SESSION_COOKIE } from "@/lib/scope";

export async function POST() {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  const res = NextResponse.json({ ok: true });
  // Every cookie that personalizes the UI MUST be cleared at logout. If any
  // survives, the next user that logs into this browser inherits the previous
  // user's identity/preferences — a tenant-leak class bug.
  //
  //  - swl-brand    : tenant primary color used by login pre-auth
  //  - DEMO_SESSION : admin demo impersonation override (would silently fake
  //                   the next admin login as the demo identity)
  //  - swl-theme    : per-user dark/light preference; without clearing, user A's
  //                   choice would render for user B on first paint
  //  - swl-locale   : per-user EN/ES preference; same leak class as theme
  const expire = (name: string, httpOnly = false) =>
    `${name}=; Path=/; Max-Age=0; SameSite=Lax${httpOnly ? "; HttpOnly" : ""}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  res.headers.append("Set-Cookie", expire("swl-brand"));
  res.headers.append("Set-Cookie", expire(DEMO_SESSION_COOKIE, true));
  res.headers.append("Set-Cookie", expire("swl-theme"));
  res.headers.append("Set-Cookie", expire("swl-locale"));
  return res;
}
