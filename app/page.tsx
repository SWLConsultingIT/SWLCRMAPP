import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Users, Phone, MessageSquare, RefreshCw, AlertTriangle, Share2, Mail, PhoneCall } from "lucide-react";
import AutoRefresh from "@/components/AutoRefresh";
import Link from "next/link";

// Gold accent
const gold = "#C9A83A";
const goldLight = "rgba(201,168,58,0.08)";

async function getStats() {
  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const [
    { count: activeLeads },
    { count: callsToday },
    { count: responsesWeek },
    { count: passedToOdoo },
    { count: missingData },
  ] = await Promise.all([
    supabase.from("leads").select("*", { count: "exact", head: true }).in("status", ["new", "contacted", "connected"]),
    supabase.from("campaigns").select("*", { count: "exact", head: true }).gte("last_step_at", today).eq("channel", "call"),
    supabase.from("lead_replies").select("*", { count: "exact", head: true }).gte("received_at", weekAgo),
    supabase.from("leads").select("*", { count: "exact", head: true }).not("transferred_to_odoo_at", "is", null),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("allow_linkedin", false).eq("allow_email", false).eq("allow_call", false),
  ]);
  return { activeLeads: activeLeads ?? 0, callsToday: callsToday ?? 0, responsesWeek: responsesWeek ?? 0, passedToOdoo: passedToOdoo ?? 0, missingData: missingData ?? 0 };
}

async function getAlerts() {
  const alerts: { label: string; count: number; href: string }[] = [];
  const { count: noContact } = await supabase.from("leads").select("*", { count: "exact", head: true }).eq("allow_linkedin", false).eq("allow_email", false).eq("allow_call", false).eq("archived", false);
  if ((noContact ?? 0) > 0) alerts.push({ label: "leads with no contact data", count: noContact ?? 0, href: "/leads" });
  const { count: noPhone } = await supabase.from("leads").select("*", { count: "exact", head: true }).eq("allow_call", false).eq("archived", false).in("status", ["new", "contacted", "connected"]);
  if ((noPhone ?? 0) > 0) alerts.push({ label: "leads without phone number", count: noPhone ?? 0, href: "/leads" });
  const { count: callsDue } = await supabase.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "active").lte("next_step_due_at", new Date().toISOString());
  if ((callsDue ?? 0) > 0) alerts.push({ label: "campaigns with overdue next step", count: callsDue ?? 0, href: "/campaigns" });
  const { count: pendingReview } = await supabase.from("lead_replies").select("*", { count: "exact", head: true }).eq("requires_human_review", true).eq("review_status", "pending");
  if ((pendingReview ?? 0) > 0) alerts.push({ label: "replies pending review", count: pendingReview ?? 0, href: "/leads" });
  const { count: respondedNotQualified } = await supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "responded").eq("archived", false);
  if ((respondedNotQualified ?? 0) > 0) alerts.push({ label: "responded leads awaiting qualification", count: respondedNotQualified ?? 0, href: "/leads" });
  return alerts;
}

async function getRecentLeads() {
  const { data } = await supabase.from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, lead_score, status, current_channel, is_priority")
    .in("status", ["new", "contacted", "connected", "responded", "qualified", "proposal_sent"])
    .order("updated_at", { ascending: false }).limit(6);
  return data ?? [];
}


