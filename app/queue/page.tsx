import { supabase } from "@/lib/supabase";
import QueueClient from "./QueueClient";

async function getQueueData() {
  const [
    { data: activeCampaigns },
    { data: recentReplies },
    { data: pendingCampaigns },
    { data: pendingProfiles },
  ] = await Promise.all([
    supabase.from("campaigns")
      .select("id, name, channel, current_step, sequence_steps, last_step_at, lead_id, leads(primary_first_name, primary_last_name, company_name, primary_title_role, primary_phone, primary_work_email)")
      .eq("status", "active")
      .order("last_step_at", { ascending: true })
      .limit(200),
    // New Replies: last 30 replies regardless of review status
    supabase.from("lead_replies")
      .select("id, classification, received_at, channel, reply_text, lead_id, campaign_id, leads(primary_first_name, primary_last_name, company_name), campaigns(name)")
      .order("received_at", { ascending: false })
      .limit(30),
    supabase.from("campaign_requests")
      .select("id, name, target_leads_count, created_at")
      .eq("status", "pending_review")
      .order("created_at", { ascending: true }),
    supabase.from("icp_profiles")
      .select("id, profile_name, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  // Pending Calls
  const pendingCalls: any[] = [];
  for (const c of activeCampaigns ?? []) {
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    const currentStepIdx = c.current_step ?? 0;
    if (steps[currentStepIdx]?.channel === "call") {
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

  // New Replies
  const newReplies = (recentReplies ?? []).map((r: any) => {
    const lead = r.leads;
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

  // Pending Reviews
  const pendingReviews = [
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

  return { pendingCalls, newReplies, pendingReviews };
}

export default async function QueuePage() {
  const data = await getQueueData();
  return <QueueClient {...JSON.parse(JSON.stringify(data))} />;
}
