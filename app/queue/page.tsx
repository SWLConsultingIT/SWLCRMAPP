import { supabase } from "@/lib/supabase";
import QueueClient from "./QueueClient";

export type PendingCall = {
  id: string;
  campaignId: string;
  campaignName: string;
  currentStep: number;
  totalSteps: number;
  leadId: string | null;
  leadName: string;
  company: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  lastStepAt: string | null;
};

export type ReplyReview = {
  id: string;
  leadId: string;
  leadName: string;
  company: string | null;
  channel: string;
  classification: string | null;
  replyText: string | null;
  receivedAt: string;
  campaignName: string | null;
};

export type PendingReview = {
  id: string;
  type: "campaign" | "profile";
  name: string;
  subtitle: string;
  createdAt: string;
  href: string;
};

async function getQueueData() {
  const [
    { data: activeCampaigns },
    { data: pendingReplies },
    { data: pendingCampaigns },
    { data: pendingProfiles },
  ] = await Promise.all([
    // Active campaigns — we'll filter for call steps client-side
    supabase
      .from("campaigns")
      .select("id, name, channel, current_step, sequence_steps, last_step_at, lead_id, leads(primary_first_name, primary_last_name, company_name, primary_title_role, primary_phone, primary_work_email)")
      .eq("status", "active")
      .order("last_step_at", { ascending: true })
      .limit(200),
    supabase
      .from("lead_replies")
      .select("id, classification, received_at, channel, reply_text, lead_id, campaign_id, leads(primary_first_name, primary_last_name, company_name), campaigns(name)")
      .eq("requires_human_review", true)
      .eq("review_status", "pending")
      .order("received_at", { ascending: true })
      .limit(50),
    supabase
      .from("campaign_requests")
      .select("id, name, target_leads_count, created_at")
      .eq("status", "pending_review")
      .order("created_at", { ascending: true }),
    supabase
      .from("icp_profiles")
      .select("id, profile_name, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  // Pending Calls: active campaigns where the CURRENT step is a "call" channel
  const pendingCalls: PendingCall[] = [];
  for (const c of activeCampaigns ?? []) {
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    const currentStepIdx = c.current_step ?? 0;
    const currentStepDef = steps[currentStepIdx];
    if (currentStepDef?.channel === "call") {
      const lead = c.leads as any;
      const leadName = lead ? `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown" : "Unknown";
      pendingCalls.push({
        id: c.id,
        campaignId: c.id,
        campaignName: c.name,
        currentStep: currentStepIdx,
        totalSteps: steps.length,
        leadId: c.lead_id,
        leadName,
        company: lead?.company_name ?? null,
        role: lead?.primary_title_role ?? null,
        phone: lead?.primary_phone ?? null,
        email: lead?.primary_work_email ?? null,
        lastStepAt: c.last_step_at,
      });
    }
  }

  const replyReviews: ReplyReview[] = (pendingReplies ?? []).map(r => {
    const lead = r.leads as any;
    const leadName = lead ? `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown" : "Unknown";
    return {
      id: r.id,
      leadId: r.lead_id,
      leadName,
      company: lead?.company_name ?? null,
      channel: r.channel ?? "unknown",
      classification: r.classification,
      replyText: r.reply_text,
      receivedAt: r.received_at,
      campaignName: (r.campaigns as any)?.name ?? null,
    };
  });

  const pendingReviews: PendingReview[] = [
    ...(pendingCampaigns ?? []).map(req => ({
      id: `camp-${req.id}`,
      type: "campaign" as const,
      name: req.name,
      subtitle: `${req.target_leads_count} ${req.target_leads_count === 1 ? "lead" : "leads"} targeted`,
      createdAt: req.created_at,
      href: "/campaigns",
    })),
    ...(pendingProfiles ?? []).map(p => ({
      id: `prof-${p.id}`,
      type: "profile" as const,
      name: p.profile_name,
      subtitle: "ICP profile awaiting approval",
      createdAt: p.created_at,
      href: "/icp",
    })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return { pendingCalls, replyReviews, pendingReviews };
}

export default async function QueuePage() {
  const data = await getQueueData();
  return <QueueClient {...JSON.parse(JSON.stringify(data))} />;
}
