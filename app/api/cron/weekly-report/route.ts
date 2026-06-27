// Weekly seller performance report — runs every Monday 8am (wired in n8n Orquestador).
// Queries the last 7 days of activity across all tenants, groups by seller, and
// sends one email per tenant to the configured REPORT_RECIPIENTS address.
//
// Required env vars (add to Vercel):
//   SMTP_USER  — Google Workspace sender, defaults to sales@swlconsulting.com
//   SMTP_PASS  — Google App Password for that mailbox
//   REPORT_RECIPIENTS — comma-separated to: addresses, defaults to SMTP_USER
//
// Auth: Bearer CRON_SECRET (same as all other crons).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
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

// ── Types ─────────────────────────────────────────────────────────────────────

type SellerStat = {
  sellerId: string;
  name: string;
  emailsSent: number;
  linkedinConnSent: number;
  linkedinMsgSent: number;
  callsDialed: number;
  callsAnswered: number;
  repliesTotal: number;
  repliesPositive: number;
};

type TenantReport = {
  bioId: string;
  name: string;
  sellers: SellerStat[];
};

// ── Main handler ──────────────────────────────────────────────────────────────

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const daysParam = parseInt(url.searchParams.get("days") ?? "7", 10);
  const days = isNaN(daysParam) || daysParam < 1 ? 7 : Math.min(daysParam, 90);

  const svc = getSupabaseService();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // ── 1. Load all tenants ────────────────────────────────────────────────────
  const { data: bios } = await svc.from("company_bios").select("id, company_name").is("archived_at", null);
  const tenantNames = new Map<string, string>();
  for (const b of bios ?? []) tenantNames.set(b.id as string, (b.company_name as string | null) ?? b.id);

  // ── 2. Load all active sellers ────────────────────────────────────────────
  const { data: sellers } = await svc.from("sellers").select("id, name, active, company_bio_id, user_id").eq("active", true);
  const allSellers = sellers ?? [];

  // seller_id → bio_id
  const sellerTenant = new Map<string, string>();
  // user_id → seller_id
  const userToSeller = new Map<string, string>();
  // bio_id → seller[]
  const sellersByTenant = new Map<string, typeof allSellers>();

  for (const s of allSellers) {
    const sid = s.id as string;
    const bio = s.company_bio_id as string | null;
    const uid = s.user_id as string | null;
    if (bio) {
      sellerTenant.set(sid, bio);
      if (!sellersByTenant.has(bio)) sellersByTenant.set(bio, []);
      sellersByTenant.get(bio)!.push(s);
    }
    if (uid) userToSeller.set(uid, sid);
  }

  // ── 3. Campaign messages sent this week ───────────────────────────────────
  // Join lead to get company_bio_id for tenant scoping.
  type MsgRow = {
    campaign_id: string | null;
    channel: string | null;
    campaigns: { seller_id: string | null; leads: { company_bio_id: string | null } | null } | null;
  };
  const { data: rawMsgs } = await svc
    .from("campaign_messages")
    .select("campaign_id, channel, campaigns!inner(seller_id, leads!inner(company_bio_id))")
    .eq("status", "sent")
    .gte("sent_at", since);

  // seller_id → { email, linkedinConn, linkedinMsg, bio }
  const msgsBySeller = new Map<string, { email: number; linkedinConn: number; linkedinMsg: number; bio: string }>();
  for (const m of (rawMsgs ?? []) as unknown as MsgRow[]) {
    const camp = m.campaigns;
    if (!camp) continue;
    const sid = camp.seller_id;
    const bio = camp.leads?.company_bio_id;
    if (!sid || !bio) continue;
    if (!msgsBySeller.has(sid)) msgsBySeller.set(sid, { email: 0, linkedinConn: 0, linkedinMsg: 0, bio });
    const g = msgsBySeller.get(sid)!;
    const ch = (m.channel ?? "").toLowerCase();
    if (ch === "email")           g.email++;
    else if (ch === "linkedin_connection" || ch === "connection") g.linkedinConn++;
    else if (ch === "linkedin" || ch === "linkedin_message")      g.linkedinMsg++;
  }

  // ── 4. Calls this week ────────────────────────────────────────────────────
  type CallRow = {
    dialed_by_user_id: string | null;
    duration: number | null;
    leads: { company_bio_id: string | null } | null;
  };
  const { data: rawCalls } = await svc
    .from("calls")
    .select("dialed_by_user_id, duration, leads!inner(company_bio_id)")
    .gte("started_at", since);

  // seller_id → { dialed, answered }
  const callsBySeller = new Map<string, { dialed: number; answered: number }>();
  for (const c of (rawCalls ?? []) as unknown as CallRow[]) {
    const uid = c.dialed_by_user_id;
    if (!uid) continue;
    const sid = userToSeller.get(uid);
    if (!sid) continue;
    if (!callsBySeller.has(sid)) callsBySeller.set(sid, { dialed: 0, answered: 0 });
    const g = callsBySeller.get(sid)!;
    g.dialed++;
    if ((c.duration ?? 0) > 0) g.answered++;
  }

  // ── 5. Replies this week ──────────────────────────────────────────────────
  type ReplyRow = {
    campaign_id: string | null;
    classification: string | null;
    campaigns: { seller_id: string | null } | null;
  };
  const { data: rawReplies } = await svc
    .from("lead_replies")
    .select("campaign_id, classification, campaigns(seller_id)")
    .gte("received_at", since);

  // seller_id → { total, positive }
  const repliesBySeller = new Map<string, { total: number; positive: number }>();
  for (const r of (rawReplies ?? []) as unknown as ReplyRow[]) {
    const sid = r.campaigns?.seller_id;
    if (!sid) continue;
    if (!repliesBySeller.has(sid)) repliesBySeller.set(sid, { total: 0, positive: 0 });
    const g = repliesBySeller.get(sid)!;
    g.total++;
    if (r.classification === "positive") g.positive++;
  }

  // ── 6. Assemble per-tenant reports ────────────────────────────────────────
  const reports: TenantReport[] = [];

  for (const [bioId, tenantSellers] of sellersByTenant) {
    const stats: SellerStat[] = tenantSellers.map(s => {
      const sid = s.id as string;
      const msgs = msgsBySeller.get(sid) ?? { email: 0, linkedinConn: 0, linkedinMsg: 0 };
      const calls = callsBySeller.get(sid) ?? { dialed: 0, answered: 0 };
      const replies = repliesBySeller.get(sid) ?? { total: 0, positive: 0 };
      return {
        sellerId: sid,
        name: (s.name as string | null) ?? "Seller",
        emailsSent: msgs.email,
        linkedinConnSent: msgs.linkedinConn,
        linkedinMsgSent: msgs.linkedinMsg,
        callsDialed: calls.dialed,
        callsAnswered: calls.answered,
        repliesTotal: replies.total,
        repliesPositive: replies.positive,
      };
    });

    // Skip tenants where everyone has zero activity
    const hasActivity = stats.some(s =>
      s.emailsSent + s.linkedinConnSent + s.linkedinMsgSent + s.callsDialed + s.repliesTotal > 0
    );
    if (!hasActivity) continue;

    // Sort by total messages desc
    stats.sort((a, b) =>
      (b.emailsSent + b.linkedinConnSent + b.linkedinMsgSent + b.callsDialed) -
      (a.emailsSent + a.linkedinConnSent + a.linkedinMsgSent + a.callsDialed)
    );

    reports.push({ bioId, name: tenantNames.get(bioId) ?? bioId, sellers: stats });
  }

  if (reports.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, note: "no activity this week" });
  }

  // ── 7. Build HTML email ───────────────────────────────────────────────────
  const fromDate = new Date(since).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  const toDate   = new Date().toLocaleDateString("es-AR",  { day: "numeric", month: "short", year: "numeric" });
  const subject  = `📊 Reporte semanal de sellers · ${fromDate} – ${toDate}`;
  const html     = buildHtml(reports, fromDate, toDate, days);

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, subject, tenants: reports.map(r => r.name), html });
  }

  // ── 8. Send via SMTP ──────────────────────────────────────────────────────
  const smtpUser = process.env.SMTP_USER ?? "sales@swlconsulting.com";
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpPass) {
    return NextResponse.json({ error: "SMTP_PASS env var not set" }, { status: 500 });
  }

  const recipients = process.env.REPORT_RECIPIENTS
    ? process.env.REPORT_RECIPIENTS.split(",").map(e => e.trim()).filter(Boolean)
    : [smtpUser];

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.sendMail({
    from: `"GrowthAI Reports" <${smtpUser}>`,
    to: recipients.join(", "),
    subject,
    html,
  });

  return NextResponse.json({ ok: true, sent: 1, to: recipients, tenants: reports.map(r => r.name) });
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildHtml(reports: TenantReport[], fromDate: string, toDate: string, days: number): string {
  const gold   = "#C9A83A";
  const bg     = "#0C0E1B";
  const card   = "#131629";
  const border = "#1E2238";
  const muted  = "#8A90A8";
  const white  = "#E8EAF2";

  const tenantBlocks = reports.map(tenant => {
    const rows = tenant.sellers.map((s, i) => {
      const totalOut = s.emailsSent + s.linkedinConnSent + s.linkedinMsgSent + s.callsDialed;
      const ansRate  = s.callsDialed > 0 ? Math.round((s.callsAnswered / s.callsDialed) * 100) : 0;
      const posRate  = s.repliesTotal > 0 ? Math.round((s.repliesPositive / s.repliesTotal) * 100) : 0;
      const rowBg    = i % 2 === 0 ? card : `${card}dd`;
      return `
        <tr style="background:${rowBg}">
          <td style="padding:10px 14px;color:${white};font-weight:600;font-size:13px;border-bottom:1px solid ${border}">${s.name}</td>
          <td style="padding:10px 14px;text-align:center;color:${muted};font-size:13px;border-bottom:1px solid ${border}">${s.emailsSent}</td>
          <td style="padding:10px 14px;text-align:center;color:${muted};font-size:13px;border-bottom:1px solid ${border}">${s.linkedinConnSent}</td>
          <td style="padding:10px 14px;text-align:center;color:${muted};font-size:13px;border-bottom:1px solid ${border}">${s.linkedinMsgSent}</td>
          <td style="padding:10px 14px;text-align:center;color:${s.callsDialed > 0 ? white : muted};font-size:13px;border-bottom:1px solid ${border};font-weight:${s.callsDialed > 0 ? 700 : 400}">
            ${s.callsDialed}${s.callsDialed > 0 ? ` <span style="font-size:10px;color:${muted}">(${ansRate}% ans)</span>` : ""}
          </td>
          <td style="padding:10px 14px;text-align:center;color:${muted};font-size:13px;border-bottom:1px solid ${border}">${s.repliesTotal}</td>
          <td style="padding:10px 14px;text-align:center;border-bottom:1px solid ${border}">
            ${s.repliesPositive > 0
              ? `<span style="background:rgba(34,197,94,0.15);color:#4ade80;font-size:12px;font-weight:700;padding:2px 8px;border-radius:20px">${s.repliesPositive}${s.repliesTotal > 0 ? ` (${posRate}%)` : ""}</span>`
              : `<span style="color:${muted};font-size:12px">0</span>`}
          </td>
          <td style="padding:10px 14px;text-align:center;border-bottom:1px solid ${border}">
            <span style="font-size:12px;font-weight:700;color:${totalOut > 0 ? gold : muted}">${totalOut}</span>
          </td>
        </tr>`;
    }).join("");

    // Tenant totals
    const tot = tenant.sellers.reduce((acc, s) => ({
      email: acc.email + s.emailsSent,
      conn:  acc.conn  + s.linkedinConnSent,
      msg:   acc.msg   + s.linkedinMsgSent,
      calls: acc.calls + s.callsDialed,
      ans:   acc.ans   + s.callsAnswered,
      rep:   acc.rep   + s.repliesTotal,
      pos:   acc.pos   + s.repliesPositive,
    }), { email: 0, conn: 0, msg: 0, calls: 0, ans: 0, rep: 0, pos: 0 });
    const totOut   = tot.email + tot.conn + tot.msg + tot.calls;
    const totAns   = tot.calls > 0 ? Math.round((tot.ans  / tot.calls) * 100) : 0;
    const totPos   = tot.rep   > 0 ? Math.round((tot.pos  / tot.rep)   * 100) : 0;

    return `
    <!-- tenant: ${tenant.name} -->
    <div style="margin-bottom:32px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="display:inline-block;width:3px;height:20px;background:${gold};border-radius:2px;flex-shrink:0"></span>
        <h2 style="margin:0;font-size:16px;font-weight:700;color:${white}">${tenant.name}</h2>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${card};border-radius:10px;overflow:hidden;border:1px solid ${border}">
        <thead>
          <tr style="background:${bg}">
            <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border}">Seller</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:600;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border}">Emails</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:600;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border}">LI Conn</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:600;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border}">LI Msgs</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:600;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border}">Calls</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:600;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border}">Replies</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:600;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border}">Positivos</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:600;color:${gold};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border}">Total Out</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr style="background:${bg}">
            <td style="padding:10px 14px;font-size:12px;font-weight:700;color:${gold}">Total</td>
            <td style="padding:10px 14px;text-align:center;font-size:12px;font-weight:700;color:${white}">${tot.email}</td>
            <td style="padding:10px 14px;text-align:center;font-size:12px;font-weight:700;color:${white}">${tot.conn}</td>
            <td style="padding:10px 14px;text-align:center;font-size:12px;font-weight:700;color:${white}">${tot.msg}</td>
            <td style="padding:10px 14px;text-align:center;font-size:12px;font-weight:700;color:${white}">${tot.calls}${tot.calls > 0 ? ` <span style="font-size:10px;color:${muted}">(${totAns}%)</span>` : ""}</td>
            <td style="padding:10px 14px;text-align:center;font-size:12px;font-weight:700;color:${white}">${tot.rep}</td>
            <td style="padding:10px 14px;text-align:center;font-size:12px;font-weight:700;color:#4ade80">${tot.pos}${tot.rep > 0 ? ` <span style="font-size:10px;color:${muted}">(${totPos}%)</span>` : ""}</td>
            <td style="padding:10px 14px;text-align:center;font-size:13px;font-weight:800;color:${gold}">${totOut}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte semanal de sellers</title></head>
<body style="margin:0;padding:0;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:760px;margin:0 auto;padding:32px 24px">
    <!-- Header -->
    <div style="margin-bottom:28px">
      <div style="display:inline-block;background:rgba(201,168,58,0.12);border:1px solid rgba(201,168,58,0.3);border-radius:6px;padding:4px 12px;margin-bottom:12px">
        <span style="font-size:11px;font-weight:700;color:${gold};text-transform:uppercase;letter-spacing:0.1em">GrowthAI · Reporte Semanal</span>
      </div>
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:${white}">Actividad de sellers</h1>
      <p style="margin:0;font-size:13px;color:${muted}">${fromDate} – ${toDate} · últimos ${days} días</p>
    </div>

    <!-- Tenant blocks -->
    ${tenantBlocks}

    <!-- Footer -->
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid ${border}">
      <p style="margin:0;font-size:11px;color:${muted}">
        Generado automáticamente por GrowthAI · <a href="https://swlcrmapp.vercel.app/dashboard" style="color:${gold};text-decoration:none">Ver dashboard →</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}
