import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Mail, Phone, MessageCircle, CheckCircle, PauseCircle, XCircle, PlayCircle, Wifi } from "lucide-react";

async function getCampaigns() {
  const { data } = await supabase
    .from("campaigns")
    .select("id, status, channel, current_step, sequence_steps, channel_msg_index, last_step_at, paused_until, completed_at, created_at, leads(id, first_name, last_name, company, role, status), sellers(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  return data ?? [];
}

type CampaignStatus = "active" | "paused" | "completed" | "failed";
type Channel = "linkedin" | "email" | "whatsapp" | "call";

const statusConfig: Record<CampaignStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  active:    { label: "Activa",     color: C.green,    bg: C.greenGlow,   icon: PlayCircle },
  paused:    { label: "Pausada",    color: C.yellow,   bg: C.yellowGlow,  icon: PauseCircle },
  completed: { label: "Completada", color: C.textMuted,bg: "rgba(78,90,114,0.08)", icon: CheckCircle },
  failed:    { label: "Error",      color: C.red,      bg: C.redGlow,     icon: XCircle },
};

const channelConfig: Record<Channel, { icon: React.ElementType; color: string; label: string }> = {
  linkedin:  { icon: Wifi,          color: C.cyan,   label: "LinkedIn" },
  email:     { icon: Mail,          color: C.green,  label: "Email" },
  whatsapp:  { icon: MessageCircle, color: "#22c55e",label: "WhatsApp" },
  call:      { icon: Phone,         color: C.gold,   label: "Call" },
};

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();

  const active    = campaigns.filter(c => c.status === "active").length;
  const paused    = campaigns.filter(c => c.status === "paused").length;
  const completed = campaigns.filter(c => c.status === "completed").length;

  return (
    <div className="p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.gold }}>Automatización</p>
        <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Campañas</h1>
      </div>

      <div className="gold-divider mb-6" />

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total",       value: campaigns.length, color: C.gold,     border: C.gold },
          { label: "Activas",     value: active,           color: C.green,    border: C.green },
          { label: "Pausadas",    value: paused,           color: C.yellow,   border: C.yellow },
          { label: "Completadas", value: completed,        color: C.textMuted,border: C.border2 },
        ].map(({ label, value, color, border }) => (
          <div key={label} className="rounded-xl border p-4 relative overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${border}` }}>
            <div className="absolute -top-3 -right-3 w-12 h-12 rounded-full pointer-events-none"
              style={{ background: color, opacity: 0.05, filter: "blur(10px)" }} />
            <p className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</p>
            <p className="text-xs mt-1 font-medium uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.gold}` }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}`, background: "linear-gradient(90deg, rgba(201,168,58,0.05) 0%, transparent 50%)" }}>
              {["Lead", "Canal", "Estado", "Progreso", "Seller", "Último paso", "Pausa hasta"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: C.textMuted }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(campaigns as any[]).map((c) => {
              const st  = statusConfig[(c.status as CampaignStatus)] ?? statusConfig.active;
              const ch  = channelConfig[(c.channel as Channel)] ?? channelConfig.linkedin;
              const StIcon   = st.icon;
              const ChanIcon = ch.icon;
              const totalSteps = c.sequence_steps?.length ?? 0;
              const pct = totalSteps > 0 ? Math.round((c.current_step / totalSteps) * 100) : 0;

              return (
                <tr key={c.id} className="table-row-static"
                  style={{ borderBottom: `1px solid ${C.surface}` }}>
                  <td className="px-4 py-3">
                    <p className="font-medium" style={{ color: C.textPrimary }}>
                      {c.leads?.first_name} {c.leads?.last_name}
                    </p>
                    <p className="text-xs" style={{ color: C.textMuted }}>{c.leads?.company}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <ChanIcon size={13} style={{ color: ch.color }} />
                      <span className="text-xs font-semibold" style={{ color: ch.color }}>{ch.label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
                      style={{ backgroundColor: st.bg }}>
                      <StIcon size={11} style={{ color: st.color }} />
                      <span className="text-xs font-semibold" style={{ color: st.color }}>{st.label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-28 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
                        <div className="h-1.5 rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: pct === 100
                              ? C.textMuted
                              : `linear-gradient(90deg, ${C.gold}, #e8c84a)`,
                          }} />
                      </div>
                      <span className="text-xs tabular-nums font-medium" style={{ color: C.textMuted }}>
                        {c.current_step}/{totalSteps}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: C.textBody }}>{c.sellers?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs tabular-nums" style={{ color: C.textMuted }}>
                    {c.last_step_at
                      ? new Date(c.last_step_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {c.paused_until ? (
                      <span className="text-xs font-semibold tabular-nums" style={{ color: C.yellow }}>
                        {new Date(c.paused_until).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                      </span>
                    ) : (
                      <span style={{ color: C.textDim }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {campaigns.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: C.textDim }}>Sin campañas registradas</p>
          </div>
        )}
      </div>
    </div>
  );
}
