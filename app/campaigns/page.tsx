import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Mail, Phone, Share2, CheckCircle, PauseCircle, XCircle, PlayCircle } from "lucide-react";

async function getCampaigns() {
  const { data } = await supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, paused_until, completed_at, created_at, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, status), sellers(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  return data ?? [];
}

type CampaignStatus = "active" | "paused" | "completed" | "failed";
type Channel = "linkedin" | "email" | "whatsapp" | "call";

const statusConfig: Record<CampaignStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  active:    { label: "Active",    color: C.green,    bg: C.greenLight,  icon: PlayCircle },
  paused:    { label: "Paused",    color: "#D97706",  bg: "#FFFBEB",     icon: PauseCircle },
  completed: { label: "Completed", color: C.textMuted,bg: "#F3F4F6",     icon: CheckCircle },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight,    icon: XCircle },
};

const channelConfig: Record<Channel, { icon: React.ElementType; color: string; label: string }> = {
  linkedin:  { icon: Share2, color: C.linkedin, label: "LinkedIn" },
  email:     { icon: Mail,   color: C.email,    label: "Email" },
  whatsapp:  { icon: Mail,   color: "#22c55e",  label: "WhatsApp" },
  call:      { icon: Phone,  color: C.phone,    label: "Call" },
};

// Gold accent color for this page
const gold = "#C9A83A";
const goldLight = "rgba(201,168,58,0.08)";

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();

  const active    = campaigns.filter(c => c.status === "active").length;
  const paused    = campaigns.filter(c => c.status === "paused").length;
  const completed = campaigns.filter(c => c.status === "completed").length;

  return (
    <div className="p-8 w-full">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Automation</p>
        <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Campaigns</h1>
      </div>

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total",     value: campaigns.length, color: gold,       border: gold },
          { label: "Active",    value: active,           color: C.green,    border: C.green },
          { label: "Paused",    value: paused,           color: "#D97706",  border: "#D97706" },
          { label: "Completed", value: completed,        color: C.textMuted,border: C.border },
        ].map(({ label, value, color, border }) => (
          <div key={label} className="rounded-xl border p-5"
            style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${border}` }}>
            <p className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</p>
            <p className="text-xs mt-1 font-medium uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}`, background: `linear-gradient(90deg, ${goldLight} 0%, transparent 50%)` }}>
              {["Lead", "Channel", "Status", "Progress", "Seller", "Last Step", "Paused Until"].map(h => (
                <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider"
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
                <tr key={c.id} className="table-row-hover"
                  style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td className="px-5 py-3.5">
                    <p className="font-medium" style={{ color: C.textPrimary }}>
                      {c.leads?.primary_first_name} {c.leads?.primary_last_name}
                    </p>
                    <p className="text-xs" style={{ color: C.textMuted }}>{c.leads?.company_name}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <ChanIcon size={13} style={{ color: ch.color }} />
                      <span className="text-xs font-semibold" style={{ color: ch.color }}>{ch.label}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
                      style={{ backgroundColor: st.bg }}>
                      <StIcon size={11} style={{ color: st.color }} />
                      <span className="text-xs font-semibold" style={{ color: st.color }}>{st.label}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-28 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                        <div className="h-1.5 rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: pct === 100 ? C.textDim : `linear-gradient(90deg, ${gold}, #e8c84a)`,
                          }} />
                      </div>
                      <span className="text-xs tabular-nums font-medium" style={{ color: C.textMuted }}>
                        {c.current_step}/{totalSteps}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: C.textBody }}>{c.sellers?.name ?? "—"}</td>
                  <td className="px-5 py-3.5 text-xs tabular-nums" style={{ color: C.textMuted }}>
                    {c.last_step_at
                      ? new Date(c.last_step_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    {c.paused_until ? (
                      <span className="text-xs font-semibold tabular-nums" style={{ color: "#D97706" }}>
                        {new Date(c.paused_until).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })}
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
            <p className="text-sm" style={{ color: C.textDim }}>No campaigns registered</p>
          </div>
        )}
      </div>
    </div>
  );
}
