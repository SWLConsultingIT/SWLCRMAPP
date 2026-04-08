import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Users, Phone, MessageSquare, TrendingUp, Clock, MinusCircle } from "lucide-react";
import StatCard from "@/components/StatCard";
import AutoRefresh from "@/components/AutoRefresh";

async function getStats() {
  const today = new Date().toISOString().split("T")[0];
  const [
    { count: activeLeads },
    { count: activeCampaigns },
    { count: callsToday },
    { count: repliesToday },
    { count: qualifiedTotal },
    { count: coldTotal },
  ] = await Promise.all([
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "contacted"),
    supabase.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("campaigns").select("*", { count: "exact", head: true }).gte("last_step_at", today).eq("channel", "call"),
    supabase.from("lead_replies").select("*", { count: "exact", head: true }).gte("received_at", today),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "qualified"),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "cold"),
  ]);
  return {
    activeLeads: activeLeads ?? 0,
    activeCampaigns: activeCampaigns ?? 0,
    callsToday: callsToday ?? 0,
    repliesToday: repliesToday ?? 0,
    qualifiedTotal: qualifiedTotal ?? 0,
    coldTotal: coldTotal ?? 0,
  };
}

async function getRecentReplies() {
  const { data } = await supabase
    .from("lead_replies")
    .select("id, classification, received_at, message, lead_id, leads(first_name, last_name, company)")
    .order("received_at", { ascending: false })
    .limit(8);
  return data ?? [];
}

async function getPendingCalls() {
  const { data } = await supabase
    .from("campaigns")
    .select("id, last_step_at, leads(id, first_name, last_name, company, role), sellers(name)")
    .eq("status", "active")
    .eq("channel", "call")
    .order("last_step_at", { ascending: true })
    .limit(6);
  return data ?? [];
}

async function getRecentQualified() {
  const { data } = await supabase
    .from("leads")
    .select("id, first_name, last_name, company, assigned_seller, created_at")
    .eq("status", "qualified")
    .order("updated_at", { ascending: false })
    .limit(4);
  return data ?? [];
}

