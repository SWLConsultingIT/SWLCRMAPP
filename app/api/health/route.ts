// Lightweight health probe for external uptime monitors (UptimeRobot,
// Better Uptime, Cronitor, BetterStack, etc.). Returns 200 when Postgres
// is reachable within ~2s; 503 otherwise.
//
// Designed so a 1-min external ping schedule produces ~1 row fetched per
// minute against company_bios (smallest table, always cached after first
// hit) — total DB pressure ~negligible vs. the cost of NOT knowing the
// app is down (which is what got us in trouble on 2026-05-15).
//
// Public route — no auth. The query uses the service-role key but only
// reads `id` from one row, so there is no data exposure. It is, however,
// rate-limit-able from upstream (Vercel edge) if abuse appears.
//
// Wire your monitor to alert on:
//   - 2 consecutive non-200 responses, OR
//   - latencyMs > 2000 sustained for >3 checks.

import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DB_TIMEOUT_MS = 2000;

export async function GET() {
  const start = Date.now();
  const svc = getSupabaseService();

  try {
    // Race a trivial SELECT against a 2s timeout. Postgres saturation
    // typically shows as queries queuing for tens of seconds — we'd
    // rather return 503 fast than hold the connection.
    const probe = svc.from("company_bios").select("id").limit(1);
    const result = await Promise.race([
      probe,
      new Promise<{ error: { message: string } }>((_, reject) =>
        setTimeout(() => reject(new Error(`db probe exceeded ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS)
      ),
    ]);

    const elapsed = Date.now() - start;
    if ("error" in result && result.error) {
      return NextResponse.json(
        { ok: false, latencyMs: elapsed, error: result.error.message },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true, latencyMs: elapsed });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, latencyMs: Date.now() - start, error: e?.message ?? "probe failed" },
      { status: 503 }
    );
  }
}
