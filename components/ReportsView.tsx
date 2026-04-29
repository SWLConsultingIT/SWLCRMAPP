import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { TrendingUp, Users, MessageSquare, Target } from "lucide-react";

const gold = "var(--brand, #c9a83a)";
const goldLight = "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)";

async function getReportData() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since = thirtyDaysAgo.toISOString();

  const [
    { data: repliesByClass },
    { data: leadsByStatus },
    { data: campaignsByChannel },
    { data: recentQualified },
    { data: qualifiedWithSeller },
    { data: qualifiedByDay },
    { data: qualifiedTimes },
    { data: campaignsWithChannel },
    { data: repliesWithLead },
  ] = await Promise.all([
    supabase.from("lead_replies").select("classification").gte("received_at", since),
    supabase.from("leads").select("status"),
    supabase.from("campaigns").select("channel, status"),
    supabase.from("leads").select("id, primary_first_name, primary_last_name, company_name, primary_title_role, assigned_seller, created_at").eq("status", "qualified").order("created_at", { ascending: false }).limit(20),
    supabase.from("leads").select("assigned_seller").eq("status", "qualified").not("assigned_seller", "is", null),
    supabase.from("leads").select("created_at").eq("status", "qualified").gte("created_at", since).order("created_at", { ascending: true }),
    supabase.from("leads").select("created_at, updated_at").eq("status", "qualified").not("updated_at", "is", null).limit(200),
    supabase.from("campaigns").select("lead_id, channel").limit(500),
    supabase.from("lead_replies").select("lead_id, classification"),
  ]);

  const replyBreakdown = (repliesByClass ?? []).reduce<Record<string, number>>((acc, r) => { acc[r.classification] = (acc[r.classification] ?? 0) + 1; return acc; }, {});
  const leadBreakdown = (leadsByStatus ?? []).reduce<Record<string, number>>((acc, l) => { acc[l.status] = (acc[l.status] ?? 0) + 1; return acc; }, {});
  const channelBreakdown = (campaignsByChannel ?? []).reduce<Record<string, number>>((acc, c) => { acc[c.channel] = (acc[c.channel] ?? 0) + 1; return acc; }, {});
  const sellerBreakdown = (qualifiedWithSeller ?? []).reduce<Record<string, number>>((acc, l) => { if (l.assigned_seller) acc[l.assigned_seller] = (acc[l.assigned_seller] ?? 0) + 1; return acc; }, {});

  const weeklyData: Record<string, number> = {};
  for (let i = 3; i >= 0; i--) { weeklyData[`Week ${4 - i}`] = 0; }
  for (const q of qualifiedByDay ?? []) {
    const weeksAgo = Math.floor((Date.now() - new Date(q.created_at).getTime()) / (7 * 86400000));
    const key = `Week ${4 - weeksAgo}`;
    if (key in weeklyData) weeklyData[key]++;
  }

  const total = Object.values(leadBreakdown).reduce((a, b) => a + b, 0);
  const qualified = leadBreakdown.qualified ?? 0;
  const totalReplies = Object.values(replyBreakdown).reduce((a, b) => a + b, 0);
  const conversionRate = total > 0 ? ((qualified / total) * 100).toFixed(1) : "0";
  const positiveRate = totalReplies > 0 ? (((replyBreakdown.positive ?? 0) / totalReplies) * 100).toFixed(1) : "0";

  const times = (qualifiedTimes ?? []).map((l: any) => (new Date(l.updated_at).getTime() - new Date(l.created_at).getTime()) / 86400000).filter((d: number) => d > 0 && d < 365);
  const avgDaysToQualify = times.length > 0 ? Math.round(times.reduce((a: number, b: number) => a + b, 0) / times.length) : null;

  const repliedLeads = new Set((repliesWithLead ?? []).map((r: any) => r.lead_id));
  const channelTotal: Record<string, number> = {};
  const channelReplied: Record<string, number> = {};
  for (const c of campaignsWithChannel ?? []) {
    channelTotal[c.channel] = (channelTotal[c.channel] ?? 0) + 1;
    if (repliedLeads.has(c.lead_id)) channelReplied[c.channel] = (channelReplied[c.channel] ?? 0) + 1;
  }
  const channelResponseRate: Record<string, { total: number; replied: number; rate: number }> = {};
  for (const ch of Object.keys(channelTotal)) {
    const t = channelTotal[ch]; const r = channelReplied[ch] ?? 0;
    channelResponseRate[ch] = { total: t, replied: r, rate: t > 0 ? Math.round((r / t) * 100) : 0 };
  }

  return { replyBreakdown, leadBreakdown, channelBreakdown, sellerBreakdown, recentQualified: recentQualified ?? [], conversionRate, positiveRate, total, totalReplies, qualified, weeklyData, avgDaysToQualify, channelResponseRate };
}