async function getRecentActivity() {
  const { data: replies } = await supabase.from("lead_replies")
    .select("id, classification, received_at, channel, leads(primary_first_name, primary_last_name, company_name)")
    .order("received_at", { ascending: false }).limit(5);
  const { data: messages } = await supabase.from("campaign_messages")
    .select("id, channel, status, sent_at, leads(primary_first_name, primary_last_name, company_name)")
    .eq("status", "sent").order("sent_at", { ascending: false }).limit(5);

  const activities: { id: string; title: string; detail: string; time: string; color: string }[] = [];
  (replies ?? []).forEach((r: any) => {
    const name = r.leads ? `${r.leads.primary_first_name ?? ""} ${r.leads.primary_last_name ?? ""}`.trim() : "Unknown";
    const labels: Record<string, string> = { positive: "Positive Reply", meeting_intent: "Meeting Intent", needs_info: "Info Requested", negative: "Not Interested", not_now: "Not Now", unsubscribe: "Unsubscribed" };
    activities.push({ id: r.id, title: labels[r.classification] ?? "Reply Received", detail: `From ${name}${r.leads?.company_name ? ` (${r.leads.company_name})` : ""}`, time: r.received_at,
      color: ["positive", "meeting_intent"].includes(r.classification) ? C.green : ["negative", "unsubscribe"].includes(r.classification) ? C.red : C.blue });
  });
  (messages ?? []).forEach((m: any) => {
    const name = m.leads ? `${m.leads.primary_first_name ?? ""} ${m.leads.primary_last_name ?? ""}`.trim() : "Unknown";
    const ch: Record<string, string> = { linkedin: "LinkedIn Message", email: "Email Sent", call: "Call Logged" };
    activities.push({ id: m.id, title: ch[m.channel] ?? "Message Sent", detail: `To ${name}${m.leads?.company_name ? ` (${m.leads.company_name})` : ""}`, time: m.sent_at,
      color: m.channel === "linkedin" ? C.linkedin : m.channel === "email" ? C.email : C.phone });
  });
  return activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 6);
}

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "Just now"; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function scoreBadge(score: number | null, p: boolean) {
  if (p || (score && score >= 80)) return { label: "HOT", color: C.hot, bg: C.hotBg };
  if (score && score >= 50) return { label: "WARM", color: C.warm, bg: C.warmBg };
  return { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

const stageLabel: Record<string, string> = { new: "New", contacted: "Contacted", connected: "Connected", responded: "Responded", qualified: "Qualified", proposal_sent: "Proposal Sent" };
const chIcon: Record<string, { icon: typeof Share2; color: string }> = { linkedin: { icon: Share2, color: C.linkedin }, email: { icon: Mail, color: C.email }, call: { icon: PhoneCall, color: C.phone } };

export default async function DashboardPage() {
  const [stats, leads, activities, alerts] = await Promise.all([getStats(), getRecentLeads(), getRecentActivity(), getAlerts()]);

  return (
    <div className="p-8 w-full">
      <AutoRefresh intervalMs={60000} />

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>SWL Consulting</p>
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Dashboard</h1>
        </div>
        <div className="relative">
          <input type="text" placeholder="Search leads..." className="text-sm pl-9 pr-4 py-2 w-64"
            style={{ backgroundColor: C.card, borderColor: C.border }} />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.textDim }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
        </div>
      </div>

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Active Leads", value: stats.activeLeads, color: gold, border: gold, icon: Users },
          { label: "Calls Today", value: stats.callsToday, color: C.phone, border: C.phone, icon: Phone, sub: "Goal: 15" },
          { label: "Responses This Week", value: stats.responsesWeek, color: C.green, border: C.green, icon: MessageSquare },
          { label: "Passed to CRM", value: stats.passedToOdoo, color: C.accent, border: C.accent, icon: RefreshCw },
        ].map(({ label, value, color, border, icon: Icon, sub }) => (
          <div key={label} className="rounded-xl border p-5 relative overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${border}` }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
              <div className="rounded-lg p-2" style={{ backgroundColor: `${color}15` }}>
                <Icon size={15} style={{ color }} />
              </div>
            </div>
            <p className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</p>
            {sub && <p className="text-xs mt-1.5" style={{ color: C.textDim }}>{sub}</p>}
          </div>
        ))}
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-3 gap-6">

        {/* Recent Leads */}
        <div className="col-span-2 rounded-xl border overflow-hidden fade-in"
          style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <div className="px-6 py-4 flex items-center justify-between border-b"
            style={{ borderColor: C.border, background: `linear-gradient(90deg, ${goldLight} 0%, transparent 50%)` }}>
            <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Recent Leads</h2>
            <Link href="/leads" className="text-xs font-semibold" style={{ color: gold }}>View All</Link>
          </div>

          <div className="grid grid-cols-[1fr_80px_100px_120px] px-6 py-3 border-b text-xs font-semibold uppercase tracking-wider"
            style={{ borderColor: C.border, color: C.textMuted }}>
            <span>Company / Contact</span><span>Score</span><span>Channel</span><span>Stage</span>
          </div>

          {leads.length === 0 ? (
            <div className="px-6 py-12 text-center"><p className="text-sm" style={{ color: C.textDim }}>No active leads yet</p></div>
          ) : (
            leads.map((lead: any) => {
              const s = scoreBadge(lead.lead_score, lead.is_priority);
              const c = chIcon[lead.current_channel] ?? chIcon.email;
              const CI = c.icon;
              return (
                <Link key={lead.id} href={`/leads/${lead.id}`}
                  className="grid grid-cols-[1fr_80px_100px_120px] px-6 py-3.5 items-center border-b table-row-hover"
                  style={{ borderColor: C.border }}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
                      {(lead.company_name ?? "?")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{lead.company_name ?? "Unknown"}</p>
                      <p className="text-xs truncate" style={{ color: C.textMuted }}>{lead.primary_first_name} {lead.primary_last_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1 h-6 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CI size={14} style={{ color: c.color }} />
                    <span className="text-xs capitalize" style={{ color: C.textBody }}>{lead.current_channel ?? "—"}</span>
                  </div>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-md" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>
                    {stageLabel[lead.status] ?? lead.status}
                  </span>
                </Link>
              );
            })
          )}
        </div>

        {/* Activity Feed */}
        <div className="rounded-xl border overflow-hidden fade-in"
          style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <div className="px-5 py-4 border-b"
            style={{ borderColor: C.border, background: `linear-gradient(90deg, ${goldLight} 0%, transparent 60%)` }}>
            <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Recent Activity</h2>
          </div>
          <div className="p-5">
            {activities.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: C.textDim }}>No recent activity</p>
            ) : (
              <div className="space-y-4">
                {activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: a.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{a.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{a.detail}</p>
                      <p className="text-xs mt-1" style={{ color: C.textDim }}>{timeAgo(a.time)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="mt-8 rounded-xl border overflow-hidden fade-in"
          style={{ backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }}>
          <div className="px-6 py-4 flex items-start gap-4">
            <div className="rounded-full p-2 shrink-0 mt-0.5" style={{ backgroundColor: "#FEF3C7" }}>
              <AlertTriangle size={18} style={{ color: gold }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: C.textPrimary }}>Requires Attention</p>
              <p className="text-sm mt-0.5" style={{ color: C.textBody }}>Issues detected in the current workflow.</p>
            </div>
          </div>
          <div className="px-6 pb-5 flex flex-wrap gap-3">
            {alerts.map((alert, i) => (
              <Link key={i} href={alert.href}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border transition-colors hover:bg-orange-50"
                style={{ borderColor: "#FBBF24", color: "#B45309", backgroundColor: "#FFFDF5" }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: gold }} />
                {alert.count} {alert.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
