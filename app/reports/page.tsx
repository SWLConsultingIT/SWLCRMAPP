import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { TrendingUp, Users, MessageSquare, Target } from "lucide-react";

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
    supabase.from("leads").select("id, first_name, last_name, company, role, assigned_seller, created_at").eq("status", "qualified").order("created_at", { ascending: false }).limit(20),
    supabase.from("leads").select("assigned_seller").eq("status", "qualified").not("assigned_seller", "is", null),
    supabase.from("leads").select("created_at").eq("status", "qualified").gte("created_at", since).order("created_at", { ascending: true }),
    // Avg time to qualify: fetch qualified leads with created_at + updated_at
    supabase.from("leads").select("created_at, updated_at").eq("status", "qualified").not("updated_at", "is", null).limit(200),
    // Response rate by channel: campaigns with their lead_id + channel
    supabase.from("campaigns").select("lead_id, channel").limit(500),
    // Replies with lead_id to cross-reference
    supabase.from("lead_replies").select("lead_id, classification"),
  ]);

  const replyBreakdown = (repliesByClass ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});

  const leadBreakdown = (leadsByStatus ?? []).reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  const channelBreakdown = (campaignsByChannel ?? []).reduce<Record<string, number>>((acc, c) => {
    acc[c.channel] = (acc[c.channel] ?? 0) + 1;
    return acc;
  }, {});

  const sellerBreakdown = (qualifiedWithSeller ?? []).reduce<Record<string, number>>((acc, l) => {
    if (l.assigned_seller) acc[l.assigned_seller] = (acc[l.assigned_seller] ?? 0) + 1;
    return acc;
  }, {});

  // Build weekly sparkline: group by week number
  const weeklyData: Record<string, number> = {};
  for (let i = 3; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    const key = `Sem ${4 - i}`;
    weeklyData[key] = 0;
  }
  for (const q of qualifiedByDay ?? []) {
    const d = new Date(q.created_at);
    const weeksAgo = Math.floor((Date.now() - d.getTime()) / (7 * 24 * 3600 * 1000));
    const key = `Sem ${4 - weeksAgo}`;
    if (key in weeklyData) weeklyData[key]++;
  }

  const total = Object.values(leadBreakdown).reduce((a, b) => a + b, 0);
  const qualified = leadBreakdown.qualified ?? 0;
  const totalReplies = Object.values(replyBreakdown).reduce((a, b) => a + b, 0);
  const conversionRate = total > 0 ? ((qualified / total) * 100).toFixed(1) : "0";
  const positiveRate = totalReplies > 0 ? (((replyBreakdown.positive ?? 0) / totalReplies) * 100).toFixed(1) : "0";

  // Avg days to qualify
  const times = (qualifiedTimes ?? []).map((l: any) => {
    const diff = new Date(l.updated_at).getTime() - new Date(l.created_at).getTime();
    return diff / (1000 * 3600 * 24);
  }).filter((d: number) => d > 0 && d < 365);
  const avgDaysToQualify = times.length > 0 ? Math.round(times.reduce((a: number, b: number) => a + b, 0) / times.length) : null;

  // Response rate by channel
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

// --- Chart components (server-side SVG) ---

