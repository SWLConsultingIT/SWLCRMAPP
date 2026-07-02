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
import { getT } from "@/lib/i18n-server";

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

  const sellerFilterIds = sellerIds !== null
    ? (sellerIds.length > 0 ? sellerIds : ["00000000-0000-0000-0000-000000000000"])
    : null;

  // Outcome-driven lead set — NOT "the 500 newest leads". Won/Lost/Re-nurture
  // are about OUTCOMES, not recency, so capping at the most recent 500 silently
  // dropped any older lead the moment a tenant imported a fresh batch. Concrete
  // incident (2026-06-04): a lead marked Interested on a call vanished from Won
  // after 600 new leads were imported the same day — it fell past row 500.
  // Instead, gather the lead_ids that actually carry an outcome signal
  // (positive/negative reply, finished campaign, or Odoo transfer) and fetch
  // exactly those, with no recency cap. Tenant scope is enforced on the final
  // leads fetch (company_bio_id + seller_id), so signal rows that don't belong
  // to the viewer's scope simply return no lead and drop out.
  let repSigQ = supabase.from("lead_replies").select("lead_id, leads!inner(company_bio_id)").in("classification", ["positive", "meeting_intent", "negative"]);
  let campSigQ = supabase.from("campaigns").select("lead_id, leads!inner(company_bio_id)").in("status", ["completed", "failed"]);
  let odooSigQ = supabase.from("leads").select("id").not("transferred_to_odoo_at", "is", null);
  if (bioId) {
    repSigQ = repSigQ.eq("leads.company_bio_id", bioId);
    campSigQ = campSigQ.eq("leads.company_bio_id", bioId);
    odooSigQ = odooSigQ.eq("company_bio_id", bioId);
  }
  const profilesQ = supabase
    .from("icp_profiles")
    .select("id, profile_name")
    .eq("status", "approved");

  const [repSig, campSig, odooSig, { data: profiles }] = await Promise.all([
    repSigQ,
    campSigQ,
    odooSigQ,
    bioId ? profilesQ.eq("company_bio_id", bioId) : profilesQ,
  ]);

  const outcomeLeadIds = new Set<string>();
  for (const r of (repSig.data ?? []) as Array<{ lead_id?: string | null }>) if (r.lead_id) outcomeLeadIds.add(r.lead_id);
  for (const c of (campSig.data ?? []) as Array<{ lead_id?: string | null }>) if (c.lead_id) outcomeLeadIds.add(c.lead_id);
  for (const l of (odooSig.data ?? []) as Array<{ id?: string | null }>) if (l.id) outcomeLeadIds.add(l.id);
  const outcomeIds = [...outcomeLeadIds];

  // Fetch exactly the outcome leads (chunked — PostgREST .in lists get unwieldy
  // past a few hundred). Scope + seller filter applied here.
  const rawLeads: any[] = [];
  for (let i = 0; i < outcomeIds.length; i += 300) {
    let lq = supabase
      .from("leads")
      .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, is_priority, current_channel, icp_profile_id, created_at, source, encrypted_payload, company_bio_id, transferred_to_odoo_at, opportunity_stage")
      .in("id", outcomeIds.slice(i, i + 300));
    if (bioId) lq = lq.eq("company_bio_id", bioId);
    if (sellerFilterIds) lq = lq.in("seller_id", sellerFilterIds);
    const { data } = await lq;
    if (data) rawLeads.push(...data);
  }

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
      opportunity_stage: lead.opportunity_stage ?? null,
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

  // Lost vs Re-nurture: both start from the "completed/failed campaign OR
  // negative reply, no positive" pool. The split is whether the lead is
  // currently in a NEW campaign (re-nurture) or sitting cold (lost). Same
  // logic /leads used pre-2026-05-28 — moved here so /results is the home
  // for outcomes and Nurture leaves the in-flight chip row.
  const lostLeads: any[] = [];
  const renurturingLeads: any[] = [];
  for (const lead of (allLeads ?? []) as Array<Record<string, any>>) {
    const leadCamps = campsByLead[lead.id] ?? [];
    const leadReplies = repliesByLead[lead.id] ?? [];
    const hasPositive = leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
    if (hasPositive) continue;
    const hasCompletedCampaign = leadCamps.some((c: any) => c.status === "completed" || c.status === "failed");
    const hasNegativeReply = leadReplies.some((r: any) => r.classification === "negative");
    if (!hasCompletedCampaign && !hasNegativeReply) continue;
    const negReply = leadReplies.find((r: any) => r.classification === "negative");
    const pastCamps = leadCamps.filter((c: any) => c.status === "completed" || c.status === "failed");
    const channels = [...new Set(pastCamps.map((c: any) => c.channel))];
    const totalStepsDone = pastCamps.reduce((s: number, c: any) => s + (c.current_step ?? 0), 0);
    const totalStepsMax = pastCamps.reduce((s: number, c: any) => s + (Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0), 0);
    const mainCamp = pastCamps[0] ?? leadCamps[0];
    const baseData = {
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
    };
    const activeCamp = leadCamps.find((c: any) => c.status === "active" || c.status === "paused");
    if (activeCamp) {
      renurturingLeads.push({
        ...baseData,
        new_campaign_name: activeCamp.name ?? null,
        new_campaign_status: activeCamp.status,
        new_campaign_step: activeCamp.current_step ?? null,
        new_campaign_total_steps: Array.isArray(activeCamp.sequence_steps) ? activeCamp.sequence_steps.length : null,
      });
    } else {
      lostLeads.push(baseData);
    }
  }

  // Gruppo... no — Fase 1 del pipeline de resultados es SOLO para SWL Consulting.
  const SWL_BIO = "7c02e222-be59-416d-9434-acf4685f8590";
  return { wonLeads, lostLeads, renurturingLeads, isSwl: bioId === SWL_BIO };
}

export default async function ResultsPage() {
  const [{ wonLeads, lostLeads, renurturingLeads, isSwl }, t] = await Promise.all([
    getData(),
    getT(),
  ]);

  return (
    <div className="p-4 sm:p-6 w-full">
      <PageHero
        icon={Trophy}
        section={t("results.hero.preTitle")}
        title={t("results.hero.title")}
        description={t("results.hero.description")}
        accentColor={C.green}
        status={{ label: "Live", active: true }}
        stats={[
          { label: t("results.tab.won"),       value: wonLeads.length,         tone: wonLeads.length > 0 ? "positive" : "neutral" },
          { label: t("results.tab.lost"),      value: lostLeads.length,        tone: lostLeads.length > 0 ? "warning" : "neutral" },
          { label: t("results.tab.renurture"), value: renurturingLeads.length, tone: renurturingLeads.length > 0 ? "positive" : "neutral" },
        ]}
      />
      <ResultsClient
        wonLeads={JSON.parse(JSON.stringify(wonLeads))}
        lostLeads={JSON.parse(JSON.stringify(lostLeads))}
        renurturingLeads={JSON.parse(JSON.stringify(renurturingLeads))}
        isSwl={isSwl}
      />
    </div>
  );
}
