// Lead picker — first step of new-flow creation. Boss feedback 2026-05-28:
// before landing in the wizard, the seller must explicitly choose which
// leads (from the chosen ICP, leads without an active flow) go into the
// new campaign. Selected ids forward to /campaigns/new/[profileId]?leads=...
// where the wizard reads them out of searchParams.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import { ArrowLeft } from "lucide-react";
import { C } from "@/lib/design";
import PickLeadsClient, { type PickableLead } from "./PickLeadsClient";

async function loadPickerData(profileId: string) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const { data: profile } = await supabase
    .from("icp_profiles")
    .select("id, profile_name, company_bio_id, target_industries, target_roles")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return null;
  // Tenant scope — non super-admin can only pick from their own ICP.
  if (bioId && profile.company_bio_id !== bioId) return null;

  // Leads of this ICP that are NOT currently in an active/paused flow.
  // `lead_id` from campaigns gives us the "in flight" set; we subtract.
  // We fetch leads first so we can scope the campaigns check to only these lead
  // IDs — a global `.in("status", [...])` without a lead_id filter hits the
  // default 1000-row cap once all tenants' active campaigns exceed it, silently
  // truncating the enrolled set and letting already-enrolled leads reappear as
  // "eligible".
  const { data: rawLeads } = await supabase
    .from("leads")
    .select("id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, lead_score, allow_linkedin, allow_email, allow_call, icp_profile_id")
    .eq("icp_profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(500);
  const allLeadIds = (rawLeads ?? []).map(r => r.id).filter(Boolean) as string[];

  // Two separate queries to avoid the 1000-row Supabase cap.
  // Combining active+closed in one query inflates the result set and can
  // silently drop active campaigns from the page, letting enrolled leads
  // reappear as eligible.
  type CampaignRow = { lead_id: string | null; status: string; stop_reason: string | null; updated_at: string };
  const inFlight = new Set<string>();
  const lastCampaignMap = new Map<string, CampaignRow>();

  for (let i = 0; i < allLeadIds.length; i += 300) {
    const chunk = allLeadIds.slice(i, i + 300);

    // Query 1 — active/paused: small result set, no cap risk.
    const { data: activeData } = await supabase
      .from("campaigns")
      .select("lead_id")
      .in("lead_id", chunk)
      .in("status", ["active", "paused"]);
    (activeData ?? []).forEach(r => { if (r.lead_id) inFlight.add(r.lead_id); });

    // Query 2 — closed/completed: build history map (latest campaign per lead).
    // "completed" = ran all steps with no reply/close → renurture.
    const { data: closedData } = await supabase
      .from("campaigns")
      .select("lead_id, status, stop_reason, updated_at")
      .in("lead_id", chunk)
      .in("status", ["closed_won", "closed_lost", "completed"]);
    (closedData ?? []).forEach(r => {
      if (!r.lead_id) return;
      const existing = lastCampaignMap.get(r.lead_id);
      if (!existing || r.updated_at > existing.updated_at) {
        lastCampaignMap.set(r.lead_id, r as CampaignRow);
      }
    });
  }

  function classifyHistory(leadId: string): "new" | "renurture" | "lost" | "won" {
    const h = lastCampaignMap.get(leadId);
    if (!h) return "new";
    if (h.status === "closed_won") return "won";
    if (h.status === "completed") return "renurture";
    // closed_lost: stop_reason=null → sequence ran out with no reply → renurture.
    // Any explicit stop_reason (lead_closed_lost, call_negative, etc.) → lost.
    if (!h.stop_reason) return "renurture";
    return "lost";
  }
  const hydrated = (await hydrateClientLeads((rawLeads ?? []) as Record<string, unknown>[])) as Array<Record<string, unknown> & { id: string }>;
  const eligible: PickableLead[] = hydrated
    .filter(l => !inFlight.has(l.id))
    .map(l => ({
      id: l.id,
      first_name: (l.primary_first_name as string | null) ?? null,
      last_name: (l.primary_last_name as string | null) ?? null,
      company_name: (l.company_name as string | null) ?? null,
      role: (l.primary_title_role as string | null) ?? null,
      lead_score: (l.lead_score as number | null) ?? null,
      industry: (l.company_industry as string | null | undefined) ?? null,
      country: (l.company_country as string | null | undefined) ?? null,
      allow_linkedin: Boolean(l.allow_linkedin),
      allow_email: Boolean(l.allow_email),
      allow_call: Boolean(l.allow_call),
      history: classifyHistory(l.id),
    }));

  return {
    profile: {
      id: profile.id as string,
      name: (profile.profile_name as string | null) ?? "Lead Miner Profile",
    },
    leads: eligible,
  };
}

export default async function PickLeadsPage({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  const data = await loadPickerData(profileId);
  if (!data) notFound();

  return (
    <div className="p-4 sm:p-6 w-full">
      <div className="mb-4 flex items-center gap-2 text-xs" style={{ color: C.textMuted }}>
        <Link href="/campaigns" className="hover:underline flex items-center gap-1">
          <ArrowLeft size={12} /> Outreach Flow
        </Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{data.profile.name}</span>
        <span>/</span>
        <span style={{ color: C.textBody }}>Select leads</span>
      </div>

      <PickLeadsClient
        profileId={data.profile.id}
        profileName={data.profile.name}
        leads={data.leads}
      />
    </div>
  );
}
