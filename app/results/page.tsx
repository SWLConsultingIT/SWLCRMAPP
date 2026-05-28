import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope, getMyAssignedSellerIds } from "@/lib/scope";
import {
  resolveTenantKey,
  decryptWithResolvedKey,
  bufferFromSupabaseBytea,
  ENCRYPTED_LEAD_COLUMNS,
} from "@/lib/leads-crypto";
import { C } from "@/lib/design";
import { Trophy } from "lucide-react";
import PageHero from "@/components/PageHero";
import ResultsClient from "./ResultsClient";

// Tenant-scoped + auth-gated → never static. Skip the optimization attempt.
export const dynamic = "force-dynamic";

// Won + Lost lives outside /leads now (boss feedback 2026-05-28: "los results
// están muy escondidos" hidden as a chip alongside in-flight statuses).
// Promoting outcomes to a dedicated Growth-section page makes them findable
// for the boss-level "did we close anything this week" question, and lets the
// /leads chip row stay focused on in-flight pipeline states.
async function getData() {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;
  const sellerIds = await getMyAssignedSellerIds();

  let leadsQ = supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, is_priority, current_channel, icp_profile_id, created_at, source, encrypted_payload, company_bio_id, transferred_to_odoo_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (sellerIds !== null) {
    const ids = sellerIds.length > 0 ? sellerIds : ["00000000-0000-0000-0000-000000000000"];
    leadsQ = leadsQ.in("seller_id", ids);
  }

  const profilesQ = supabase
    .from("icp_profiles")
    .select("id, profile_name")
    .eq("status", "approved");

  const [{ data: rawLeads }, { data: profiles }] = await Promise.all([
    bioId ? leadsQ.eq("company_bio_id", bioId) : leadsQ,
    bioId ? profilesQ.eq("company_bio_id", bioId) : profilesQ,
  ]);

  // Decrypt the same way /leads does. Without this, client-source tenants
  // (De Vera, Everest, etc) get "Unknown" rows in the Won/Lost cards.
  const allLeads = await (async () => {
    if (!rawLeads || rawLeads.length === 0) return rawLeads ?? [];
    const clientLeads = rawLeads.filter((l: { source?: string | null }) => l.source === "client");
    if (clientLeads.length === 0) return rawLeads;
    if (bioId) {
      try {
        const { key } = await resolveTenantKey(bioId);
        return rawLeads.map((l: Record<string, unknown>) => {
          if (l.source !== "client" || !l.encrypted_payload) return l;
          try {
            const blob = bufferFromSupabaseBytea(l.encrypted_payload);
            const decrypted = decryptWithResolvedKey(blob, key);
            return { ...l, ...decrypted, encrypted_payload: undefined };
          } catch {
            return l;
          }
        });
      } catch {
        return rawLeads;
      }
    }
    return rawLeads.map((l: Record<string, unknown>) => {
      if (l.source !== "client") return l;
      const out: Record<string, unknown> = { ...l, encrypted_payload: undefined };
      for (const col of ENCRYPTED_LEAD_COLUMNS) out[col] = null;
      return out;
    });
  })();

  const icpMap: Record<string, { profile_name: string }> = {};
  for (const p of profiles ?? []) icpMap[p.id] = p as { profile_name: string };

  const leadIds = (allLeads ?? []).map(l => l.id);

  // Pull replies + campaigns for outcome derivation (same shape /leads uses).
  const [{ data: replies }, { data: campaigns }] = await Promise.all([
    leadIds.length > 0
      ? supabase.from("lead_replies").select("lead_id, classification, received_at, channel, reply_text").in("lead_id", leadIds).order("received_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    leadIds.length > 0
      ? supabase.from("campaigns").select("id, name, channel, current_step, sequence_steps, status, lead_id").in("lead_id", leadIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const repliesByLead: Record<string, any[]> = {};
  for (const r of replies ?? []) {
    if (!repliesByLead[r.lead_id]) repliesByLead[r.lead_id] = [];
    repliesByLead[r.lead_id].push(r);
  }
  const campsByLead: Record<string, any[]> = {};
  for (const c of campaigns ?? []) {
    if (!c.lead_id) continue;
    if (!campsByLead[c.lead_id]) campsByLead[c.lead_id] = [];
    campsByLead[c.lead_id].push(c);
  }

  // Won = positive reply OR transferred to Odoo. Mirror of /leads logic so
  // outcomes don't drift between surfaces.
  const wonLeads: any[] = [];
  for (const lead of (allLeads ?? []) as Array<Record<string, any>>) {
    const leadReplies = repliesByLead[lead.id] ?? [];
    const positiveReply = leadReplies.find(r => r.classification === "positive" || r.classification === "meeting_intent");
    const isOdoo = !!lead.transferred_to_odoo_at;
    if (!positiveReply && !isOdoo) continue;
    const camp = (campaigns ?? []).find((c: any) => c.lead_id === lead.id);
    const steps = Array.isArray(camp?.sequence_steps) ? camp.sequence_steps.length : 0;
    const channels = camp ? [...new Set([camp.channel, ...(Array.isArray(camp.sequence_steps) ? camp.sequence_steps.map((s: any) => s.channel) : [])])].filter(Boolean) : (positiveReply?.channel ? [positiveReply.channel] : []);
    const daysToConvert = positiveReply?.received_at && lead.created_at
      ? Math.max(1, Math.round((new Date(positiveReply.received_at).getTime() - new Date(lead.created_at).getTime()) / 86400000))
      : null;
    wonLeads.push({
      id: lead.id,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      score: lead.lead_score,
      is_priority: !!lead.is_priority,
      transferred: isOdoo,
      profile_name: lead.icp_profile_id ? (icpMap[lead.icp_profile_id]?.profile_name ?? null) : null,
      campaign_name: camp?.name ?? null,
      campaign_id: camp?.id ?? null,
      win_channel: positiveReply?.channel ?? camp?.channel ?? null,
      win_text: positiveReply?.reply_text ?? null,
      win_classification: positiveReply?.classification ?? "positive",
      win_date: positiveReply?.received_at ?? null,
      channels,
      steps_to_convert: camp?.current_step ?? 0,
      total_steps: steps,
      days_to_convert: daysToConvert,
    });
  }
  wonLeads.sort((a, b) => {
    if (a.win_date && b.win_date) return new Date(b.win_date).getTime() - new Date(a.win_date).getTime();
    if (a.win_date) return -1;
    if (b.win_date) return 1;
    return 0;
  });

  // Lost = completed/failed campaign or explicit negative reply, no positive,
  // AND no currently-active campaign on the lead (re-nurturing isn't "lost").
  const lostLeads: any[] = [];
  for (const lead of (allLeads ?? []) as Array<Record<string, any>>) {
    const leadCamps = campsByLead[lead.id] ?? [];
    const leadReplies = repliesByLead[lead.id] ?? [];
    const hasPositive = leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
    if (hasPositive) continue;
    const hasCompletedCampaign = leadCamps.some((c: any) => c.status === "completed" || c.status === "failed");
    const hasNegativeReply = leadReplies.some((r: any) => r.classification === "negative");
    if (!hasCompletedCampaign && !hasNegativeReply) continue;
    const hasActiveCamp = leadCamps.some((c: any) => c.status === "active" || c.status === "paused");
    if (hasActiveCamp) continue;
    const negReply = leadReplies.find((r: any) => r.classification === "negative");
    const pastCamps = leadCamps.filter((c: any) => c.status === "completed" || c.status === "failed");
    const channels = [...new Set(pastCamps.map((c: any) => c.channel))];
    const totalStepsDone = pastCamps.reduce((s: number, c: any) => s + (c.current_step ?? 0), 0);
    const totalStepsMax = pastCamps.reduce((s: number, c: any) => s + (Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0), 0);
    const mainCamp = pastCamps[0] ?? leadCamps[0];
    lostLeads.push({
      id: lead.id,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      email: lead.primary_work_email,
      score: lead.lead_score,
      is_priority: !!lead.is_priority,
      profile_name: lead.icp_profile_id ? (icpMap[lead.icp_profile_id]?.profile_name ?? null) : null,
      reason: (hasNegativeReply ? "negative" : "no_reply") as "negative" | "no_reply",
      reply_text: negReply?.reply_text ?? null,
      reply_date: negReply?.received_at ?? null,
      campaign_name: mainCamp?.name ?? null,
      channels,
      steps_completed: totalStepsDone,
      steps_total: totalStepsMax,
      messages_sent: 0,
    });
  }

  return { wonLeads, lostLeads };
}

export default async function ResultsPage() {
  const { wonLeads, lostLeads } = await getData();

  return (
    <div className="p-4 sm:p-6 w-full">
      <PageHero
        icon={Trophy}
        section="Growth Engine"
        title="Results"
        description="Outcomes from the pipeline — wins this period and the leads that didn't close."
        accentColor={C.green}
        status={{ label: "Live", active: true }}
        stats={[
          { label: "Won", value: wonLeads.length, tone: wonLeads.length > 0 ? "positive" : "neutral" },
          { label: "Lost", value: lostLeads.length, tone: lostLeads.length > 0 ? "warning" : "neutral" },
        ]}
      />
      <ResultsClient
        wonLeads={JSON.parse(JSON.stringify(wonLeads))}
        lostLeads={JSON.parse(JSON.stringify(lostLeads))}
      />
    </div>
  );
}
