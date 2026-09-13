// Thin entrypoint. The reminder rules live in the feature
// (features/activities/server/reminders.ts); this file owns only what belongs
// to the route: the CRON_SECRET gate, the segment config, and turning the
// result into a Response. Scheduled by Vercel Cron (vercel.json); the Bearer
// gate matches every other cron so n8n could drive it too.

import { NextRequest, NextResponse } from "next/server";
import { runActivityReminders } from "@/features/activities/server/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

function authorized(req: NextRequest): boolean {
  if (!CRON_SECRET) return false;
  const h = req.headers.get("authorization") ?? "";
  return h === `Bearer ${CRON_SECRET}`;
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { status, body } = await runActivityReminders();
  return NextResponse.json(body, { status });
}
