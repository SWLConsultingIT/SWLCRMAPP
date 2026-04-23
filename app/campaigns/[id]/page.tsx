import { getSupabaseServer } from "@/lib/supabase-server";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, PlayCircle, PauseCircle, CheckCircle, XCircle,
  Users, Clock, Settings,
} from "lucide-react";
import CampaignDetailClient from "./CampaignDetailClient";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  whatsapp: { icon: Mail,   color: "#22c55e", label: "WhatsApp" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const statusMeta: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  active:    { label: "Active",    color: C.green,    bg: C.greenLight,  icon: PlayCircle },
  paused:    { label: "Paused",    color: "#D97706",  bg: "#FFFBEB",     icon: PauseCircle },
  completed: { label: "Completed", color: C.textMuted, bg: "#F3F4F6",    icon: CheckCircle },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight,    icon: XCircle },
};

async function getCampaign(id: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("*, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, company_industry, icp_profile_id), sellers(name)")
    .eq("id", id)
    .single();
  return data;
}

async function getMessages(campaignId: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaign_messages")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("step_number", { ascending: true });
  return data ?? [];
}

async function getSiblingCampaigns(campaignName: string, excludeId: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("id, status, current_step, sequence_steps, channel, last_step_at, seller_id, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_phone, lead_score, is_priority), sellers(name)")
    .eq("name", campaignName)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(500);
  return data ?? [];
}

