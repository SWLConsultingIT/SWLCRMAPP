"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Building2, Users, Megaphone, Clock, ChevronRight,
  Target, Search, X, AlertTriangle, CheckCircle,
  ArrowRight, Loader2, Play, Shield,
} from "lucide-react";
import AdminActions from "./AdminActions";
import PageHero from "@/components/PageHero";

const gold = "#C9A83A";

type ClientData = {
  id: string;
  company_name: string;
  industry: string | null;
  location: string | null;
  logo_url: string | null;
  leads: number;
  profiles: number;
  campaigns: number;
  pendingProfiles: number;
  pendingCampaigns: number;
};

type PendingApproval = {
  id: string;
  type: "profile" | "campaign";
  name: string;
  clientName: string;
  clientId: string;
  subtitle: string;
  createdAt: string;
  href: string;
};

type ExecutionItem = {
  id: string;
  profileName: string;
  clientName: string;
  clientId: string;
  status: string;
  leadsUploaded: number | null;
  createdAt: string;
  href: string;
};

type Props = {
  clients: ClientData[];
  pendingApprovals: PendingApproval[];
  executionItems: ExecutionItem[];
  stats: {
    totalClients: number;
    totalLeads: number;
    pendingApprovals: number;
    activeCampaigns: number;
    executionPending: number;
  };
};

