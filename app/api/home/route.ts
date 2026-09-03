import { NextResponse } from "next/server";
import { getHomeData } from "@/lib/home-data";

// GET /api/home — the "Tu día" buckets + top-3 priorities for the current user,
// scoped to their tenant (and, for sellers, to their own assigned work).
// Never cached: the home is a live action surface.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await getHomeData();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/home] failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "home data failed" }, { status: 500 });
  }
}