async function getUnlinkedLeadsByProfile() {
  const supabase = await getSupabaseServer();
  const { data: activeCampLeadIds } = await supabase
    .from("campaigns").select("lead_id").in("status", ["active", "paused"]);
  const activeSet = new Set((activeCampLeadIds ?? []).map(c => c.lead_id).filter(Boolean));

  const { data: allLeads } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, lead_score, allow_linkedin, allow_email, allow_call, icp_profile_id")
    .order("created_at", { ascending: false }).limit(200);

  const { data: profiles } = await supabase
    .from("icp_profiles").select("id, profile_name").eq("status", "approved");
  const profileMap: Record<string, string> = {};
  (profiles ?? []).forEach(p => { profileMap[p.id] = p.profile_name; });

  const unlinked = (allLeads ?? []).filter(l => !activeSet.has(l.id));
  const grouped: Record<string, { profileName: string; leads: any[] }> = {};
  for (const l of unlinked) {
    const key = l.icp_profile_id ?? "__none";
    if (!grouped[key]) grouped[key] = { profileName: profileMap[l.icp_profile_id ?? ""] ?? "Unassigned", leads: [] };
    grouped[key].leads.push(l);
  }
  return Object.values(grouped);
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await getSupabaseServer();
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const [messages, siblings, unlinkedLeads, campRequest] = await Promise.all([
    getMessages(id),
    getSiblingCampaigns(campaign.name, id),
    getUnlinkedLeadsByProfile(),
    supabase.from("campaign_requests").select("message_prompts").eq("name", campaign.name).limit(1).maybeSingle(),
  ]);
  const autoReplies = campRequest?.data?.message_prompts?.channelMessages?.autoReplies ?? {};
  const connectionNote = campRequest?.data?.message_prompts?.channelMessages?.connectionRequest ?? "";
  const messageTemplates: { channel: string; body: string; subject?: string }[] =
    campRequest?.data?.message_prompts?.channelMessages?.steps ?? [];

  const sequence: { channel: string; daysAfter: number }[] = campaign.sequence_steps ?? [];
  const channels = [...new Set(sequence.map((s: any) => s.channel))];
  const totalSteps = sequence.length;
  const pct = totalSteps > 0 ? Math.round((campaign.current_step / totalSteps) * 100) : 0;
  const st = statusMeta[campaign.status] ?? statusMeta.active;
  const StIcon = st.icon;
  const leadName = `${campaign.leads?.primary_first_name ?? ""} ${campaign.leads?.primary_last_name ?? ""}`.trim() || "Unknown";

  // All leads in this campaign group (current + siblings)
  const allGroupCampaigns = [
    { ...campaign, _isCurrent: true },
    ...siblings.map((s: any) => ({ ...s, _isCurrent: false })),
  ];

  let cumDays = 0;
  const dayPerStep = sequence.map((s: any, i: number) => {
    cumDays += i === 0 ? 0 : s.daysAfter;
    return cumDays;
  });

  // Stats
  const totalLeadsInGroup = allGroupCampaigns.length;
  const activeInGroup = allGroupCampaigns.filter(c => c.status === "active").length;
  const pausedInGroup = allGroupCampaigns.filter(c => c.status === "paused").length;
  const completedInGroup = allGroupCampaigns.filter(c => c.status === "completed").length;

  // Effective currentStep for the funnel = most-advanced active lead.
  // current_step is 0-indexed over sequence_steps (0 = nothing sent, 1 = 1st DM, etc.)
  const activeLeadSteps = allGroupCampaigns
    .filter(c => c.status === "active" || c.status === "paused")
    .map(c => Math.max(0, Math.min(c.current_step ?? 0, sequence.length)));
  const effectiveCurrentStep = activeLeadSteps.length > 0
    ? Math.max(...activeLeadSteps)
    : Math.min(campaign.current_step ?? 0, sequence.length);

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        <Link href="/campaigns" className="hover:underline flex items-center gap-1"><ArrowLeft size={12} /> Campaigns</Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{campaign.name}</span>
      </div>

      {/* ═══ CAMPAIGN HEADER ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Campaign</p>
            <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{campaign.name}</h1>
            <div className="flex items-center gap-3 mt-2">
              <div className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1" style={{ backgroundColor: st.bg }}>
                <StIcon size={13} style={{ color: st.color }} />
                <span className="text-xs font-semibold" style={{ color: st.color }}>{st.label}</span>
              </div>
              {channels.map(ch => {
                const meta = channelMeta[ch];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <span key={ch} className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md"
                    style={{ backgroundColor: `${meta.color}12`, color: meta.color }}>
                    <Icon size={11} /> {meta.label}
                  </span>
                );
              })}
              {campaign.started_at && (
                <span className="text-xs" style={{ color: C.textMuted }}>
                  <Clock size={11} className="inline mr-1" />
                  Started {new Date(campaign.started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              )}
            </div>
          </div>
          <Link href={`/campaigns/${id}/edit`}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: `${gold}15`, color: gold, border: `1px solid ${gold}30` }}>
            <Settings size={12} /> Edit Flow
          </Link>
        </div>

        <div className="border-t" style={{ borderColor: C.border }} />

        {/* Summary stats */}
        <div className="px-6 py-4 grid grid-cols-6 gap-4">
          {[
            { label: "Total Leads", value: totalLeadsInGroup, color: gold },
            { label: "Active", value: activeInGroup, color: C.green },
            { label: "Paused", value: pausedInGroup, color: "#D97706" },
            { label: "Completed", value: completedInGroup, color: C.textMuted },
            { label: "Progress", value: `${pct}%`, color: gold },
            { label: "Duration", value: `${totalSteps} steps · ${dayPerStep[dayPerStep.length - 1] ?? 0}d`, color: C.textBody },
          ].map(s => (
            <div key={s.label}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>{s.label}</p>
              <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ TABBED CONTENT (Client Component) ═══ */}
      <CampaignDetailClient
        campaignId={id}
        campaignName={campaign.name}
        campaignStatus={campaign.status}
        campaignIcpId={campaign.leads?.icp_profile_id ?? null}
        sellerName={campaign.sellers?.name ?? "Unassigned"}
        sequence={sequence}
        messages={messages}
        dayPerStep={dayPerStep}
        currentStep={effectiveCurrentStep}
        allCampaigns={JSON.parse(JSON.stringify(allGroupCampaigns))}
        leadGroups={JSON.parse(JSON.stringify(unlinkedLeads))}
        channels={channels}
        autoReplies={autoReplies}
        connectionNote={connectionNote}
        messageTemplates={messageTemplates}
      />
    </div>
  );
}