function HBarChart({ data, colorMap, labelMap }: {
  data: Record<string, number>;
  colorMap: Record<string, string>;
  labelMap: Record<string, string>;
}) {
  const total = Object.values(data).reduce((a, b) => a + b, 1);
  const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);
  return (
    <div className="space-y-3.5">
      {sorted.map(([key, value]) => {
        const pct = Math.round((value / total) * 100);
        const color = colorMap[key] ?? C.textMuted;
        return (
          <div key={key}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium" style={{ color: C.textBody }}>
                {labelMap[key] ?? key}
              </span>
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
  const pts = entries.map(([, v], i) => {
    const x = PAD + (i / (entries.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((v / max) * (H - 2 * PAD));
    return { x, y, v, label: entries[i][0] };
  });

  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `M ${pts[0].x} ${H} ${pts.map(p => `L ${p.x} ${p.y}`).join(" ")} L ${pts[pts.length - 1].x} ${H} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 24}`}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.gold} stopOpacity="0.2" />
          <stop offset="100%" stopColor={C.gold} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((p, i) => (
        <line key={i} x1={PAD} y1={PAD + (1 - p) * (H - 2 * PAD)} x2={W - PAD} y2={PAD + (1 - p) * (H - 2 * PAD)}
          stroke={C.border} strokeWidth="1" strokeDasharray="6 6" />
      ))}
      <path d={areaD} fill="url(#areaGrad)" />
      <path d={pathD} fill="none" stroke={C.gold} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="5" fill={C.gold} stroke={C.card} strokeWidth="2.5" />
          <text x={p.x} y={H + 20} textAnchor="middle" fontSize="13" fill={C.textMuted}>{p.label}</text>
          {p.v > 0 && (
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="13" fill={C.gold} fontWeight="600">{p.v}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function Funnel({ data }: { data: Record<string, number> }) {
  const stages = [
    { key: "new",       label: "Importados",   color: C.cyan    },
    { key: "contacted", label: "Contactados",  color: C.gold    },
    { key: "qualified", label: "Calificados",  color: C.green   },
    { key: "cold",      label: "Sin respuesta",color: C.textMuted },
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
                {conv !== null && (
                  <span className="text-xs px-1.5 py-0.5 rounded tabular-nums"
                    style={{ backgroundColor: C.surface, color: C.textMuted }}>
                    {conv}% conv.
                  </span>
                )}
              </div>
            </div>
            <div className="w-full rounded-full h-2" style={{ backgroundColor: C.border }}>
              <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: s.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const statusLabels: Record<string, string> = { new: "Nuevo", contacted: "Contactado", qualified: "Calificado", cold: "Cold", closed_lost: "Perdido" };
const statusColors: Record<string, string> = { new: C.cyan, contacted: C.gold, qualified: C.green, cold: C.textMuted, closed_lost: C.red };
const classLabels: Record<string, string> = { positive: "Positivo", ambiguous: "Ambiguo", negative: "Negativo" };
const classColors: Record<string, string> = { positive: C.green, ambiguous: C.yellow, negative: C.red };
const channelColors: Record<string, string> = { linkedin: C.cyan, email: C.green, whatsapp: "#22c55e", call: C.gold };

export default async function ReportsPage() {
  const { replyBreakdown, leadBreakdown, channelBreakdown, sellerBreakdown, recentQualified, conversionRate, positiveRate, total, totalReplies, qualified, weeklyData, avgDaysToQualify, channelResponseRate } = await getReportData();

  const kpis = [
    { label: "Total leads",          value: total,                                          icon: Users,         color: C.gold  },
    { label: "Calificados",          value: qualified,                                      icon: Target,        color: C.green },
    { label: "Tasa de conversión",   value: `${conversionRate}%`,                           icon: TrendingUp,    color: C.cyan  },
    { label: "Respuesta positiva",   value: `${positiveRate}%`,                             icon: MessageSquare, color: C.gold  },
    { label: "Días promedio calific.",value: avgDaysToQualify != null ? `${avgDaysToQualify}d` : "—", icon: TrendingUp, color: C.yellow },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.gold }}>Análisis</p>
        <div className="flex items-end justify-between">
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Reportes</h1>
          <span className="text-sm" style={{ color: C.textMuted }}>Últimos 30 días</span>
        </div>
      </div>

      <div className="gold-divider mb-8" />

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>{label}</span>
              <Icon size={14} style={{ color }} />
            </div>
            <p className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Line chart: calificados por semana */}
      <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>
          Calificados por semana (últimas 4 semanas)
        </h2>
        <LineChart data={weeklyData} />
      </div>

      {/* Funnel */}
      <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.cyan}` }}>
        <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Embudo de conversión</h2>
        <Funnel data={leadBreakdown} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Leads por estado</h2>
          <HBarChart data={leadBreakdown} colorMap={statusColors} labelMap={statusLabels} />
        </div>

        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Respuestas</h2>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: C.cyanGlow, color: C.cyan }}>{totalReplies} total</span>
          </div>
          {totalReplies > 0
            ? <HBarChart data={replyBreakdown} colorMap={classColors} labelMap={classLabels} />
            : <p className="text-sm" style={{ color: C.textDim }}>Sin respuestas</p>
          }
        </div>

        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Tasa de respuesta por canal</h2>
          {Object.keys(channelResponseRate).length === 0
            ? <p className="text-sm" style={{ color: C.textDim }}>Sin datos</p>
            : <div className="space-y-3.5">
                {Object.entries(channelResponseRate).sort(([,a],[,b]) => b.rate - a.rate).map(([ch, { total: t, replied, rate }]) => {
                  const color = channelColors[ch] ?? C.textMuted;
                  const label = { linkedin:"LinkedIn", email:"Email", whatsapp:"WhatsApp", call:"Call" }[ch] ?? ch;
                  return (
                    <div key={ch}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium" style={{ color: C.textBody }}>{label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>{replied}/{t}</span>
                          <span className="text-sm font-bold tabular-nums" style={{ color }}>{rate}%</span>
                        </div>
                      </div>
                      <div className="w-full rounded-full h-2" style={{ backgroundColor: C.border }}>
                        <div className="h-2 rounded-full" style={{ width: `${rate}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>

      {/* Seller performance */}
      {Object.keys(sellerBreakdown).length > 0 && (
        <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Performance por seller</h2>
          <div className="grid grid-cols-2 gap-6">
            <HBarChart data={sellerBreakdown} colorMap={{}} labelMap={{}} />
            <div className="grid grid-cols-2 gap-3 content-start">
              {Object.entries(sellerBreakdown).sort(([, a], [, b]) => b - a).map(([seller, count], i) => (
                <div key={seller} className="rounded-lg border p-3 flex items-center gap-3"
                  style={{ backgroundColor: C.surface, borderColor: C.border }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: i === 0 ? `linear-gradient(135deg, ${C.gold}, #e8c84a)` : C.card, color: i === 0 ? "#04070d" : C.textMuted }}>
                    {seller[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{seller}</p>
                    <p className="text-xs" style={{ color: C.textMuted }}>{count} calificados</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Qualified leads table */}
      <div className="rounded-xl border" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Leads calificados recientes</h2>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: C.greenGlow, color: C.green }}>{recentQualified.length}</span>
        </div>
        {recentQualified.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm" style={{ color: C.textDim }}>Sin leads calificados aún</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.surface }}>
                {["Nombre", "Empresa", "Rol", "Seller", "Fecha"].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: C.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentQualified.map((lead) => (
                <tr key={lead.id} className="table-row-static"
                  style={{ borderBottom: `1px solid ${C.surface}` }}>
                  <td className="px-5 py-3 font-medium" style={{ color: C.textPrimary }}>
                    {lead.first_name} {lead.last_name}
                  </td>
                  <td className="px-5 py-3" style={{ color: C.textBody }}>{lead.company}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: C.textMuted }}>{lead.role}</td>
                  <td className="px-5 py-3 text-sm font-medium" style={{ color: C.gold }}>{lead.assigned_seller ?? "—"}</td>
                  <td className="px-5 py-3 text-xs tabular-nums" style={{ color: C.textMuted }}>
                    {new Date(lead.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
