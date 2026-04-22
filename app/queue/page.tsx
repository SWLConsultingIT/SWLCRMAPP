import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import QueueClient from "./QueueClient";

async function getQueueData() {
  const supabase = await getSupabaseServer();

  // Resolve user scope
  const { data: { user } } = await supabase.auth.getUser();
  let userRole: string | null = null;
  let userCompanyBioId: string | null = null;

  if (user) {
    const svc = getSupabaseService();
    const { data: profile } = await svc
      .from("user_profiles")
      .select("role, company_bio_id")
      .eq("user_id", user.id)
      .single();
    userRole = profile?.role ?? null;
    userCompanyBioId = profile?.company_bio_id ?? null;
  }

  const isScoped = userRole !== "admin" && !!userCompanyBioId;
  const scopedCompanyBioId = isScoped ? userCompanyBioId! : null;

  // ICP profile IDs owned by this company (for request filtering)
  let scopedProfileIds: string[] | null = null;
  if (scopedCompanyBioId) {
    const svc = getSupabaseService();
    const { data: ps } = await svc.from("icp_profiles").select("id").eq("company_bio_id", scopedCompanyBioId);
    scopedProfileIds = (ps ?? []).map(p => p.id);
  }

  // Campaigns
  let campQuery = supabase.from("campaigns")
    .select("id, name, channel, current_step, sequence_steps, last_step_at, lead_id, aircall_number_id, leads!inner(primary_first_name, primary_last_name, company_name, primary_title_role, primary_phone, primary_work_email, company_bio_id)")
    .eq("status", "active")
    .order("last_step_at", { ascending: true })
    .limit(200);
  if (scopedCompanyBioId) campQuery = campQuery.eq("leads.company_bio_id", scopedCompanyBioId);

  // Replies
  let replyQuery = supabase.from("lead_replies")
    .select("id, classification, received_at, channel, reply_text, lead_id, campaign_id, requires_human_review, leads!inner(primary_first_name, primary_last_name, company_name, company_bio_id), campaigns(name)")
    .order("received_at", { ascending: false })
    .limit(30);
  if (scopedCompanyBioId) replyQuery = replyQuery.eq("leads.company_bio_id", scopedCompanyBioId);

  // Pending campaign requests
  let pendingCampQuery = supabase.from("campaign_requests")
    .select("id, name, target_leads_count, created_at, icp_profile_id")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });
  if (scopedProfileIds) pendingCampQuery = pendingCampQuery.in("icp_profile_id", scopedProfileIds.length > 0 ? scopedProfileIds : ["00000000-0000-0000-0000-000000000000"]);

  // Pending profiles
  let pendingProfQuery = supabase.from("icp_profiles")
    .select("id, profile_name, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (scopedCompanyBioId) pendingProfQuery = pendingProfQuery.eq("company_bio_id", scopedCompanyBioId);

  // Recent resolved requests (for Updates tab)
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  let resolvedCampQuery = supabase.from("campaign_requests")
    .select("id, name, status, created_at, target_leads_count, icp_profile_id")
    .in("status", ["approved", "rejected"])
    .gte("created_at", twoWeeksAgo)
    .order("created_at", { ascending: false })
    .limit(30);
  if (scopedProfileIds) resolvedCampQuery = resolvedCampQuery.in("icp_profile_id", scopedProfileIds.length > 0 ? scopedProfileIds : ["00000000-0000-0000-0000-000000000000"]);

  let resolvedProfQuery = supabase.from("icp_profiles")
    .select("id, profile_name, status, created_at")
    .in("status", ["approved", "rejected"])
    .gte("created_at", twoWeeksAgo)
    .order("created_at", { ascending: false })
    .limit(30);
  if (scopedCompanyBioId) resolvedProfQuery = resolvedProfQuery.eq("company_bio_id", scopedCompanyBioId);

  const [
    { data: activeCampaigns },
    { data: recentReplies },
    { data: pendingCampaigns },
    { data: pendingProfiles },
    { data: resolvedCamps },
    { data: resolvedProfs },
  ] = await Promise.all([campQuery, replyQuery, pendingCampQuery, pendingProfQuery, resolvedCampQuery, resolvedProfQuery]);

  // Pending Calls
  const now = Date.now();
  const pendingCalls: any[] = [];
  for (const c of activeCampaigns ?? []) {
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    const currentStepIdx = c.current_step ?? 0;
    if (steps[currentStepIdx]?.channel === "call") {
      const lead = c.leads as any;
      const leadName = lead ? `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown" : "Unknown";
      const daysAfter = steps[currentStepIdx]?.daysAfter ?? 0;
      const dueAt = c.last_step_at ? new Date(c.last_step_at).getTime() + daysAfter * 86400000 : null;
      const isOverdue = dueAt !== null && now > dueAt;
      const overdueDays = isOverdue && dueAt ? Math.floor((now - dueAt) / 86400000) : 0;

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
        isOverdue,
        overdueDays,
        aircallNumberId: (c as any).aircall_number_id ?? null,
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
      requiresHumanReview: r.requires_human_review ?? false,
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

  // Updates (approved / rejected recent)
  const updates = [
    ...(resolvedCamps ?? []).map(r => ({
      id: `camp-${r.id}`,
      kind: "campaign" as const,
      name: r.name,
      status: r.status as "approved" | "rejected",
      subtitle: `${r.target_leads_count} ${r.target_leads_count === 1 ? "lead" : "leads"} targeted`,
      createdAt: r.created_at,
      href: "/campaigns",
    })),
    ...(resolvedProfs ?? []).map(p => ({
      id: `prof-${p.id}`,
      kind: "profile" as const,
      name: p.profile_name,
      status: p.status as "approved" | "rejected",
      subtitle: "ICP profile",
      createdAt: p.created_at,
      href: "/icp",
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { pendingCalls, newReplies, pendingReviews, updates };
}

export default async function QueuePage() {
  const data = await getQueueData();
  return <QueueClient {...JSON.parse(JSON.stringify(data))} />;
}
