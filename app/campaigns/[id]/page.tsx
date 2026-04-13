import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, PlayCircle, PauseCircle, CheckCircle, XCircle,
  Users, Clock,
} from "lucide-react";
import CampaignDetailClient from "./CampaignDetailClient";

const gold = "#C9A83A";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: C.linkedin, label: "LinkedIn" },
  email:    { icon: Mail,   color: C.email,    label: "Email" },
  whatsapp: { icon: Mail,   color: "#22c55e",  label: "WhatsApp" },
  call:     { icon: Phone,  color: C.phone,    label: "Call" },
};

const statusMeta: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  active:    { label: "Active",    color: C.green,    bg: C.greenLight,  icon: PlayCircle },
  paused:    { label: "Paused",    color: "#D97706",  bg: "#FFFBEB",     icon: PauseCircle },
  completed: { label: "Completed", color: C.textMuted, bg: "#F3F4F6",    icon: CheckCircle },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight,    icon: XCircle },
};

async function getCampaign(id: string) {
  const { data } = await supabase
    .from("campaigns")
    .select("*, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, company_industry), sellers(name)")
    .eq("id", id)
    .single();
  return data;
}

async function getMessages(campaignId: string) {
  const { data } = await supabase
    .from("campaign_messages")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("step_number", { ascending: true });
  return data ?? [];
}

async function getSiblingCampaigns(campaignName: string, excludeId: string) {
  const { data } = await supabase
    .from("campaigns")
    .select("id, status, current_step, sequence_steps, leads(id, primary_first_name, primary_last_name, company_name)")
    .eq("name", campaignName)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const [messages, siblings] = await Promise.all([
    getMessages(id),
    getSiblingCampaigns(campaign.name, id),
  ]);

  // Get replies for this lead
  const { data: replies } = await supabase
    .from("lead_replies")
    .select("*")
    .eq("lead_id", campaign.lead_id)
    .order("received_at", { ascending: true });

  // Get auto-replies from campaign request
  const { data: campRequest } = await supabase
    .from("campaign_requests")
    .select("message_prompts")
    .eq("name", campaign.name)
    .limit(1)
    .single();
  const autoReplies = campRequest?.message_prompts?.channelMessages?.autoReplies ?? {};

  const sequence: { channel: string; daysAfter: number }[] = campaign.sequence_steps ?? [];
  const channels = [...new Set(sequence.map((s: any) => s.channel))];
  const totalSteps = sequence.length;
  const pct = totalSteps > 0 ? Math.round((campaign.current_step / totalSteps) * 100) : 0;
  const st = statusMeta[campaign.status] ?? statusMeta.active;
  const StIcon = st.icon;
  const leadName = `${campaign.leads?.primary_first_name ?? ""} ${campaign.leads?.primary_last_name ?? ""}`.trim() || "Unknown";

  // Calculate cumulative days
  let cumDays = 0;
  const dayPerStep = sequence.map((s: any, i: number) => {
    cumDays += i === 0 ? 0 : s.daysAfter;
    return cumDays;
  });

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
            </div>
          </div>
          <div className="text-right">
            {campaign.started_at && (
              <p className="text-xs" style={{ color: C.textMuted }}>
                <Clock size={11} className="inline mr-1" />
                Started {new Date(campaign.started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            )}
          </div>
        </div>

        <div className="border-t" style={{ borderColor: C.border }} />

        {/* Metrics */}
        <div className="px-6 py-4 grid grid-cols-5 gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Lead</p>
            <Link href={`/leads/${campaign.leads?.id}`} className="text-sm font-bold hover:underline" style={{ color: C.textPrimary }}>
              {leadName}
            </Link>
            <p className="text-xs" style={{ color: C.textMuted }}>{campaign.leads?.company_name}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Role</p>
            <p className="text-sm font-medium" style={{ color: C.textBody }}>{campaign.leads?.primary_title_role ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Progress</p>
            <div className="flex items-center gap-2">
              <div className="w-20 h-2 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? C.textDim : `linear-gradient(90deg, ${gold}, #e8c84a)` }} />
              </div>
              <span className="text-sm font-bold tabular-nums" style={{ color: C.textPrimary }}>{campaign.current_step}/{totalSteps}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Seller</p>
            <p className="text-sm font-medium" style={{ color: C.textBody }}>{campaign.sellers?.name ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Duration</p>
            <p className="text-sm font-medium" style={{ color: C.textBody }}>{totalSteps} steps · ~{dayPerStep[dayPerStep.length - 1] ?? 0} days</p>
          </div>
        </div>
      </div>

      {/* ═══ SEQUENCE + MESSAGES (Client Component) ═══ */}
      <CampaignDetailClient
        campaignId={id}
        campaignStatus={campaign.status}
        sequence={sequence}
        messages={messages}
        dayPerStep={dayPerStep}
        currentStep={campaign.current_step}
        replies={replies ?? []}
        autoReplies={autoReplies}
        leadName={leadName}
      />

      {/* ═══ OTHER LEADS IN SAME CAMPAIGN ═══ */}
      {siblings.length > 0 && (
        <div className="rounded-xl border overflow-hidden mt-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="px-6 py-4 flex items-center gap-2 border-b" style={{ borderColor: C.border }}>
            <Users size={14} style={{ color: C.textMuted }} />
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Other Leads in this Campaign</h2>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${gold}15`, color: gold }}>
              {siblings.length}
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: C.border }}>
            {siblings.map((s: any) => {
              const sst = statusMeta[s.status] ?? statusMeta.active;
              const SIcon = sst.icon;
              const sName = `${s.leads?.primary_first_name ?? ""} ${s.leads?.primary_last_name ?? ""}`.trim() || "Unknown";
              const sTotal = s.sequence_steps?.length ?? 0;
              const sPct = sTotal > 0 ? Math.round((s.current_step / sTotal) * 100) : 0;
              return (
                <Link key={s.id} href={`/campaigns/${s.id}`} className="flex items-center gap-4 px-6 py-3 table-row-hover">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{sName}</p>
                    <p className="text-xs" style={{ color: C.textMuted }}>{s.leads?.company_name}</p>
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-md px-2 py-0.5" style={{ backgroundColor: sst.bg }}>
                    <SIcon size={10} style={{ color: sst.color }} />
                    <span className="text-xs font-semibold" style={{ color: sst.color }}>{sst.label}</span>
                  </div>
                  <div className="flex items-center gap-2 w-24">
                    <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                      <div className="h-1.5 rounded-full" style={{ width: `${sPct}%`, background: `linear-gradient(90deg, ${gold}, #e8c84a)` }} />
                    </div>
                    <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>{s.current_step}/{sTotal}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