function HBarChart({ data, colorMap, labelMap }: { data: Record<string, number>; colorMap: Record<string, string>; labelMap: Record<string, string> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 1);
  return (
    <div className="space-y-3.5">
      {Object.entries(data).sort(([, a], [, b]) => b - a).map(([key, value]) => {
        const pct = Math.round((value / total) * 100);
        const color = colorMap[key] ?? C.textMuted;
        return (
          <div key={key}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium" style={{ color: C.textBody }}>{labelMap[key] ?? key}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold tabular-nums" style={{ color }}>{value}</span>
                <span className="text-xs tabular-nums w-8 text-right" style={{ color: C.textMuted }}>{pct}%</span>
              </div>
            </div>
            <div className="w-full rounded-full h-2" style={{ backgroundColor: C.border }}>
              <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LineChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  const values = entries.map(([, v]) => v);
  const max = Math.max(...values, 1);
  const W = 800, H = 90, PAD = 16;
  const pts = entries.map(([, v], i) => ({ x: PAD + (i / (entries.length - 1)) * (W - 2 * PAD), y: H - PAD - ((v / max) * (H - 2 * PAD)), v, label: entries[i][0] }));
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `M ${pts[0].x} ${H} ${pts.map(p => `L ${p.x} ${p.y}`).join(" ")} L ${pts[pts.length - 1].x} ${H} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 24}`}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gold} stopOpacity="0.2" />
          <stop offset="100%" stopColor={gold} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((p, i) => (
        <line key={i} x1={PAD} y1={PAD + (1 - p) * (H - 2 * PAD)} x2={W - PAD} y2={PAD + (1 - p) * (H - 2 * PAD)} stroke={C.border} strokeWidth="1" strokeDasharray="6 6" />
      ))}
      <path d={areaD} fill="url(#areaGrad)" />
      <path d={pathD} fill="none" stroke={gold} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="5" fill={gold} stroke="white" strokeWidth="2.5" />
          <text x={p.x} y={H + 20} textAnchor="middle" fontSize="13" fill={C.textMuted}>{p.label}</text>
          {p.v > 0 && <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="13" fill={gold} fontWeight="600">{p.v}</text>}
        </g>
      ))}
    </svg>
  );
}

