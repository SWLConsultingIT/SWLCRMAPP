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
import { sendPushToUsers } from "@/lib/web-push";
import nodemailer from "nodemailer";

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

  // Fire time = due_at − reminder_offset_minutes. Only activities that WANT a
  // reminder (reminder_offset_minutes NOT NULL) qualify; NULL means "no
  // reminder". Offsets are small (10/30/60), so a 1-day lookahead window bounds
  // the fetch; the exact "now >= due_at − offset" test is applied in JS.
  const lookahead = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { data: due, error } = await svc
    .from("activities")
    .select("id, company_bio_id, lead_id, assigned_to, title, type, due_at, reminder_offset_minutes")
    .eq("status", "pending")
    .is("reminder_sent_at", null)
    .not("assigned_to", "is", null)
    .not("reminder_offset_minutes", "is", null)
    .lte("due_at", lookahead)
    .order("due_at", { ascending: true })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nowMs = Date.now();
  const rows = ((due ?? []) as Array<{ id: string; company_bio_id: string; lead_id: string | null; assigned_to: string; title: string; type: string; due_at: string | null; reminder_offset_minutes: number | null }>)
    // fire only once the reminder instant (due_at − offset) has arrived
    .filter(r => r.due_at != null && (Date.parse(r.due_at) - (r.reminder_offset_minutes ?? 0) * 60000) <= nowMs);
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

  // Channel 2 — browser push (best-effort, no-op unless VAPID configured).
  await Promise.all(
    notifications.map(n =>
      sendPushToUsers([n.recipient_user_id], {
        title: "⏰ Reminder",
        body: n.body,
        url: n.link,
        tag: n.lead_id ? `lead-${n.lead_id}` : `activity-${nowIso}`,
      }),
    ),
  );

  // Channel 3 — email fallback (best-effort, no-op unless SMTP configured). One
  // digest email per recipient listing their now-due reminders, so a callback
  // can't be missed even with the browser closed and push off.
  let emailed = 0;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  if (SMTP_USER && SMTP_PASS) {
    const byUser = new Map<string, typeof notifications>();
    for (const n of notifications) {
      const arr = byUser.get(n.recipient_user_id) ?? [];
      arr.push(n);
      byUser.set(n.recipient_user_id, arr);
    }
    const base = process.env.APP_BASE_URL ?? "https://app.swlconsulting.com";
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    for (const [userId, ns] of byUser) {
      try {
        const { data } = await svc.auth.admin.getUserById(userId);
        const to = data?.user?.email;
        if (!to) continue;
        const lines = ns.map(n => `• ${n.body}  →  ${base}${n.link}`).join("\n");
        await transport.sendMail({
          from: `SWL Growth Engine <${SMTP_USER}>`,
          to,
          subject: ns.length === 1 ? "Reminder due" : `${ns.length} reminders due`,
          text: `You have ${ns.length} reminder${ns.length === 1 ? "" : "s"} due now:\n\n${lines}\n\nOpen your activities: ${base}/activities`,
        });
        emailed++;
      } catch { /* best-effort */ }
    }
  }

  return NextResponse.json({ ok: true, fired: notifications.length, emailed });
}
