// Daily cron that hard-deletes any company_bio archived more than 30 days ago.
// The 30-day window is enforced inside the SECURITY DEFINER RPC, so even if
// this route's bearer leaked it can't shrink the window.
//
// Scheduled via vercel.json (or Hostinger cron pinging this URL with the
// CRON_SECRET bearer).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!CRON_SECRET || presented !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();
  const { data, error } = await svc.rpc("hard_delete_expired_archives");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...(data as object) });
}
