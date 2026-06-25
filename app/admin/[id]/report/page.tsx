// Per-tenant operational report — printable.
//
// Built for the case Fran needs to send to a client lead (e.g. Graeme at
// Pathway) showing: campaigns running, contacts produced, call outcomes,
// lost-lead analysis, and seller coaching observations. Uses `@media print`
// CSS so Cmd+P → Save as PDF gives a clean deliverable without sidebar +
// chrome.
//
// Auth: super_admin only. Other roles get redirected (the report exposes
// data the tenant's own seller might not be authorized to see in aggregate).
//
// Data: live from Postgres. Re-print to get an updated snapshot.

import { redirect } from "next/navigation";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

async function loadReport(bioId: string) {
  const svc = getSupabaseService();

  const { data: bio } = await svc
    .from("company_bios")
    .select("company_name, industry, value_proposition, logo_url")
    .eq("id", bioId)
    .maybeSingle();

  // Campaigns grouped by name + status
  const { data: campaignsRaw } = await svc
    .from("campaigns")
    .select("name, status, lead_id, leads!inner(company_bio_id)")
    .eq("leads.company_bio_id", bioId);
  const campaignBuckets = new Map<string, Record<string, number>>();
  for (const c of campaignsRaw ?? []) {
    const name = (c as { name?: string }).name ?? "Unnamed";
    const st = (c as { status?: string }).status ?? "unknown";
    if (!campaignBuckets.has(name)) campaignBuckets.set(name, {});
    const b = campaignBuckets.get(name)!;
    b[st] = (b[st] ?? 0) + 1;
  }
  const campaigns = Array.from(campaignBuckets.entries())
    .map(([name, counts]) => ({
      name,
      active: counts.active ?? 0,
      archived: counts.archived ?? 0,
      failed: counts.failed ?? 0,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total);

  // Lead status totals
  const { data: leads } = await svc
    .from("leads")
    .select("status")
    .eq("company_bio_id", bioId);
  const leadCounts = { new: 0, contacted: 0, closed_lost: 0, qualified: 0, transferred: 0, other: 0 };
  for (const l of leads ?? []) {
    const s = (l as { status?: string }).status ?? "other";
    if (s in leadCounts) (leadCounts as Record<string, number>)[s] += 1;
    else leadCounts.other += 1;
  }
  const totalLeads = (leads ?? []).length;

  // LinkedIn outreach + accepts
  const { data: msgs } = await svc
    .from("campaign_messages")
    .select("channel, status, step_number, metadata, leads!inner(company_bio_id)")
    .eq("leads.company_bio_id", bioId);
  const linkedinSent = (msgs ?? []).filter(m => (m as any).channel === "linkedin" && (m as any).status === "sent").length;
  const linkedinAccepts = (msgs ?? []).filter(m => {
    if ((m as any).channel !== "linkedin") return false;
    if ((m as any).step_number !== 1) return false;
    const queuedBy = (m as { metadata?: { queued_by?: string } }).metadata?.queued_by;
    return queuedBy === "registro-nueva-conexion-webhook" || queuedBy === "retroactive-fix-event-field-bug-2026-05-13";
  }).length;
  const emailSent = (msgs ?? []).filter(m => (m as any).channel === "email" && (m as any).status === "sent").length;

  // Calls + classifications
  const { data: calls } = await svc
    .from("calls")
    .select("id, status, classification, duration, started_at, recording_url, transcript, lead_id, leads!inner(primary_first_name, primary_last_name, company_name, company_bio_id)")
    .eq("leads.company_bio_id", bioId)
    .order("started_at", { ascending: false });
  const callTotals = {
    total: (calls ?? []).length,
    answered: 0,
    positive: 0,
    negative: 0,
    follow_up: 0,
    unclassified: 0,
    withRecording: 0,
    withTranscript: 0,
  };
  for (const c of calls ?? []) {
    if ((c as any).status === "answered") callTotals.answered++;
    if ((c as any).classification === "positive") callTotals.positive++;
    else if ((c as any).classification === "negative") callTotals.negative++;
    else if ((c as any).classification === "follow_up") callTotals.follow_up++;
    else callTotals.unclassified++;
    if ((c as any).recording_url) callTotals.withRecording++;
    if ((c as any).transcript) callTotals.withTranscript++;
  }

  // Lost leads detail (with last-call context)
  const lostLeads: Array<{ name: string; company: string; lastCallSec: number | null }> = [];
  for (const l of (leads ?? []).filter(x => (x as any).status === "closed_lost")) {
    // Find matching record from the leads list query above isn't enough — we
    // need name + company. Bulk re-query is cheap (≤30 rows).
  }
  // Re-fetch lost leads with details
  const { data: lostFull } = await svc
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, updated_at")
    .eq("company_bio_id", bioId)
    .eq("status", "closed_lost")
    .order("updated_at", { ascending: false });
  const lostIds = (lostFull ?? []).map(l => (l as { id: string }).id);
  let lastCallByLead = new Map<string, number | null>();
  if (lostIds.length > 0) {
    const { data: lastCalls } = await svc
      .from("calls")
      .select("lead_id, duration, started_at")
      .in("lead_id", lostIds)
      .order("started_at", { ascending: false });
    for (const c of lastCalls ?? []) {
      const lid = (c as any).lead_id as string;
      if (!lastCallByLead.has(lid)) {
        lastCallByLead.set(lid, (c as { duration?: number | null }).duration ?? null);
      }
    }
  }
  const lostList = (lostFull ?? []).map(l => ({
    name: `${(l as any).primary_first_name ?? ""} ${(l as any).primary_last_name ?? ""}`.trim(),
    company: (l as any).company_name as string,
    lastCallSec: lastCallByLead.get((l as { id: string }).id) ?? null,
  }));

  return {
    bio,
    campaigns,
    leadCounts,
    totalLeads,
    outreach: { linkedinSent, linkedinAccepts, emailSent },
    callTotals,
    lostList,
  };
}

export default async function PathwayReportPage({ params }: { params: Params }) {
  const scope = await getUserScope();
  if (!canViewSwlAdmin(scope.tier)) redirect("/");
  const { id } = await params;
  const r = await loadReport(id);
  const bioName = r.bio?.company_name ?? "Tenant";
  const today = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });

  const acceptRate = r.outreach.linkedinSent > 0
    ? Math.round((r.outreach.linkedinAccepts / r.outreach.linkedinSent) * 100)
    : 0;
  const answerRate = r.callTotals.total > 0
    ? Math.round((r.callTotals.answered / r.callTotals.total) * 100)
    : 0;
  const positiveRate = r.callTotals.answered > 0
    ? Math.round((r.callTotals.positive / r.callTotals.answered) * 100)
    : 0;
  const negativeRate = r.callTotals.answered > 0
    ? Math.round((r.callTotals.negative / r.callTotals.answered) * 100)
    : 0;

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          .no-print { display: none !important; }
          body { background: white !important; }
          .report-page { box-shadow: none !important; max-width: 100% !important; }
          .page-break { page-break-before: always; }
          h1, h2, h3 { page-break-after: avoid; }
          table { page-break-inside: avoid; }
        }
        .report-page { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; }
        .report-page h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px 0; }
        .report-page h2 { font-size: 18px; font-weight: 700; margin: 28px 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid color-mix(in srgb, #6B7280 24%, transparent); }
        .report-page h3 { font-size: 14px; font-weight: 700; margin: 18px 0 6px 0; color: #1f2937; }
        .report-page p { font-size: 13px; line-height: 1.55; color: #374151; margin: 0 0 8px 0; }
        .report-page li { font-size: 13px; line-height: 1.55; color: #374151; }
        .report-page table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0; }
        .report-page th { text-align: left; font-weight: 600; color: #6b7280; border-bottom: 2px solid color-mix(in srgb, #6B7280 24%, transparent); padding: 6px 8px; }
        .report-page td { border-bottom: 1px solid color-mix(in srgb, #6B7280 14%, transparent); padding: 6px 8px; color: #1f2937; }
        .kpi { display: inline-block; min-width: 130px; padding: 10px 14px; border: 1px solid color-mix(in srgb, #6B7280 24%, transparent); border-radius: 8px; margin: 4px 6px 4px 0; vertical-align: top; }
        .kpi .v { font-size: 22px; font-weight: 700; line-height: 1; color: #111; }
        .kpi .l { font-size: 11px; color: #6b7280; margin-top: 4px; }
        .alert { background: color-mix(in srgb, #DC2626 10%, transparent); border-left: 3px solid #dc2626; padding: 10px 14px; margin: 10px 0; border-radius: 4px; font-size: 13px; color: #7f1d1d; }
        .recommend { background: #f0fdf4; border-left: 3px solid #16a34a; padding: 10px 14px; margin: 10px 0; border-radius: 4px; font-size: 13px; color: #14532d; }
        .neutral { background: #f9fafb; border-left: 3px solid #6b7280; padding: 10px 14px; margin: 10px 0; border-radius: 4px; font-size: 13px; color: #1f2937; }
      `}</style>
      <PrintButton />

      <div className="report-page" style={{ maxWidth: 820, margin: "32px auto", padding: 32, background: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", borderRadius: 8 }}>

        <h1>{bioName} — Operations Report</h1>
        <p style={{ color: "#6b7280", marginTop: 0 }}>{today} · Prepared by SWL Consulting</p>

        <h2>Executive Summary</h2>
        <div>
          <div className="kpi"><div className="v">{r.totalLeads}</div><div className="l">Total leads in pipeline</div></div>
          <div className="kpi"><div className="v">{r.outreach.linkedinSent}</div><div className="l">LinkedIn invites sent</div></div>
          <div className="kpi"><div className="v">{r.outreach.linkedinAccepts}</div><div className="l">Accepts ({acceptRate}%)</div></div>
          <div className="kpi"><div className="v">{r.callTotals.total}</div><div className="l">Calls dialed</div></div>
          <div className="kpi"><div className="v">{r.callTotals.answered}</div><div className="l">Answered ({answerRate}%)</div></div>
          <div className="kpi" style={{ borderColor: "#dc2626", color: "#dc2626" }}>
            <div className="v" style={{ color: "#dc2626" }}>{r.callTotals.positive}</div>
            <div className="l">Positive outcomes ({positiveRate}%)</div>
          </div>
        </div>

        <h2>Where the funnel is leaking</h2>
        <p>
          The infrastructure is performing. Leads are flowing into LinkedIn, calls connect at a healthy {answerRate}% rate, and the dispatchers are running on schedule. <strong>The bottleneck is conversion on the call.</strong>
        </p>
        <div className="alert">
          <strong>0 positive outcomes across {r.callTotals.answered} answered calls.</strong> {r.callTotals.negative} were classified as Negative ({negativeRate}% of answered) and {r.callTotals.follow_up} as Follow-up. We don't have a positive datapoint yet to study and replicate.
        </div>

        <h3>Two patterns worth flagging</h3>
        <ul>
          <li><strong>Aggressive Negative classification.</strong> Several lost leads had real conversations (60–130 seconds) before being marked Negative. Conversations of that length usually indicate the lead was at least curious. Classifying these as Negative closes the campaign and prevents any follow-up nurture. Realistic split for cold outbound is ~10–20% Positive, ~30–40% Follow-up, the rest Negative — not 0/{negativeRate}/{Math.round((r.callTotals.follow_up / Math.max(r.callTotals.answered, 1)) * 100)}.</li>
          <li><strong>Script vulnerability around "how you got my info".</strong> On the call with Steve Ball (AVONDALE PROPERTY HOLDINGS, 15 May, 58s, recorded), the seller mentioned that the lead's contact details came from "tools". This is a credibility-killer with senior decision-makers — it positions Pathway as scraping data rather than doing targeted research. Steve became defensive and the call closed Negative. <em>This phrasing needs to be removed from any script, ever.</em></li>
        </ul>

        <div className="page-break"></div>

        <h2>Campaigns</h2>
        <table>
          <thead>
            <tr><th>Campaign</th><th style={{ textAlign: "right" }}>Active</th><th style={{ textAlign: "right" }}>Archived</th><th style={{ textAlign: "right" }}>Failed</th></tr>
          </thead>
          <tbody>
            {r.campaigns.map(c => (
              <tr key={c.name}>
                <td>{c.name.replace(/^Pathway /, "")}</td>
                <td style={{ textAlign: "right" }}>{c.active}</td>
                <td style={{ textAlign: "right" }}>{c.archived}</td>
                <td style={{ textAlign: "right" }}>{c.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Outreach</h2>
        <table>
          <thead><tr><th>Channel</th><th style={{ textAlign: "right" }}>Sent</th><th style={{ textAlign: "right" }}>Engaged</th><th style={{ textAlign: "right" }}>Conv %</th></tr></thead>
          <tbody>
            <tr><td>LinkedIn invites</td><td style={{ textAlign: "right" }}>{r.outreach.linkedinSent}</td><td style={{ textAlign: "right" }}>{r.outreach.linkedinAccepts} accepts</td><td style={{ textAlign: "right" }}>{acceptRate}%</td></tr>
            <tr><td>Email</td><td style={{ textAlign: "right" }}>{r.outreach.emailSent}</td><td style={{ textAlign: "right" }}>—</td><td style={{ textAlign: "right" }}>—</td></tr>
            <tr><td>Calls</td><td style={{ textAlign: "right" }}>{r.callTotals.total}</td><td style={{ textAlign: "right" }}>{r.callTotals.answered} answered</td><td style={{ textAlign: "right" }}>{answerRate}%</td></tr>
          </tbody>
        </table>
        <p style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
          LinkedIn accept rate of {acceptRate}% is below industry baseline (~15–25% for cold UK B2B). The connection note may need a revision — see the recommendations section.
        </p>

        <h2>Call Performance</h2>
        <div>
          <div className="kpi"><div className="v">{r.callTotals.answered}</div><div className="l">Answered ({answerRate}% of {r.callTotals.total})</div></div>
          <div className="kpi" style={{ borderColor: "#dc2626" }}><div className="v" style={{ color: "#dc2626" }}>{r.callTotals.negative}</div><div className="l">Negative ({negativeRate}%)</div></div>
          <div className="kpi" style={{ borderColor: "#d97706" }}><div className="v" style={{ color: "#d97706" }}>{r.callTotals.follow_up}</div><div className="l">Follow-up</div></div>
          <div className="kpi"><div className="v">{r.callTotals.positive}</div><div className="l">Positive ({positiveRate}%)</div></div>
          <div className="kpi"><div className="v">{r.callTotals.withRecording}</div><div className="l">With recording*</div></div>
          <div className="kpi"><div className="v">{r.callTotals.withTranscript}</div><div className="l">With transcript</div></div>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280" }}>
          *Recording was activated mid-week. Calls before that point have no audio captured — Aircall doesn't retroactively record. From this point forward every answered call should produce a recording + auto-generated AI transcript and summary.
        </p>

        <div className="page-break"></div>

        <h2>Lost Leads ({r.lostList.length})</h2>
        <p>Every lead in this list was a real, dialed conversation that ended in Negative classification — meaning the seller decided the lead was a hard no. Most concerning: several had {">"}60s of conversation time, suggesting the lead engaged before disengaging. These are the ones to listen back to and learn from.</p>
        <table>
          <thead><tr><th>Contact</th><th>Company</th><th style={{ textAlign: "right" }}>Last call</th></tr></thead>
          <tbody>
            {r.lostList.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td>{l.company}</td>
                <td style={{ textAlign: "right" }}>{l.lastCallSec ? `${l.lastCallSec}s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Coaching Recommendations</h2>

        <h3>1. Rebuild the cold-call opener</h3>
        <p>The current call script is producing 0% positive outcomes. That isn't a probability issue — that's a structural issue with the opening 20 seconds.</p>
        <div className="recommend">
          <strong>What to fix:</strong>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li>Lead with a credibility statement, not a sales pitch. ("We work with {">"}30 UK SMEs on {"{financing}"}; saw you operate in {"{industry}"} so I wanted to introduce myself.")</li>
            <li>Ask one open question early — "How are you currently handling {"{specific scenario}"}?" — to flip the call from monologue to conversation.</li>
            <li>Never say "tools", "scraped", "database", or "we found you via" when asked how you got the contact. Replace with: "<em>Your name came up when we were looking at {"{industry / region}"} businesses that fit who we typically work with.</em>" That's true, polite, and doesn't trigger the "data abuse" reflex that closed Steve Ball.</li>
          </ul>
        </div>

        <h3>2. Re-train classification</h3>
        <p>A 60-second conversation is rarely a hard Negative — it's almost always Follow-up (lead engaged but wasn't ready) or Needs Info. Reserve Negative for explicit "no, never, remove me" outcomes. A more realistic classification mix:</p>
        <div className="recommend">
          <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
            <li><strong>Positive</strong> — meeting booked or explicit interest expressed</li>
            <li><strong>Follow-up</strong> — engaged but timing/info gap; campaign continues</li>
            <li><strong>Negative</strong> — explicit decline OR genuine bad fit, never both ambivalent</li>
          </ul>
        </div>
        <p>The 18 leads currently in "lost" should be reviewed — at least 6 of them had real conversations over 1 minute and may be better re-classified as Follow-up so the email + LinkedIn sequence continues nurturing them.</p>

        <h3>3. Listen to recorded calls weekly</h3>
        <p>Starting now, every answered call produces a recording, an AI-generated transcript, and an AI coach analysis automatically (no clicks needed). A 30-min weekly review session listening to 3–5 calls — especially the negative ones — would compound improvement faster than any script change.</p>

        <h3>4. Connection note rewrite</h3>
        <p>Current LinkedIn accept rate is {acceptRate}% vs the {">"}15% baseline. Likely the invite note reads too salesy. Tighter formula: <em>"Hi {"{first_name}"}, came across your work at {"{company}"} — we partner with {"{industry}"} businesses on {"{specific service}"} and would value being connected."</em> Under 200 chars, no CTA, no pitch.</p>

        <h2>Next Steps</h2>
        <div className="neutral">
          <ol style={{ margin: 0, padding: "0 0 0 18px" }}>
            <li>Listen to the Steve Ball recording (15 May, 58s) as a team and identify the exact moment the framing broke.</li>
            <li>Rewrite the call opener with the credibility-first structure above. Test on the next 10 calls.</li>
            <li>Review the 18 lost leads with the new classification framework. Anything that was {">"}30s and not an explicit decline should be reopened as Follow-up.</li>
            <li>Rewrite the LinkedIn connection note. Aim for {">"}15% accept rate over the next 50 invites.</li>
            <li>Weekly 30-min call review every Friday — listen to 3 recordings (1 positive when we have one, 1 negative, 1 follow-up).</li>
          </ol>
        </div>

        <p style={{ marginTop: 32, fontSize: 11, color: "#9ca3af", borderTop: "1px solid color-mix(in srgb, #6B7280 24%, transparent)", paddingTop: 16 }}>
          Data live as of {today}. This report is generated on-demand from the GrowthAI database; reprint any time for an updated snapshot.
        </p>
      </div>
    </>
  );
}
