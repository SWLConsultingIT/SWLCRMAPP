import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const store = await cookies();
  const user = store.get("crm_auth")?.value ?? null;
  return NextResponse.json({ user });
}