const execStatusMeta: Record<string, { label: string; color: string; bg: string }> = {
  not_started:  { label: "Not Started",     color: C.textMuted, bg: "#F3F4F6" },
  in_progress:  { label: "In Progress",     color: "#D97706",   bg: "#FFFBEB" },
  uploaded:     { label: "Leads Uploaded",   color: C.blue,      bg: C.blueLight },
};

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AdminClient({ clients, pendingApprovals, executionItems, stats }: Props) {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");

  const filteredClients = !search
    ? clients
    : clients.filter(c =>
        `${c.company_name} ${c.industry} ${c.location}`.toLowerCase().includes(search.toLowerCase())
      );

  const filteredApprovals = !search
    ? pendingApprovals
    : pendingApprovals.filter(a =>
        `${a.name} ${a.clientName} ${a.subtitle}`.toLowerCase().includes(search.toLowerCase())
      );

  const filteredExecution = !search
    ? executionItems
    : executionItems.filter(e =>
        `${e.profileName} ${e.clientName}`.toLowerCase().includes(search.toLowerCase())
      );

  const tabs = [
    { label: "Clients",            count: clients.length,          color: gold },
    { label: "Pending Approvals",  count: pendingApprovals.length, color: "#D97706" },
    { label: "Execution Pipeline", count: executionItems.length,   color: C.blue },
  ];

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={Shield}
        section="Internal"
        title="Admin Panel"
        description="Manage clients, review tickets, and monitor execution pipeline."
        accentColor={C.textMuted}
        status={{ label: "Internal", active: true }}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: "Clients",           value: stats.totalClients,     color: gold,     icon: Building2 },
          { label: "Total Leads",       value: stats.totalLeads,       color: C.blue,   icon: Users },
          { label: "Pending Approvals", value: stats.pendingApprovals, color: "#D97706", icon: Clock },
          { label: "Active Campaigns",  value: stats.activeCampaigns,  color: C.green,  icon: Megaphone },
          { label: "Execution Queue",   value: stats.executionPending, color: C.accent, icon: Play },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${color}` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
              <div className="rounded-lg p-1.5" style={{ backgroundColor: `${color}15` }}>
                <Icon size={13} style={{ color }} />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const isActive = tab === i;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: isActive ? `${t.color}15` : "#F3F4F6",
                    color: isActive ? t.color : C.textDim,
                  }}>
                  {t.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 mb-1"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={13} style={{ color: C.textDim }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..." className="bg-transparent text-sm outline-none w-36"
            style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
      </div>

      {/* ═══ Tab 0: Clients ═══ */}
      {tab === 0 && (
        filteredClients.length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Building2 size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No clients match your search" : "No clients registered yet"}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            {filteredClients.map((client, i) => {
              const totalPending = client.pendingProfiles + client.pendingCampaigns;
              return (
                <Link key={client.id} href={`/admin/${client.id}`}
                  className="flex items-center gap-5 px-5 py-4 transition-colors hover:bg-black/[0.015]"
                  style={{ borderBottom: i < filteredClients.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  {client.logo_url ? (
                    <img src={client.logo_url} alt="" className="w-11 h-11 rounded-xl object-cover border shrink-0" style={{ borderColor: C.border }} />
                  ) : (
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold shrink-0"
                      style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
                      {client.company_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>{client.company_name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                      {[client.industry, client.location].filter(Boolean).join(" · ") || "No details"}
                    </p>
                  </div>
                  <div className="flex items-center gap-5 shrink-0">
                    {[
                      { label: "Leads",     value: client.leads },
                      { label: "Profiles",  value: client.profiles },
                      { label: "Campaigns", value: client.campaigns },
                    ].map(m => (
                      <div key={m.label} className="text-center min-w-[50px]">
                        <p className="text-base font-bold tabular-nums" style={{ color: C.textPrimary }}>{m.value}</p>
                        <p className="text-[10px]" style={{ color: C.textMuted }}>{m.label}</p>
                      </div>
                    ))}
                    {totalPending > 0 && (
                      <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold shrink-0"
                        style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
                        <Clock size={10} /> {totalPending} pending
                      </span>
                    )}
                  </div>
                  <ChevronRight size={14} style={{ color: C.textDim }} className="shrink-0" />
                </Link>
              );
            })}
          </div>
        )
      )}

      {/* ═══ Tab 1: Pending Approvals ═══ */}
      {tab === 1 && (() => {
        const profiles = filteredApprovals.filter(a => a.type === "profile");
        const campaigns = filteredApprovals.filter(a => a.type === "campaign");

        if (filteredApprovals.length === 0) return (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No approvals match your search" : "All caught up — nothing to approve"}
            </p>
          </div>
        );

        return (
          <div className="space-y-6">
            {/* Profiles pending */}
            {profiles.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Target size={14} style={{ color: C.blue }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                    Lead Gen Profiles ({profiles.length})
                  </h3>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  {profiles.map((item, i) => (
                    <div key={item.id}
                      className="flex items-center gap-4 px-5 py-4"
                      style={{ borderBottom: i < profiles.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${C.blue}12` }}>
                        <Target size={15} style={{ color: C.blue }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={item.href} className="text-sm font-semibold hover:underline" style={{ color: C.textPrimary }}>
                          {item.name}
                        </Link>
                        <p className="text-xs" style={{ color: C.textMuted }}>
                          {item.clientName} · {timeAgo(item.createdAt)}
                        </p>
                      </div>
                      <AdminActions id={item.id} table="icp_profiles" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Campaigns pending */}
            {campaigns.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Megaphone size={14} style={{ color: gold }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                    Campaign Requests ({campaigns.length})
                  </h3>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  {campaigns.map((item, i) => (
                    <div key={item.id}
                      className="flex items-center gap-4 px-5 py-4"
                      style={{ borderBottom: i < campaigns.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${gold}12` }}>
                        <Megaphone size={15} style={{ color: gold }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={item.href} className="text-sm font-semibold hover:underline" style={{ color: C.textPrimary }}>
                          {item.name}
                        </Link>
                        <p className="text-xs" style={{ color: C.textMuted }}>
                          {item.clientName} · {item.subtitle} · {timeAgo(item.createdAt)}
                        </p>
                      </div>
                      <Link href={item.href}
                        className="text-[10px] font-medium flex items-center gap-1 mr-2 hover:underline"
                        style={{ color: gold }}>
                        Review <ArrowRight size={10} />
                      </Link>
                      <AdminActions id={item.id} table="campaign_requests" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══ Tab 2: Execution Pipeline ═══ */}
      {tab === 2 && (() => {
        if (filteredExecution.length === 0) return (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No items match your search" : "No profiles in execution pipeline"}
            </p>
          </div>
        );

        // Group by status
        const grouped: Record<string, typeof filteredExecution> = {};
        for (const item of filteredExecution) {
          if (!grouped[item.status]) grouped[item.status] = [];
          grouped[item.status].push(item);
        }

        const statusOrder = ["not_started", "in_progress", "uploaded"];

        return (
          <div className="space-y-6">
            {statusOrder.map(status => {
              const items = grouped[status];
              if (!items || items.length === 0) return null;
              const meta = execStatusMeta[status] ?? execStatusMeta.not_started;

              return (
                <div key={status}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                      {meta.label} ({items.length})
                    </h3>
                  </div>
                  <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                    {items.map((item, i) => (
                      <Link key={item.id} href={item.href}
                        className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015]"
                        style={{ borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${meta.color}12` }}>
                          <Target size={15} style={{ color: meta.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{item.profileName}</p>
                          <p className="text-xs" style={{ color: C.textMuted }}>{item.clientName}</p>
                        </div>
                        {item.leadsUploaded != null && item.leadsUploaded > 0 && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md shrink-0"
                            style={{ backgroundColor: C.blueLight, color: C.blue }}>
                            {item.leadsUploaded} leads uploaded
                          </span>
                        )}
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                          style={{ backgroundColor: meta.bg, color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{timeAgo(item.createdAt)}</span>
                        <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0" />
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
