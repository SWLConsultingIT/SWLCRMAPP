import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Building2, Users, Megaphone, Clock, ChevronRight } from "lucide-react";
import Link from "next/link";

const gold = "#C9A83A";
const goldLight = "rgba(201,168,58,0.08)";

async function getClients() {
  const { data: bios } = await supabase
    .from("company_bios")
    .select("id, company_name, industry, logo_url, location, created_at")
    .order("created_at", { ascending: false });

  const clients = [];
  for (const bio of bios ?? []) {
    const [{ count: leads }, { count: profiles }, { count: pendingReviewClient }, { count: pendingExecClient }] = await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("company_bio_id", bio.id),
      supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("company_bio_id", bio.id),
      supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("company_bio_id", bio.id).eq("status", "pending"),
      supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("company_bio_id", bio.id).eq("status", "approved").in("execution_status", ["not_started", "in_progress"]),
    ]);
    const pendingProfiles = (pendingReviewClient ?? 0) + (pendingExecClient ?? 0);
    // Count campaigns through this client's leads
    const { data: clientLeadIds } = await supabase.from("leads").select("id").eq("company_bio_id", bio.id);
    let campaignCount = 0;
    if (clientLeadIds?.length) {
      const { count } = await supabase.from("campaigns").select("*", { count: "exact", head: true }).in("lead_id", clientLeadIds.map(l => l.id)).eq("status", "active");
      campaignCount = count ?? 0;
    }
    clients.push({ ...bio, leads: leads ?? 0, profiles: profiles ?? 0, pendingProfiles: pendingProfiles ?? 0, campaigns: campaignCount });
  }
  return clients;
}

async function getGlobalStats() {
  const [{ count: totalClients }, { count: totalLeads }, { count: pendingReview }, { count: pendingExecution }, { count: totalCampaigns }] = await Promise.all([
    supabase.from("company_bios").select("*", { count: "exact", head: true }),
    supabase.from("leads").select("*", { count: "exact", head: true }),
    supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("status", "approved").in("execution_status", ["not_started", "in_progress"]),
    supabase.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "active"),
  ]);
  const pendingTickets = (pendingReview ?? 0) + (pendingExecution ?? 0);
  return { totalClients: totalClients ?? 0, totalLeads: totalLeads ?? 0, pendingTickets, totalCampaigns: totalCampaigns ?? 0 };
}

export default async function AdminPage() {
  const [clients, stats] = await Promise.all([getClients(), getGlobalStats()]);

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Internal</p>
        <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Admin Panel</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          Manage clients, review tickets, and monitor activity. Not visible to clients.
        </p>
      </div>

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      {/* Global stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Clients", value: stats.totalClients, color: gold, icon: Building2 },
          { label: "Total Leads", value: stats.totalLeads, color: C.blue, icon: Users },
          { label: "Pending Tickets", value: stats.pendingTickets, color: "#D97706", icon: Clock },
          { label: "Active Campaigns", value: stats.totalCampaigns, color: C.green, icon: Megaphone },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${color}` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
              <div className="rounded-lg p-2" style={{ backgroundColor: `${color}15` }}>
                <Icon size={14} style={{ color }} />
              </div>
            </div>
            <p className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Clients list */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <div className="px-6 py-4 flex items-center justify-between border-b"
          style={{ borderColor: C.border, background: `linear-gradient(90deg, ${goldLight} 0%, transparent 50%)` }}>
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Clients</h2>
          <span className="text-xs" style={{ color: C.textMuted }}>{clients.length} total</span>
        </div>

        {clients.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm" style={{ color: C.textDim }}>No clients registered yet</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: C.border }}>
            {clients.map((client: any) => (
              <Link key={client.id} href={`/admin/${client.id}`}
                className="flex items-center gap-5 px-6 py-5 table-row-hover">
                {/* Avatar */}
                {client.logo_url ? (
                  <img src={client.logo_url} alt="" className="w-12 h-12 rounded-xl object-cover border shrink-0" style={{ borderColor: C.border }} />
                ) : (
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
                    style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
                    {client.company_name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>{client.company_name}</h3>
                  <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                    {[client.industry, client.location].filter(Boolean).join(" · ") || "No details"}
                  </p>
                </div>

                {/* Metrics */}
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-lg font-bold tabular-nums" style={{ color: C.textPrimary }}>{client.leads}</p>
                    <p className="text-xs" style={{ color: C.textMuted }}>Leads</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold tabular-nums" style={{ color: C.textPrimary }}>{client.profiles}</p>
                    <p className="text-xs" style={{ color: C.textMuted }}>Profiles</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold tabular-nums" style={{ color: C.textPrimary }}>{client.campaigns}</p>
                    <p className="text-xs" style={{ color: C.textMuted }}>Campaigns</p>
                  </div>
                  {client.pendingProfiles > 0 && (
                    <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
                      style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
                      <Clock size={11} /> {client.pendingProfiles} pending
                    </span>
                  )}
                </div>

                <ChevronRight size={16} style={{ color: C.textDim }} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