const classStyle: Record<string, { color: string; bg: string; dot: string; label: string }> = {
  positive: { color: C.green,  bg: C.greenGlow,  dot: C.green,  label: "Positivo" },
  negative: { color: C.red,    bg: C.redGlow,    dot: C.red,    label: "Negativo" },
  ambiguous:{ color: C.yellow, bg: C.yellowGlow, dot: C.yellow, label: "Ambiguo" },
};

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export default async function DashboardPage() {
  const [stats, replies, calls, qualified] = await Promise.all([
    getStats(), getRecentReplies(), getPendingCalls(), getRecentQualified(),
  ]);

  const dateStr = new Date().toLocaleDateString("es-AR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  return (
    <div className="p-8 max-w-7xl">
      <AutoRefresh intervalMs={60000} />

      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.gold }}>SWL CONSULTING</p>
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Dashboard</h1>
        </div>
        <p className="text-sm capitalize" style={{ color: C.textMuted }}>{dateStr}</p>
      </div>

      <div className="gold-divider mb-8" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Leads activos"     value={stats.activeLeads}     icon={Users}         variant="gold"  sub="en seguimiento" />
        <StatCard label="Campañas activas"  value={stats.activeCampaigns} icon={Clock}         variant="cyan" />
        <StatCard label="Llamadas hoy"      value={stats.callsToday}      icon={Phone}         variant="gold" />
        <StatCard label="Respuestas hoy"    value={stats.repliesToday}    icon={MessageSquare} variant="cyan" />
        <StatCard label="Calificados total" value={stats.qualifiedTotal}  icon={TrendingUp}    variant="green" sub="pasados a Odoo" />
        <StatCard label="Cold"              value={stats.coldTotal}       icon={MinusCircle}   variant="muted" sub="sin respuesta" />
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-3 gap-6">

        {/* Recent replies — 2 cols */}
        <div className="col-span-2 rounded-xl border overflow-hidden"
          style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.cyan}` }}>
          <div className="px-6 py-4 flex items-center justify-between border-b"
            style={{ borderColor: C.border, background: "linear-gradient(90deg, rgba(0,229,255,0.04) 0%, transparent 60%)" }}>
            <div className="flex items-center gap-2">
              <MessageSquare size={13} style={{ color: C.cyan }} />
              <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Respuestas recientes</h2>
            </div>
            {replies.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: C.cyanGlow, color: C.cyan }}>
                {replies.length}
              </span>
            )}
          </div>
          <div className="p-6">
            {replies.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: C.textDim }}>Sin respuestas hoy</p>
            ) : (
              <div className="space-y-2">
                {(replies as any[]).map((r) => {
                  const cs = classStyle[r.classification] ?? classStyle.ambiguous;
                  return (
                    <div key={r.id} className="flex items-start gap-3 p-3 rounded-lg"
                      style={{ backgroundColor: C.surface }}>
                      <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: cs.dot }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: cs.bg, color: cs.color }}>
                            {cs.label}
                          </span>
                          {r.leads && (
                            <span className="text-xs font-medium truncate" style={{ color: C.textBody }}>
                              {r.leads.first_name} {r.leads.last_name} · {r.leads.company}
                            </span>
                          )}
                        </div>
                        <p className="text-sm line-clamp-1" style={{ color: C.textMuted }}>{r.message}</p>
                      </div>
                      <span className="text-xs shrink-0 tabular-nums" style={{ color: C.textDim }}>
                        {timeAgo(r.received_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">

          {/* Call queue */}
          <div className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.gold}` }}>
            <div className="px-5 py-4 flex items-center justify-between border-b"
              style={{ borderColor: C.border, background: "linear-gradient(90deg, rgba(201,168,58,0.05) 0%, transparent 60%)" }}>
              <div className="flex items-center gap-2">
                <Phone size={13} style={{ color: C.gold }} />
                <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Llamadas</h2>
              </div>
              {(calls as any[]).length > 0 && (
                <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: C.goldGlow, color: C.gold }}>
                  <span className="pulse-dot w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: C.gold }} />
                  {(calls as any[]).length}
                </span>
              )}
            </div>
            <div className="p-5">
              {(calls as any[]).length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: C.textDim }}>Sin llamadas</p>
              ) : (
                <div className="space-y-2.5">
                  {(calls as any[]).map((c, i) => (
                    <div key={c.id} className="flex items-center gap-2.5">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ backgroundColor: i === 0 ? C.goldGlow : C.surface, color: i === 0 ? C.gold : C.textMuted }}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>
                          {c.leads?.first_name} {c.leads?.last_name}
                        </p>
                        <p className="text-xs truncate" style={{ color: C.textMuted }}>{c.leads?.company}</p>
                      </div>
                      <span className="text-xs shrink-0 font-medium" style={{ color: C.gold }}>{c.sellers?.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent qualified */}
          <div className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.green}` }}>
            <div className="px-5 py-4 border-b flex items-center gap-2"
              style={{ borderColor: C.border, background: "linear-gradient(90deg, rgba(61,220,132,0.04) 0%, transparent 60%)" }}>
              <TrendingUp size={13} style={{ color: C.green }} />
              <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Calificados recientes</h2>
            </div>
            <div className="p-5">
              {qualified.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: C.textDim }}>Ninguno aún</p>
              ) : (
                <div className="space-y-2.5">
                  {(qualified as any[]).map((l) => (
                    <div key={l.id} className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: C.green }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>
                          {l.first_name} {l.last_name}
                        </p>
                        <p className="text-xs truncate" style={{ color: C.textMuted }}>{l.company}</p>
                      </div>
                      <span className="text-xs shrink-0" style={{ color: C.textMuted }}>{l.assigned_seller}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
