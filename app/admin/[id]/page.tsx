import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Target, Users, Megaphone, Clock, MapPin, Briefcase, Globe,
  ChevronRight, Share2, Mail, Phone, User,
} from "lucide-react";
import AdminActions from "../AdminActions";

const gold = "#C9A83A";
const goldLight = "rgba(201,168,58,0.08)";

async function getClient(id: string) {
  const { data } = await supabase.from("company_bios").select("*").eq("id", id).single();
  return data;
}

async function getProfiles(bioId: string) {
  const { data } = await supabase
    .from("icp_profiles")
    .select("*")
    .eq("company_bio_id", bioId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getLeads(bioId: string) {
  const { data, count } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, status, current_channel, lead_score, primary_work_email", { count: "exact" })
    .eq("company_bio_id", bioId)
    .order("updated_at", { ascending: false })
    .limit(20);
  return { leads: data ?? [], total: count ?? 0 };
}

async function getCampaigns(bioId: string) {
  // Get lead IDs for this client, then get their campaigns
  const { data: leadIds } = await supabase.from("leads").select("id").eq("company_bio_id", bioId);
  if (!leadIds?.length) return { campaigns: [], total: 0 };
  const ids = leadIds.map(l => l.id);
  const { data, count } = await supabase
    .from("campaigns")
    .select("id, name, channel, status, current_step, sequence_steps, last_step_at, leads(primary_first_name, primary_last_name, company_name), sellers(name)", { count: "exact" })
    .in("lead_id", ids)
    .order("created_at", { ascending: false })
    .limit(20);
  return { campaigns: data ?? [], total: count ?? 0 };
}

async function getPendingCampaignRequests(_bioId: string, profileIds: string[], leadIds: string[]) {
  // Campaign requests linked via icp_profile_id or lead_id
  const requests: any[] = [];

  if (profileIds.length > 0) {
    const { data } = await supabase
      .from("campaign_requests")
      .select("*")
      .eq("status", "pending_review")
      .in("icp_profile_id", profileIds);
    if (data) requests.push(...data);
  }

  if (leadIds.length > 0) {
    const { data } = await supabase
      .from("campaign_requests")
      .select("*")
      .eq("status", "pending_review")
      .in("lead_id", leadIds)
      .is("icp_profile_id", null);
    if (data) requests.push(...data);
  }

  // Deduplicate by id and sort by created_at desc
  const seen = new Set<string>();
  return requests
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

const statusStyles: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "Pending",  color: "#D97706", bg: "#FFFBEB" },
  reviewed: { label: "Reviewed", color: C.blue,    bg: C.blueLight },
  approved: { label: "Approved", color: C.green,   bg: C.greenLight },
  rejected: { label: "Rejected", color: C.red,     bg: C.redLight },
};

const leadStatusStyles: Record<string, { color: string; bg: string }> = {
  new:           { color: C.blue,    bg: C.blueLight },
  contacted:     { color: C.orange,  bg: C.orangeLight },
  connected:     { color: C.accent,  bg: C.accentLight },
  responded:     { color: C.green,   bg: C.greenLight },
  qualified:     { color: C.green,   bg: C.greenLight },
  proposal_sent: { color: C.accent,  bg: C.accentLight },
  closed_won:    { color: C.green,   bg: C.greenLight },
  closed_lost:   { color: C.red,     bg: C.redLight },
};

const channelIcons: Record<string, { icon: typeof Share2; color: string }> = {
  linkedin: { icon: Share2, color: C.linkedin },
  email:    { icon: Mail,   color: C.email },
  call:     { icon: Phone,  color: C.phone },
};

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function AdminClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();

  const [profiles, { leads, total: totalLeads }, { campaigns, total: totalCampaigns }] = await Promise.all([
    getProfiles(id), getLeads(id), getCampaigns(id),
  ]);

  // Get IDs for campaign_requests lookup
  const profileIds = profiles.map((p: any) => p.id);
  const { data: clientLeadIds } = await supabase.from("leads").select("id").eq("company_bio_id", id);
  const leadIdList = (clientLeadIds ?? []).map((l: any) => l.id);
  const pendingRequests = await getPendingCampaignRequests(id, profileIds, leadIdList);

  const pendingProfiles = profiles.filter(p => p.status === "pending");
  const approvedProfiles = profiles.filter(p => p.status === "approved");

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        <Link href="/admin" className="hover:underline flex items-center gap-1"><ArrowLeft size={12} /> Admin</Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{client.company_name}</span>
      </div>

      {/* ═══ CLIENT HEADER ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6 flex items-start gap-5">
          {client.logo_url ? (
            <img src={client.logo_url} alt="" className="w-16 h-16 rounded-xl object-cover border shrink-0" style={{ borderColor: C.border }} />
          ) : (
            <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold shrink-0"
              style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
              {client.company_name?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{client.company_name}</h1>
            <div className="flex items-center gap-4 mt-1.5">
              {client.industry && <span className="flex items-center gap-1.5 text-sm" style={{ color: C.textBody }}><Briefcase size={13} style={{ color: gold }} /> {client.industry}</span>}
              {client.location && <span className="flex items-center gap-1 text-sm" style={{ color: C.textMuted }}><MapPin size={12} /> {client.location}</span>}
              {client.website && (
                <a href={client.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm hover:underline" style={{ color: C.accent }}>
                  <Globe size={12} /> Website
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="border-t" style={{ borderColor: C.border }} />

        {/* Client metrics */}
        <div className="px-6 py-4 grid grid-cols-5 gap-4">
          {[
            { label: "Lead Gen Profiles", value: profiles.length, color: gold },
            { label: "Pending Tickets", value: pendingProfiles.length, color: "#D97706" },
            { label: "Approved", value: approvedProfiles.length, color: C.green },
            { label: "Total Leads", value: totalLeads, color: C.blue },
            { label: "Campaigns", value: totalCampaigns, color: C.accent },
          ].map(m => (
            <div key={m.label}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>{m.label}</p>
              <p className="text-xl font-bold" style={{ color: m.color }}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ PENDING TICKETS ═══ */}
      {pendingProfiles.length > 0 && (
        <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid #D97706` }}>
          <div className="px-6 py-4 flex items-center gap-2.5 border-b" style={{ borderColor: C.border, background: "rgba(217,119,6,0.04)" }}>
            <Clock size={15} style={{ color: "#D97706" }} />
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Pending Tickets</h2>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
              {pendingProfiles.length}
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: C.border }}>
            {pendingProfiles.map((p: any) => (
              <div key={p.id} className="px-6 py-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>{p.profile_name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{timeAgo(p.created_at)}</p>
                  </div>
                  <AdminActions id={p.id} table="icp_profiles" />
                </div>
                <div className="flex flex-wrap gap-4 text-xs" style={{ color: C.textBody }}>
                  {p.target_industries?.length > 0 && (
                    <span><span className="font-medium" style={{ color: C.textMuted }}>Industries:</span> {p.target_industries.join(", ")}</span>
                  )}
                  {p.target_roles?.length > 0 && (
                    <span><span className="font-medium" style={{ color: C.textMuted }}>Roles:</span> {p.target_roles.join(", ")}</span>
                  )}
                  {p.geography?.length > 0 && (
                    <span><span className="font-medium" style={{ color: C.textMuted }}>Geo:</span> {p.geography.join(", ")}</span>
                  )}
                  {p.company_size && (
                    <span><span className="font-medium" style={{ color: C.textMuted }}>Size:</span> {p.company_size}</span>
                  )}
                </div>
                {p.pain_points && (
                  <p className="text-xs mt-2" style={{ color: C.textBody }}>
                    <span className="font-medium" style={{ color: C.textMuted }}>Pain: </span>{p.pain_points}
                  </p>
                )}
                {p.solutions_offered && (
                  <p className="text-xs mt-1" style={{ color: C.textBody }}>
                    <span className="font-medium" style={{ color: C.textMuted }}>Solution: </span>{p.solutions_offered}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ PENDING CAMPAIGN REVIEWS ═══ */}
      {pendingRequests.length > 0 && (
        <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.blue}` }}>
          <div className="px-6 py-4 flex items-center gap-2.5 border-b" style={{ borderColor: C.border, background: `${C.blue}06` }}>
            <Megaphone size={15} style={{ color: C.blue }} />
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Pending Campaign Reviews</h2>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: C.blueLight, color: C.blue }}>
              {pendingRequests.length}
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: C.border }}>
            {pendingRequests.map((req: any) => {
              const prompts = req.message_prompts ?? {};
              const sequence: { channel: string; daysAfter: number }[] = prompts.sequence ?? [];
              const channels: string[] = req.channels ?? [...new Set(sequence.map((s: any) => s.channel))];
              const isIndividual = !!req.lead_id && req.target_leads_count === 1;

              const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
                linkedin: { icon: Share2, color: C.linkedin, label: "LinkedIn" },
                email:    { icon: Mail,   color: C.email,    label: "Email" },
                call:     { icon: Phone,  color: C.phone,    label: "Call" },
              };

              let totalDays = 0;
              sequence.forEach((s: any, i: number) => { totalDays += i === 0 ? 0 : s.daysAfter; });

              return (
                <div key={req.id} className="px-6 py-5">
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-4">
                    <Link href={`/admin/review/${req.id}`} className="flex-1 hover:opacity-80 transition-opacity">
                      <div className="flex items-center gap-2 mb-1">
                        {isIndividual && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                            style={{ backgroundColor: `${gold}15`, color: gold }}>
                            <User size={10} /> Individual
                          </span>
                        )}
                        <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>{req.name}</h3>
                        <span className="text-xs" style={{ color: gold }}>View details →</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: C.textMuted }}>
                        <span>{timeAgo(req.created_at)}</span>
                        <span>·</span>
                        <span>{req.target_leads_count} {req.target_leads_count === 1 ? "lead" : "leads"}</span>
                        <span>·</span>
                        <span>{sequence.length} steps · ~{totalDays} days</span>
                        {prompts.language && <><span>·</span><span>{prompts.language.toUpperCase()}</span></>}
                      </div>
                    </Link>
                    <AdminActions id={req.id} table="campaign_requests" />
                  </div>

                  {/* Channels summary */}
                  <div className="flex items-center gap-2">
                    {channels.map((ch: string) => {
                      const meta = channelMeta[ch];
                      if (!meta) return null;
                      const Icon = meta.icon;
                      return (
                        <span key={ch} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md"
                          style={{ backgroundColor: `${meta.color}12`, color: meta.color }}>
                          <Icon size={11} /> {meta.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ TWO COLUMNS: Profiles + Leads ═══ */}
      <div className="grid grid-cols-2 gap-6 mb-6">

        {/* All Lead Gen Profiles */}
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <div className="px-6 py-4 flex items-center justify-between border-b"
            style={{ borderColor: C.border, background: `linear-gradient(90deg, ${goldLight} 0%, transparent 50%)` }}>
            <div className="flex items-center gap-2">
              <Target size={14} style={{ color: gold }} />
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Lead Gen Profiles</h2>
            </div>
            <span className="text-xs" style={{ color: C.textMuted }}>{profiles.length} total</span>
          </div>
          {profiles.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm" style={{ color: C.textDim }}>No profiles created yet</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: C.border }}>
              {profiles.map((p: any) => {
                const st = statusStyles[p.status] ?? statusStyles.pending;
                return (
                  <Link key={p.id} href={`/admin/${id}/profile/${p.id}`}
                    className="px-6 py-3.5 flex items-center gap-3 table-row-hover">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{p.profile_name}</p>
                      <p className="text-xs" style={{ color: C.textMuted }}>
                        {[...(p.target_industries ?? []), ...(p.target_roles ?? [])].slice(0, 3).join(", ")}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold shrink-0"
                      style={{ backgroundColor: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                    {p.status === "approved" && p.execution_status && p.execution_status !== "not_started" && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-md shrink-0"
                        style={{
                          backgroundColor: p.execution_status === "completed" ? C.greenLight : p.execution_status === "uploaded" ? C.blueLight : "#FFFBEB",
                          color: p.execution_status === "completed" ? C.green : p.execution_status === "uploaded" ? C.blue : "#D97706",
                        }}>
                        {p.execution_status === "completed" ? "Done" : p.execution_status === "uploaded" ? "Leads Uploaded" : "In Progress"}
                      </span>
                    )}
                    <ChevronRight size={14} style={{ color: C.textDim }} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Leads */}
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.blue}` }}>
          <div className="px-6 py-4 flex items-center justify-between border-b"
            style={{ borderColor: C.border, background: `${C.blue}08` }}>
            <div className="flex items-center gap-2">
              <Users size={14} style={{ color: C.blue }} />
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Leads</h2>
            </div>
            <span className="text-xs" style={{ color: C.textMuted }}>{totalLeads} total</span>
          </div>
          {leads.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm" style={{ color: C.textDim }}>No leads assigned yet</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: C.border }}>
              {leads.map((lead: any) => {
                const st = leadStatusStyles[lead.status] ?? { color: C.textMuted, bg: "#F3F4F6" };
                return (
                  <Link key={lead.id} href={`/leads/${lead.id}`}
                    className="flex items-center gap-3 px-6 py-3 table-row-hover">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
                      {(lead.primary_first_name?.[0] ?? "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>
                        {lead.primary_first_name} {lead.primary_last_name}
                      </p>
                      <p className="text-xs truncate" style={{ color: C.textMuted }}>{lead.company_name}</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md capitalize shrink-0"
                      style={{ backgroundColor: st.bg, color: st.color }}>
                      {lead.status?.replace("_", " ")}
                    </span>
                    <ChevronRight size={14} style={{ color: C.textDim }} />
                  </Link>
                );
              })}
              {totalLeads > 20 && (
                <div className="px-6 py-3 text-center">
                  <Link href="/leads" className="text-xs font-semibold" style={{ color: gold }}>
                    View all {totalLeads} leads →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ CAMPAIGNS ═══ */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.green}` }}>
        <div className="px-6 py-4 flex items-center justify-between border-b"
          style={{ borderColor: C.border, background: `${C.green}08` }}>
          <div className="flex items-center gap-2">
            <Megaphone size={14} style={{ color: C.green }} />
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Campaigns</h2>
          </div>
          <span className="text-xs" style={{ color: C.textMuted }}>{totalCampaigns} total</span>
        </div>
        {campaigns.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm" style={{ color: C.textDim }}>No campaigns running yet</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: C.border }}>
            {campaigns.map((c: any) => {
              const ch = channelIcons[c.channel] ?? channelIcons.email;
              const ChIcon = ch.icon;
              const totalSteps = c.sequence_steps?.length ?? 0;
              const pct = totalSteps > 0 ? Math.round((c.current_step / totalSteps) * 100) : 0;
              const isActive = c.status === "active";
              return (
                <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center gap-4 px-6 py-3.5 table-row-hover">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: C.textPrimary }}>
                      {c.leads?.primary_first_name} {c.leads?.primary_last_name}
                    </p>
                    <p className="text-xs" style={{ color: C.textMuted }}>{c.leads?.company_name}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ChIcon size={13} style={{ color: ch.color }} />
                    <span className="text-xs font-semibold capitalize" style={{ color: ch.color }}>{c.channel}</span>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md capitalize shrink-0"
                    style={{ backgroundColor: isActive ? C.greenLight : "#F3F4F6", color: isActive ? C.green : C.textMuted }}>
                    {c.status}
                  </span>
                  <div className="flex items-center gap-2 w-24 shrink-0">
                    <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${gold}, #e8c84a)` }} />
                    </div>
                    <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>{c.current_step}/{totalSteps}</span>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: C.textBody }}>{c.sellers?.name ?? "—"}</span>
                  <span className="text-xs tabular-nums shrink-0" style={{ color: C.textMuted }}>{c.last_step_at ? timeAgo(c.last_step_at) : "—"}</span>
                  <ChevronRight size={14} style={{ color: C.textDim }} />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