function Funnel({ data }: { data: Record<string, number> }) {
  const stages = [
    { key: "new",       label: "Imported",     color: C.blue },
    { key: "contacted", label: "Contacted",    color: gold },
    { key: "qualified", label: "Qualified",    color: C.green },
    { key: "nurturing", label: "Nurturing",    color: C.textMuted },
  ];
  const top = Math.max(...stages.map(s => data[s.key] ?? 0), 1);
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const val = data[s.key] ?? 0;
        const pct = Math.round((val / top) * 100);
        const prevVal = i > 0 ? (data[stages[i - 1].key] ?? 0) : null;
        const conv = prevVal != null && prevVal > 0 ? Math.round((val / prevVal) * 100) : null;
        return (
          <div key={s.key}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium" style={{ color: C.textBody }}>{s.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tabular-nums" style={{ color: s.color }}>{val}</span>
                {conv !== null && <span className="text-xs px-1.5 py-0.5 rounded tabular-nums" style={{ backgroundColor: C.surface, color: C.textMuted }}>{conv}% conv.</span>}
              </div>
            </div>
            <div className="w-full rounded-full h-2" style={{ backgroundColor: C.border }}>
              <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: s.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const statusLabels: Record<string, string> = { new: "New", contacted: "Contacted", connected: "Connected", responded: "Responded", qualified: "Qualified", proposal_sent: "Proposal", closed_won: "Won", closed_lost: "Lost", nurturing: "Nurturing" };
const statusColors: Record<string, string> = { new: C.blue, contacted: gold, connected: C.accent, responded: C.green, qualified: C.green, proposal_sent: C.accent, closed_won: C.green, closed_lost: C.red, nurturing: C.textMuted };
const classLabels: Record<string, string> = { positive: "Positive", meeting_intent: "Meeting Intent", needs_info: "Needs Info", not_now: "Not Now", negative: "Negative", unsubscribe: "Unsubscribe" };
const classColors: Record<string, string> = { positive: C.green, meeting_intent: C.green, needs_info: C.blue, not_now: C.orange, negative: C.red, unsubscribe: C.red };
const channelColors: Record<string, string> = { linkedin: C.linkedin, email: C.email, whatsapp: "#22c55e", call: C.phone };

export default async function ReportsView() {
  const { replyBreakdown, leadBreakdown, sellerBreakdown, recentQualified, conversionRate, positiveRate, total, totalReplies, qualified, weeklyData, avgDaysToQualify, channelResponseRate } = await getReportData();

  const kpis = [
    { label: "Total Leads",       value: total,                                              icon: Users,         color: gold },
    { label: "Qualified",         value: qualified,                                           icon: Target,        color: C.green },
    { label: "Conversion Rate",   value: `${conversionRate}%`,                                icon: TrendingUp,    color: C.accent },
    { label: "Positive Rate",     value: `${positiveRate}%`,                                  icon: MessageSquare, color: gold },
    { label: "Avg Days to Qualify",value: avgDaysToQualify != null ? `${avgDaysToQualify}d` : "—", icon: TrendingUp, color: C.orange },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm font-medium" style={{ color: C.textMuted }}>Last 30 days</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${color}` }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>{label}</span>
              <Icon size={14} style={{ color }} />
            </div>
            <p className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Line chart */}
      <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Qualified per Week (last 4 weeks)</h2>
        <LineChart data={weeklyData} />
      </div>

      {/* Funnel */}
      <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Conversion Funnel</h2>
        <Funnel data={leadBreakdown} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Leads by Status</h2>
          <HBarChart data={leadBreakdown} colorMap={statusColors} labelMap={statusLabels} />
        </div>
        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Replies</h2>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: goldLight, color: gold }}>{totalReplies} total</span>
          </div>
          {totalReplies > 0 ? <HBarChart data={replyBreakdown} colorMap={classColors} labelMap={classLabels} /> : <p className="text-sm" style={{ color: C.textDim }}>No replies</p>}
        </div>
        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Response Rate by Channel</h2>
          {Object.keys(channelResponseRate).length === 0
            ? <p className="text-sm" style={{ color: C.textDim }}>No data</p>
            : <div className="space-y-3.5">
                {Object.entries(channelResponseRate).sort(([,a],[,b]) => b.rate - a.rate).map(([ch, { total: t, replied, rate }]) => (
                  <div key={ch}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium" style={{ color: C.textBody }}>{{ linkedin: "LinkedIn", email: "Email", whatsapp: "WhatsApp", call: "Call" }[ch] ?? ch}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>{replied}/{t}</span>
                        <span className="text-sm font-bold tabular-nums" style={{ color: channelColors[ch] ?? C.textMuted }}>{rate}%</span>
                      </div>
                    </div>
                    <div className="w-full rounded-full h-2" style={{ backgroundColor: C.border }}>
                      <div className="h-2 rounded-full" style={{ width: `${rate}%`, backgroundColor: channelColors[ch] ?? C.textMuted }} />
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      {/* Seller performance */}
      {Object.keys(sellerBreakdown).length > 0 && (
        <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Performance by Seller</h2>
          <HBarChart data={sellerBreakdown} colorMap={{}} labelMap={{}} />
        </div>
      )}

      {/* Qualified leads table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <div className="px-5 py-4 border-b flex items-center justify-between"
          style={{ borderColor: C.border, background: `linear-gradient(90deg, ${goldLight} 0%, transparent 50%)` }}>
          <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Recent Qualified Leads</h2>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: C.greenLight, color: C.green }}>{recentQualified.length}</span>
        </div>
        {recentQualified.length === 0 ? (
          <div className="py-10 text-center"><p className="text-sm" style={{ color: C.textDim }}>No qualified leads yet</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.cardHov }}>
                {["Name", "Company", "Role", "Seller", "Date"].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentQualified.map((lead: any) => (
                <tr key={lead.id} className="table-row-hover" style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td className="px-5 py-3 font-medium" style={{ color: C.textPrimary }}>{lead.primary_first_name} {lead.primary_last_name}</td>
                  <td className="px-5 py-3" style={{ color: C.textBody }}>{lead.company_name}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: C.textMuted }}>{lead.primary_title_role}</td>
                  <td className="px-5 py-3 text-sm font-medium" style={{ color: gold }}>{lead.assigned_seller ?? "—"}</td>
                  <td className="px-5 py-3 text-xs tabular-nums" style={{ color: C.textMuted }}>{new Date(lead.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
