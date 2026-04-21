import { NextRequest, NextResponse } from "next/server";

const PASSWORD = "SWL2025";

const USERS = ["Admin", "Francisco Fontana", "Sales Team"];

export async function POST(req: NextRequest) {
  const { user, password } = await req.json();

  if (!USERS.includes(user) || password !== PASSWORD) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("crm_auth", user, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: "lax",
  });
  return res;
}
