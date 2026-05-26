import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { C } from "@/lib/design";
import PrintTrigger from "./PrintTrigger";
import PrintActions from "./PrintActions";

type Branding = {
  companyName: string;
  logoUrl: string | null;
  brandColor: string;
};

async function getBranding(): Promise<Branding> {
  // Header / footer adopt the tenant's name + logo so the exported PDF lands
  // in the client's inbox as their report, not as a SWL-template handover.
  // primary_color only overrides when use_brand_colors is on; otherwise we
  // keep the GrowthAI gold so internal SWL reports stay on-brand.
  const fallback: Branding = { companyName: "SWL Consulting", logoUrl: null, brandColor: "#c9a83a" };
  const scope = await getUserScope();
  if (!scope.companyBioId) return fallback;
  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("company_name, logo_url, primary_color, use_brand_colors")
    .eq("id", scope.companyBioId)
    .maybeSingle();
  if (!bio) return fallback;
  return {
    companyName: bio.company_name ?? fallback.companyName,
    logoUrl: bio.logo_url ?? null,
    brandColor: bio.use_brand_colors && bio.primary_color ? bio.primary_color : fallback.brandColor,
  };
}

async function getReportData() {
  const supabase = await getSupabaseServer();
  // CRITICAL: scope every query to the caller's tenant. Pre-fix this route
  // pulled leads/campaigns/replies/messages globally, which leaked every
  // client's data into the PDF anyone exported. Fran caught this on
  // 2026-05-26. Super_admin (no scope.companyBioId) still sees everything.
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const leadsQ = supabase.from("leads").select("id, status, lead_score, is_priority, icp_profile_id, created_at, company_bio_id");
  const campsQ = supabase.from("campaigns").select("id, name, status, channel, current_step, sequence_steps, lead_id, seller_id, created_at, leads!inner(company_bio_id)");
  const repliesQ = supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, channel, received_at, leads!inner(company_bio_id)");
  const msgsQ = supabase.from("campaign_messages").select("id, campaign_id, step_number, status, sent_at, campaigns!inner(leads!inner(company_bio_id))");
  const profilesQ = supabase.from("icp_profiles").select("id, profile_name, company_bio_id").eq("status", "approved");
  const sellersQ = supabase.from("sellers").select("id, name, active, company_bio_id");

  const [
    { data: allLeads },
    { data: allCampaigns },
    { data: allReplies },
    { data: allMessages },
    { data: allProfiles },
    { data: allSellers },
  ] = await Promise.all([
    bioId ? leadsQ.eq("company_bio_id", bioId) : leadsQ,
    bioId ? campsQ.eq("leads.company_bio_id", bioId) : campsQ,
    bioId ? repliesQ.eq("leads.company_bio_id", bioId) : repliesQ,
    bioId ? msgsQ.eq("campaigns.leads.company_bio_id", bioId) : msgsQ,
    bioId ? profilesQ.eq("company_bio_id", bioId) : profilesQ,
    bioId ? sellersQ.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`) : sellersQ,
  ]);

  const leads = allLeads ?? [];
  const campaigns = allCampaigns ?? [];
  const replies = allReplies ?? [];
  const messages = allMessages ?? [];
  const profiles = allProfiles ?? [];

  const profileMap: Record<string, string> = {};
  for (const p of profiles) profileMap[p.id] = p.profile_name;

  const leadsWithCampaign = new Set(campaigns.map(c => c.lead_id).filter(Boolean));
  const repliedLeadIds = new Set(replies.map(r => r.lead_id));
  const positiveReplies = replies.filter(r => r.classification === "positive" || r.classification === "meeting_intent");
  const positiveLeadIds = new Set(positiveReplies.map(r => r.lead_id));

  const contactedLeads = leadsWithCampaign.size;
  const repliedCount = repliedLeadIds.size;
  const positiveCount = positiveLeadIds.size;
  const responseRate = contactedLeads > 0 ? Math.round((repliedCount / contactedLeads) * 100) : 0;
  const conversionRate = contactedLeads > 0 ? Math.round((positiveCount / contactedLeads) * 100) : 0;

  // Campaign groups
  const campGroups: Record<string, { name: string; channels: Set<string>; leads: Set<string>; replied: Set<string>; positive: Set<string>; msgsSent: number; totalSteps: number }> = {};
  for (const c of campaigns) {
    if (!campGroups[c.name]) campGroups[c.name] = { name: c.name, channels: new Set(), leads: new Set(), replied: new Set(), positive: new Set(), msgsSent: 0, totalSteps: 0 };
    const g = campGroups[c.name];
    g.channels.add(c.channel);
    if (c.lead_id) g.leads.add(c.lead_id);
    if (c.lead_id && repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id);
    if (c.lead_id && positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id);
    const ts = Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0;
    g.totalSteps = Math.max(g.totalSteps, ts);
  }
  const campIdToName: Record<string, string> = {};
  for (const c of campaigns) campIdToName[c.id] = c.name;
  for (const m of messages) {
    if (m.sent_at && campIdToName[m.campaign_id] && campGroups[campIdToName[m.campaign_id]]) {
      campGroups[campIdToName[m.campaign_id]].msgsSent++;
    }
  }
  const campaignComparison = Object.values(campGroups).map(g => ({
    name: g.name,
    channels: [...g.channels],
    leads: g.leads.size,
    msgsSent: g.msgsSent,
    replied: g.replied.size,
    positive: g.positive.size,
    responseRate: g.leads.size > 0 ? Math.round((g.replied.size / g.leads.size) * 100) : 0,
    conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
    totalSteps: g.totalSteps,
  })).sort((a, b) => b.conversionRate - a.conversionRate);

  // Channel analysis
  const channelStats: Record<string, { contacted: Set<string>; replied: Set<string>; positive: Set<string> }> = {};
  for (const c of campaigns) {
    if (!channelStats[c.channel]) channelStats[c.channel] = { contacted: new Set(), replied: new Set(), positive: new Set() };
    if (c.lead_id) {
      channelStats[c.channel].contacted.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) channelStats[c.channel].replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) channelStats[c.channel].positive.add(c.lead_id);
    }
  }
  const channelAnalysis = Object.entries(channelStats).map(([ch, s]) => ({
    channel: ch,
    contacted: s.contacted.size,
    replied: s.replied.size,
    positive: s.positive.size,
    responseRate: s.contacted.size > 0 ? Math.round((s.replied.size / s.contacted.size) * 100) : 0,
    conversionRate: s.contacted.size > 0 ? Math.round((s.positive.size / s.contacted.size) * 100) : 0,
  })).sort((a, b) => b.responseRate - a.responseRate);

  // Seller performance
  const sellerMap: Record<string, string> = {};
  for (const s of allSellers ?? []) sellerMap[s.id] = s.name;
  const sellerGroups: Record<string, { name: string; contacted: Set<string>; replied: Set<string>; positive: Set<string>; active: number }> = {};
  for (const c of campaigns) {
    if (!c.seller_id) continue;
    const sName = sellerMap[c.seller_id] ?? "Unassigned";
    if (!sellerGroups[c.seller_id]) sellerGroups[c.seller_id] = { name: sName, contacted: new Set(), replied: new Set(), positive: new Set(), active: 0 };
    const g = sellerGroups[c.seller_id];
    if (c.lead_id) { g.contacted.add(c.lead_id); if (repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id); if (positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id); }
    if (c.status === "active") g.active++;
  }
  const sellerPerformance = Object.values(sellerGroups).map(g => ({
    name: g.name, contacted: g.contacted.size, replied: g.replied.size, positive: g.positive.size, active: g.active,
    conversionRate: g.contacted.size > 0 ? Math.round((g.positive.size / g.contacted.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive);

  // Reply classification breakdown
  const replyBreakdown: Record<string, number> = {};
  for (const r of replies) { const cls = r.classification ?? "unclassified"; replyBreakdown[cls] = (replyBreakdown[cls] ?? 0) + 1; }

  // Forecast
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const last30Positive = positiveReplies.filter(r => new Date(r.received_at).getTime() >= thirtyDaysAgo).length;
  const dailyRate = last30Positive / 30;
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const forecastMonthly = Math.round(dailyRate * daysInMonth);

  return {
    totalLeads: leads.length, contactedLeads, repliedCount, positiveCount,
    responseRate, conversionRate,
    campaignComparison, channelAnalysis, sellerPerformance, replyBreakdown,
    forecastMonthly, dailyRate: Math.round(dailyRate * 10) / 10,
    totalMessages: messages.filter(m => m.sent_at).length,
    activeCampaigns: campaigns.filter(c => c.status === "active").length,
    generatedAt: new Date().toLocaleString("es-AR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  };
}

const channelLabel: Record<string, string> = { linkedin: "LinkedIn", email: "Email", call: "Call", whatsapp: "WhatsApp", sms: "SMS" };
const channelColor: Record<string, string> = { linkedin: "#0A66C2", email: "#7C3AED", call: "#F97316", whatsapp: "#25D366", sms: "#64748B" };
const classLabel: Record<string, string> = { positive: "Positive", meeting_intent: "Meeting Intent", negative: "Negative", question: "Question", unclassified: "Unclassified" };
const classColor: Record<string, string> = { positive: "#16A34A", meeting_intent: "#059669", negative: "#DC2626", question: "#D97706", unclassified: "#9CA3AF" };

export default async function ReportsPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  // sections=headline,funnel,trend,channels,icps,campaigns,sellers,insights
  // If not provided, default to "all on" (current behaviour).
  const sectionsCsv = get("sections");
  const include = sectionsCsv
    ? new Set(sectionsCsv.split(",").map(s => s.trim()).filter(Boolean))
    : new Set(["headline", "funnel", "trend", "channels", "icps", "campaigns", "sellers", "insights"]);

  const [data, brand] = await Promise.all([getReportData(), getBranding()]);
  const totalReplies = Object.values(data.replyBreakdown).reduce((a, b) => a + b, 0);

  return (
    <>
      <PrintTrigger />
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm 14mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        body { font-family: 'Inter', system-ui, sans-serif; background: #fff; color: #111827; }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px", fontSize: 13 }}>

        {/* ── Header ── GrowthAI / SWL is the primary brand: it's the engine
            that built the report and the artifact that leaves the building
            should be obviously ours. The tenant is the SUBJECT of the report,
            placed prominently as "Prepared for <Tenant>" on the right with
            their logo when available. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, paddingBottom: 16, borderBottom: `2px solid ${brand.brandColor}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${brand.brandColor}, color-mix(in srgb, ${brand.brandColor} 72%, white))`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 2px 8px color-mix(in srgb, ${brand.brandColor} 30%, transparent)` }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: 20 }}>⚡</span>
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: 18, color: "#111827", margin: 0, letterSpacing: "-0.01em" }}>
                GrowthAI <span style={{ color: brand.brandColor }}>— Sales Engine</span>
              </p>
              <p style={{ fontSize: 11, color: "#6B7280", margin: "2px 0 0" }}>by SWL Consulting · Performance Report</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 10, color: "#6B7280", margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Prepared for</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: "2px 0 0" }}>{brand.companyName}</p>
              <p style={{ fontSize: 10, color: "#9CA3AF", margin: "2px 0 0" }}>{data.generatedAt}</p>
            </div>
            {brand.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt={brand.companyName} style={{ width: 40, height: 40, borderRadius: 8, objectFit: "contain", background: "#fff", border: "1px solid #E5E7EB" }} />
            )}
          </div>
        </div>

        {/* ── KPI Row ── */}
        {include.has("headline") && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 24 }}>
          {[
            { label: "Total Leads",     value: data.totalLeads,       color: "#374151" },
            { label: "Contacted",       value: data.contactedLeads,   color: "var(--brand, #c9a83a)" },
            { label: "Messages Sent",   value: data.totalMessages,    color: "#0A66C2" },
            { label: "Replied",         value: data.repliedCount,     color: "#2563EB" },
            { label: "Positive",        value: data.positiveCount,    color: "#16A34A" },
            { label: "Active Campaigns",value: data.activeCampaigns,  color: "#7C3AED" },
          ].map(k => (
            <div key={k.label} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 10px", borderTop: `3px solid ${k.color}` }}>
              <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6B7280", margin: "0 0 4px" }}>{k.label}</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: k.color, margin: 0 }}>{k.value}</p>
            </div>
          ))}
        </div>
        )}

        {/* ── Rates Row ── */}
        {include.has("headline") && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Response Rate",  value: `${data.responseRate}%`,   sub: `${data.repliedCount} of ${data.contactedLeads} responded`,  color: "#2563EB" },
            { label: "Conversion Rate",value: `${data.conversionRate}%`, sub: `${data.positiveCount} positive of ${data.contactedLeads}`,   color: "#16A34A" },
            { label: "Monthly Forecast",value: `${data.forecastMonthly}`,sub: `${data.dailyRate} positives/day × 30d`, color: "var(--brand, #c9a83a)" },
          ].map(r => (
            <div key={r.label} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px" }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>{r.label}</p>
              <p style={{ fontSize: 28, fontWeight: 800, color: r.color, margin: "0 0 2px" }}>{r.value}</p>
              <p style={{ fontSize: 10, color: "#9CA3AF", margin: 0 }}>{r.sub}</p>
            </div>
          ))}
        </div>
        )}

        {/* ── Campaign Comparison ── */}
        {include.has("campaigns") && (
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Campaign Comparison</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: C.surface }}>
                {["Campaign", "Channels", "Leads", "Sent", "Replied", "Positive", "Response %", "Conversion %"].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: h === "Campaign" ? "left" : "center", fontSize: 10, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", border: "1px solid #E5E7EB" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.campaignComparison.map((c, i) => (
                <tr key={c.name} style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                  <td style={{ padding: "8px 10px", border: "1px solid #E5E7EB" }}>
                    <p style={{ fontWeight: 600, color: "#111827", margin: 0 }}>{c.name}</p>
                    <p style={{ fontSize: 10, color: "#9CA3AF", margin: "2px 0 0" }}>{c.totalSteps} steps</p>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center", border: "1px solid #E5E7EB" }}>
                    {c.channels.map(ch => (
                      <span key={ch} style={{ display: "inline-block", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, marginRight: 2, backgroundColor: `${channelColor[ch] ?? "#6B7280"}18`, color: channelColor[ch] ?? "#6B7280" }}>{channelLabel[ch] ?? ch}</span>
                    ))}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 600, border: "1px solid #E5E7EB" }}>{c.leads}</td>
                  <td style={{ padding: "8px 10px", textAlign: "center", border: "1px solid #E5E7EB" }}>{c.msgsSent}</td>
                  <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 600, color: "#2563EB", border: "1px solid #E5E7EB" }}>{c.replied}</td>
                  <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 600, color: "#16A34A", border: "1px solid #E5E7EB" }}>{c.positive}</td>
                  <td style={{ padding: "8px 10px", textAlign: "center", border: "1px solid #E5E7EB" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <div style={{ width: 40, height: 6, borderRadius: 3, backgroundColor: C.border, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${c.responseRate}%`, backgroundColor: "#2563EB", borderRadius: 3 }} />
                      </div>
                      <span style={{ fontWeight: 700, color: "#2563EB", minWidth: 28 }}>{c.responseRate}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center", border: "1px solid #E5E7EB" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <div style={{ width: 40, height: 6, borderRadius: 3, backgroundColor: C.border, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${c.conversionRate}%`, backgroundColor: "#16A34A", borderRadius: 3 }} />
                      </div>
                      <span style={{ fontWeight: 700, color: "#16A34A", minWidth: 28 }}>{c.conversionRate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {/* ── Two columns: Channel Analysis + Reply Breakdown ── */}
        {include.has("channels") && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>

          {/* Channel Analysis */}
          <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ backgroundColor: C.surface, padding: "10px 14px", borderBottom: "1px solid #E5E7EB" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#111827", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Channel Analysis</p>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ backgroundColor: C.cardHov }}>
                  {["Channel", "Contacted", "Replied", "Positive", "Response", "Conv."].map(h => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: h === "Channel" ? "left" : "center", fontSize: 9, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", borderBottom: "1px solid #E5E7EB" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.channelAnalysis.map((ch, i) => (
                  <tr key={ch.channel} style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                    <td style={{ padding: "7px 10px", borderBottom: "1px solid #F3F4F6" }}>
                      <span style={{ fontWeight: 700, color: channelColor[ch.channel] ?? "#374151" }}>{channelLabel[ch.channel] ?? ch.channel}</span>
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "center", borderBottom: "1px solid #F3F4F6" }}>{ch.contacted}</td>
                    <td style={{ padding: "7px 10px", textAlign: "center", fontWeight: 600, color: "#2563EB", borderBottom: "1px solid #F3F4F6" }}>{ch.replied}</td>
                    <td style={{ padding: "7px 10px", textAlign: "center", fontWeight: 600, color: "#16A34A", borderBottom: "1px solid #F3F4F6" }}>{ch.positive}</td>
                    <td style={{ padding: "7px 10px", textAlign: "center", fontWeight: 700, color: "#2563EB", borderBottom: "1px solid #F3F4F6" }}>{ch.responseRate}%</td>
                    <td style={{ padding: "7px 10px", textAlign: "center", fontWeight: 700, color: "#16A34A", borderBottom: "1px solid #F3F4F6" }}>{ch.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Reply Breakdown */}
          <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ backgroundColor: C.surface, padding: "10px 14px", borderBottom: "1px solid #E5E7EB" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#111827", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Reply Classification</p>
            </div>
            <div style={{ padding: 14 }}>
              {Object.entries(data.replyBreakdown).sort(([, a], [, b]) => b - a).map(([cls, count]) => {
                const pct = totalReplies > 0 ? Math.round((count / totalReplies) * 100) : 0;
                const color = classColor[cls] ?? "#9CA3AF";
                return (
                  <div key={cls} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color }}>{classLabel[cls] ?? cls}</span>
                      <span style={{ color: "#6B7280" }}>{count} <span style={{ fontSize: 10 }}>({pct}%)</span></span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, backgroundColor: C.border, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, backgroundColor: color, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
              {Object.keys(data.replyBreakdown).length === 0 && (
                <p style={{ color: "#9CA3AF", textAlign: "center", padding: "12px 0" }}>No replies yet</p>
              )}
            </div>
          </div>
        </div>
        )}

        {/* ── Seller Performance ── */}
        {include.has("sellers") && data.sellerPerformance.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Seller Performance</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ backgroundColor: C.surface }}>
                  {["Seller", "Active Campaigns", "Contacted", "Replied", "Won", "Response %", "Conversion %"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: h === "Seller" ? "left" : "center", fontSize: 10, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", border: "1px solid #E5E7EB" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.sellerPerformance.map((s, i) => (
                  <tr key={s.name} style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                    <td style={{ padding: "8px 12px", border: "1px solid #E5E7EB" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, var(--brand, #c9a83a), color-mix(in srgb, var(--brand, #c9a83a) 72%, white))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 800 }}>
                          {s.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600, color: "#111827" }}>{s.name}</span>
                        {i === 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, backgroundColor: "var(--brand, #c9a83a)20", color: "var(--brand, #c9a83a)" }}>TOP</span>}
                      </div>
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: "#16A34A", border: "1px solid #E5E7EB" }}>{s.active}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", border: "1px solid #E5E7EB" }}>{s.contacted}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: "#2563EB", border: "1px solid #E5E7EB" }}>{s.replied}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: "#16A34A", border: "1px solid #E5E7EB" }}>{s.positive}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: "#2563EB", border: "1px solid #E5E7EB" }}>{s.conversionRate === 0 && s.contacted > 0 ? "0%" : `${Math.round(s.replied / (s.contacted || 1) * 100)}%`}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", border: "1px solid #E5E7EB" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <div style={{ width: 40, height: 6, borderRadius: 3, backgroundColor: C.border, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${s.conversionRate}%`, backgroundColor: "#16A34A", borderRadius: 3 }} />
                        </div>
                        <span style={{ fontWeight: 700, color: "#16A34A", minWidth: 28 }}>{s.conversionRate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ paddingTop: 16, borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontSize: 10, color: "#9CA3AF", margin: 0 }}>
            GrowthAI Sales Engine · SWL Consulting · Confidential
            <span style={{ color: "#D1D5DB", margin: "0 6px" }}>·</span>
            Prepared for {brand.companyName}
          </p>
          <p style={{ fontSize: 10, color: "#9CA3AF", margin: 0 }}>{data.generatedAt}</p>
        </div>

        <PrintActions />

      </div>
    </>
  );
}
