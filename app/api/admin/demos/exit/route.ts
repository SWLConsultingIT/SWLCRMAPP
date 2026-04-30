import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DEMO_SESSION_COOKIE } from "@/lib/scope";

// POST /api/admin/demos/exit  body: {}
// Clears the demo-impersonation cookie. Doesn't require role check — anyone
// who has the cookie should be able to drop it (no privilege escalation).
export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set(DEMO_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return NextResponse.json({ ok: true });
}
