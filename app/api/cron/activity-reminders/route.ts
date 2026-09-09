// Activity reminder dispatcher (P0-2). Fires an in-app notification when a
// pending activity's due_at has arrived, so a callback can't be lost if the
// seller closed the browser / changed device / comes back the next day.
//
// Dedupe: a reminder is claimed by setting activities.reminder_sent_at, and we
// only ever look at rows where it's NULL — so a reminder fires exactly once,
// even across overlapping cron runs. We CLAIM (update) before inserting the
// notification, so a crash can at worst drop one reminder, never duplicate it.
//
// Delivery reuses the existing in-app `notifications` feed (NotificationBell +
// Realtime) — no new surface. Scheduled by Vercel Cron (vercel.json); the
// Bearer CRON_SECRET gate matches every other cron so n8n could drive it too.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

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
  const svc = getSupabaseService();
  const nowIso = new Date().toISOString();

  // Candidates: pending, not yet reminded, due now, with a recipient.
  const { data: due, error } = await svc
    .from("activities")
    .select("id, company_bio_id, lead_id, assigned_to, title, type")
    .eq("status", "pending")
    .is("reminder_sent_at", null)
    .not("assigned_to", "is", null)
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (due ?? []) as Array<{ id: string; company_bio_id: string; lead_id: string | null; assigned_to: string; title: string; type: string }>;
  if (rows.length === 0) return NextResponse.json({ ok: true, fired: 0 });

  // CLAIM first (atomic-ish): mark reminded so a concurrent run won't re-pick.
  const ids = rows.map(r => r.id);
  const { error: claimErr } = await svc
    .from("activities")
    .update({ reminder_sent_at: nowIso })
    .in("id", ids)
    .is("reminder_sent_at", null);
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });

  // Optional: enrich the notification with the lead's company (plaintext only —
  // we never decrypt in a cron). Missing company just yields a barer line.
  const leadIds = Array.from(new Set(rows.map(r => r.lead_id).filter(Boolean))) as string[];
  const companyByLead = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = await svc.from("leads").select("id, company_name").in("id", leadIds);
    for (const l of leads ?? []) {
      const name = (l as { company_name: string | null }).company_name;
      if (name) companyByLead.set((l as { id: string }).id, name);
    }
  }

  const notifications = rows.map(r => {
    const company = r.lead_id ? companyByLead.get(r.lead_id) : null;
    return {
      company_bio_id: r.company_bio_id,
      recipient_user_id: r.assigned_to,
      type: "activity_reminder",
      lead_id: r.lead_id,
      body: company ? `${r.title} · ${company}` : r.title,
      link: r.lead_id ? `/leads/${r.lead_id}` : "/activities",
      created_at: nowIso,
    };
  });
  const { error: notifErr } = await svc.from("notifications").insert(notifications);
  if (notifErr) return NextResponse.json({ error: notifErr.message, fired: 0, claimed: ids.length }, { status: 500 });

  return NextResponse.json({ ok: true, fired: notifications.length });
}
