import { getSupabaseServer } from "@/lib/supabase-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import { selectByIds } from "@/lib/supabase-bulk";
import { ACTIVITY_SELECT, bucketActivity } from "@/lib/activities";
import { C } from "@/lib/design";
import { getT, getServerLocale } from "@/lib/i18n-server";
import { intlTag } from "@/lib/i18n-locale";
import { countryToTimeZone } from "@/lib/prospect-time";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import CompanyTabs from "@/components/CompanyTabs";
import CompanyHero from "@/components/company/CompanyHero";
import AccountIntelligence from "@/components/company/AccountIntelligence";
import CompanyOverview from "@/components/company/CompanyOverview";
import CompanyContacts, { type ContactRow } from "@/components/company/CompanyContacts";
import CompanyEngagement, { type CampaignRollup } from "@/components/company/CompanyEngagement";
import CompanyResearch from "@/components/company/CompanyResearch";
import type { TimelineEvent } from "@/components/lead/LeadTimeline";

export const dynamic = "force-dynamic";

const gold = "var(--brand, #c9a83a)";

// ── Data ──
// Encrypted tenants keep company_name inside encrypted_payload, so we fetch the
// plaintext match + the tenant's encrypted rows and merge (RLS scopes both).
async function getCompanyLeads(companyName: string) {
  const supabase = await getSupabaseServer();
  const [{ data: plain }, { data: enc }] = await Promise.all([
    supabase.from("leads").select("*").eq("company_name", companyName).limit(2000),
    supabase.from("leads").select("*").eq("source", "client").not("encrypted_payload", "is", null).limit(2000),
  ]);
  const hydratedEnc = await hydrateClientLeads((enc ?? []) as any);
  const byId = new Map<string, any>();
  for (const l of (plain ?? []) as any[]) byId.set(l.id, l);
  for (const l of hydratedEnc as any[]) { if (l.company_name === companyName) byId.set(l.id, l); }
  // Sort by score desc so the representative row (company-level fields, hooks)
  // is the strongest lead, not an arbitrary first row.
  return [...byId.values()].sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0));
}

async function getAngleContext(icpId: string | null, bioId: string | null) {
  const s = await getSupabaseServer();
  const [icpRes, bioRes] = await Promise.all([
    icpId ? s.from("icp_profiles").select("profile_name, solutions_offered, pain_points").eq("id", icpId).maybeSingle() : Promise.resolve({ data: null } as any),
    bioId ? s.from("company_bios").select("main_services, value_proposition").eq("id", bioId).maybeSingle() : Promise.resolve({ data: null } as any),
  ]);
  return { icp: icpRes.data as any, bio: bioRes.data as any };
}

// A failed batch read must NOT take down the whole account page — degrade that
// one section to empty and log it (Fran 2026-09-11: /companies 500'd in prod).
async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch (e) { console.error("[company] batch read failed:", (e as any)?.message ?? e); return []; }
}

// Calls via the service key + REST (same as the lead page) — the calls table
// has no company_bio_id and isn't reliably readable through the RLS user
// client here; the ids are already tenant-scoped (from getCompanyLeads), so
// this stays tenant-safe.
async function getCompanyCalls(ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  const key = process.env.SUPABASE_SERVICE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return [];
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    try {
      const res = await fetch(`${url}/rest/v1/calls?lead_id=in.(${chunk.join(",")})&order=started_at.desc&select=id,lead_id,started_at,duration,classification,ai_summary,notes,aircall_call_id`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
      const data = await res.json().catch(() => []);
      if (Array.isArray(data)) out.push(...data);
    } catch (e) { console.error("[company] calls read failed:", (e as any)?.message ?? e); }
  }
  return out;
}

// ── Helpers ──
const STATUS_COLOR: Record<string, string> = {
  new: C.blue, contacted: C.orange, connected: C.accent, responded: C.green,
  qualified: C.green, proposal_sent: C.accent, closed_won: C.green, closed_lost: C.red, nurturing: C.textMuted,
};
const statusColor = (s: string) => STATUS_COLOR[s] ?? C.textMuted;

function isValidLinkedInUrl(url?: string | null): boolean {
  if (!url) return false;
  try { const u = new URL(url); return /(^|\.)linkedin\.com$/i.test(u.hostname) && /\/in\//.test(u.pathname); } catch { return false; }
}
function urlify(v: string | null | undefined): string | null {
  if (!v) return null;
  return String(v).startsWith("http") ? String(v) : `https://${v}`;
}
function fmtRel(iso: string | null, tag: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(tag, { day: "numeric", month: "short" });
}

export default async function CompanyDetailPage({ params, searchParams }: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ fromLead?: string; tab?: string }>;
}) {
  const [{ name }, sp, t, locale] = await Promise.all([params, searchParams, getT(), getServerLocale()]);
  const companyName = decodeURIComponent(name);
  const tag = intlTag(locale);

  const allContacts = await getCompanyLeads(companyName);
  if (!allContacts.length) notFound();
  const lead = allContacts[0] as any;
  const bioId = lead.company_bio_id ?? null;
  const contactIds: string[] = allContacts.map((c: any) => c.id);
  const nameOf = (id: string) => {
    const c = allContacts.find((x: any) => x.id === id);
    return c ? (`${c.primary_first_name ?? ""} ${c.primary_last_name ?? ""}`.trim() || c.company_name || "Unknown") : "Unknown";
  };

  // Return-to-lead: only honour ?fromLead when it's one of THIS company's
  // contacts the viewer can see (RLS already scoped allContacts to the tenant),
  // so no cross-tenant / cross-company back-link is ever shown.
  const fromLeadId = sp.fromLead && contactIds.includes(sp.fromLead) ? sp.fromLead : null;
  const fromLeadName = fromLeadId ? nameOf(fromLeadId) : null;

  const supabase = await getSupabaseServer();

  // Batched, chunked+paged reads (no N+1, no 1000-row truncation). Each read is
  // fault-isolated: one failing table degrades its own section, never 500s.
  const [activities, messages, replies, calls, campaigns, angle] = await Promise.all([
    safe(selectByIds<any>("activities", contactIds, (chunk) =>
      supabase.from("activities").select(ACTIVITY_SELECT).in("lead_id", chunk).order("due_at", { ascending: true, nullsFirst: false }) as any)),
    safe(selectByIds<any>("campaign_messages", contactIds, (chunk) =>
      supabase.from("campaign_messages").select("id, campaign_id, lead_id, channel, content, status, sent_at").in("lead_id", chunk).eq("status", "sent").order("sent_at", { ascending: false }) as any)),
    safe(selectByIds<any>("lead_replies", contactIds, (chunk) =>
      supabase.from("lead_replies").select("id, lead_id, campaign_id, channel, reply_text, received_at, classification").in("lead_id", chunk).order("received_at", { ascending: false }) as any)),
    getCompanyCalls(contactIds),
    safe(selectByIds<any>("campaigns", contactIds, (chunk) =>
      supabase.from("campaigns").select("id, lead_id, name, channel, status, started_at, sellers(name)").in("lead_id", chunk).order("started_at", { ascending: false }) as any)),
    getAngleContext(lead.icp_profile_id ?? null, bioId).catch(() => ({ icp: null, bio: null })),
  ]);

  const visibleCalls = calls.filter((c: any) => c.aircall_call_id != null || c.classification != null);
  const positive = replies.filter((r: any) => ["positive", "meeting_intent"].includes(r.classification ?? "")).length;

  // Per-contact grouping (single JS pass each — no per-contact query).
  const nextByLead = new Map<string, any>();
  for (const a of activities) { // activities already ordered by due_at asc
    if (a.status !== "pending") continue;
    if (!nextByLead.has(a.lead_id)) nextByLead.set(a.lead_id, a);
  }
  const lastByLead = new Map<string, number>();
  const bump = (id: string | null, iso: string | null) => {
    if (!id || !iso) return; const ts = Date.parse(iso); if (Number.isNaN(ts)) return;
    if (!lastByLead.has(id) || ts > (lastByLead.get(id) as number)) lastByLead.set(id, ts);
  };
  for (const m of messages) bump(m.lead_id, m.sent_at);
  for (const r of replies) bump(r.lead_id, r.received_at);
  for (const c of visibleCalls) bump(c.lead_id, c.started_at);

  // Contacts table rows (sorted by score desc = allContacts order).
  const contactRows: ContactRow[] = allContacts.map((c: any) => {
    const na = nextByLead.get(c.id);
    let nextAction: ContactRow["nextAction"] = null;
    if (na) {
      const b = bucketActivity(na);
      const tone = b === "overdue" ? "overdue" : b === "today" ? "today" : "upcoming";
      const due = na.due_at ? new Date(na.due_at).toLocaleDateString(tag, { day: "2-digit", month: "short" }) : "";
      nextAction = { label: `${na.title}${due ? ` · ${due}` : ""}`, tone };
    }
    const lastTs = lastByLead.get(c.id) ?? null;
    return {
      id: c.id,
      name: `${c.primary_first_name ?? ""} ${c.primary_last_name ?? ""}`.trim() || c.company_name || "Unknown",
      role: c.primary_title_role ?? null,
      seniority: c.primary_seniority ? String(c.primary_seniority).replace(/_/g, " ") : null,
      seller: c.assigned_seller ?? null,
      lifecycle: t(`ld.status.${c.status === "proposal_sent" ? "proposalSent" : c.status === "closed_won" ? "won" : c.status === "closed_lost" ? "lost" : c.status}`) || c.status,
      lifecycleColor: statusColor(c.status),
      nextAction,
      lastInteraction: lastTs ? fmtRel(new Date(lastTs).toISOString(), tag) : null,
      channels: {
        linkedin: isValidLinkedInUrl(c.primary_linkedin_url) && c.allow_linkedin !== false,
        email: !!c.primary_work_email && c.allow_email !== false,
        phone: !!c.primary_phone && c.allow_call !== false,
      },
    };
  });

  // Campaign rollups grouped by flow name.
  const campByName = new Map<string, any[]>();
  for (const c of campaigns) { const k = c.name ?? "—"; (campByName.get(k) ?? campByName.set(k, []).get(k)!).push(c); }
  const campaignRollups: CampaignRollup[] = [...campByName.entries()].map(([nm, rows]) => {
    const ids = new Set(rows.map(r => r.id));
    const leadIds = new Set(rows.map(r => r.lead_id));
    const statuses = rows.map(r => r.status);
    const status = statuses.includes("active") ? "active" : statuses.includes("paused") ? "paused" : statuses[0] ?? "—";
    const msgs = messages.filter((m: any) => ids.has(m.campaign_id)).length;
    const reps = replies.filter((r: any) => leadIds.has(r.lead_id)).length;
    const pos = replies.filter((r: any) => leadIds.has(r.lead_id) && ["positive", "meeting_intent"].includes(r.classification ?? "")).length;
    const seller = rows.find(r => r.sellers?.name)?.sellers?.name ?? null;
    return { id: rows[0].id, name: nm, status, contacts: leadIds.size, messages: msgs, replies: reps, positive: pos, seller };
  }).sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1));
  const activeCampaignsCount = campaignRollups.filter(c => c.status === "active" || c.status === "paused").length;

  // Account-level engagement timeline (each event tagged with its contact).
  const events: TimelineEvent[] = [];
  const chLabels: Record<string, string> = { linkedin: t("chan.linkedin"), email: t("chan.email"), call: t("chan.call"), whatsapp: t("chan.whatsapp"), sms: t("chan.sms") };
  for (const m of messages) {
    if (!m.sent_at) continue;
    const ch = (m.channel || "email") as string;
    events.push({ id: `m-${m.id}`, kind: "message", at: m.sent_at, channel: ch, title: `${chLabels[ch.toLowerCase()] ?? ch} ${t("ld2.tl.sent")}`, body: (m.content ?? "").slice(0, 200) || null, meta: nameOf(m.lead_id), contactId: m.lead_id });
  }
  for (const r of replies) {
    if (!r.received_at || (r.channel || "") === "call") continue;
    const cls = r.classification || "";
    const tone = ["positive", "meeting_intent"].includes(cls) ? "positive" : ["negative", "unsubscribe", "spam"].includes(cls) ? "negative" : "neutral";
    events.push({ id: `r-${r.id}`, kind: "reply", at: r.received_at, channel: r.channel || "email", title: t("ld2.tl.reply"), body: r.reply_text, tone, meta: `${nameOf(r.lead_id)}${cls ? ` · ${cls}` : ""}`, contactId: r.lead_id });
  }
  for (const c of visibleCalls) {
    if (!c.started_at) continue;
    const cls = (c.classification || "").toLowerCase();
    const tone = /positive|interest|qualified|meeting/.test(cls) ? "positive" : /callback|call back|follow/.test(cls) ? "warning" : /not|negative|wrong|no answer|voicemail/.test(cls) ? "negative" : "neutral";
    events.push({ id: `c-${c.id}`, kind: "call", at: c.started_at, channel: "call", title: t("ld2.tl.call"), body: c.classification || c.ai_summary || c.notes || null, tone, meta: nameOf(c.lead_id), contactId: c.lead_id });
  }
  for (const c of campaigns) {
    if (c.started_at) events.push({ id: `camp-${c.id}`, kind: "campaign", at: c.started_at, title: `${t("ld2.tl.campaignStarted")} · ${c.name ?? ""}`.trim(), meta: nameOf(c.lead_id), contactId: c.lead_id });
  }
  for (const a of activities) {
    const at = a.due_at || a.completed_at || a.created_at;
    if (!at) continue;
    const isCb = a.source === "call_callback";
    events.push({ id: `a-${a.id}`, kind: "activity", at, channel: a.type === "call" ? "call" : null, title: a.title, body: a.description, tone: a.status === "completed" ? "neutral" : isCb ? "warning" : "info", meta: `${nameOf(a.lead_id)}${isCb ? " · callback" : ""}`, contactId: a.lead_id });
  }

  // Account intelligence facts + signals (derived; no invented data).
  const enr = (lead.enrichment as any) ?? {};
  const scrape = (lead.company_scrape as any) ?? null;
  const whatTheyDo = scrape?.summary || lead.organization_description || lead.website_summary || null;
  const ourPlay = angle.icp?.solutions_offered || angle.bio?.main_services || null;
  const whyMatters = [
    `${contactIds.length} ${contactIds.length === 1 ? t("co.contactSingular") : t("ld2.contacts")}`,
    activeCampaignsCount ? `${activeCampaignsCount} ${t("co.activeCampaigns")}` : null,
    positive ? `${positive} ${t("ld2.metric.positive").toLowerCase()}` : null,
  ].filter(Boolean).join(" · ");
  const facts = [
    { label: t("lead.company.whatTheyDo"), text: whatTheyDo ? String(whatTheyDo).slice(0, 400) : null },
    { label: t("co.whyMatters"), text: whyMatters || null },
    { label: t("brief.point.pain"), text: angle.icp?.pain_points ? String(angle.icp.pain_points).slice(0, 300) : null },
    { label: t("co.suggestedAngle"), text: ourPlay ? String(ourPlay).slice(0, 300) : null },
  ];
  const signals: string[] = [];
  if (lead.recent_website_news) signals.push(String(lead.recent_website_news).slice(0, 160));
  if (replies.length) signals.push(`${replies.length} ${replies.length === 1 ? t("co.replyInAccount") : t("co.repliesInAccount")}`);
  if (lead.recent_linkedin_post) signals.push(t("co.engagingLinkedin"));

  // Overview data
  const location = [lead.company_city, lead.company_country].filter(Boolean).join(", ") || null;
  const websiteUrl = urlify(lead.company_website);
  const presence = [
    websiteUrl ? { label: t("co.website"), href: websiteUrl, kind: "website" as const } : null,
    lead.company_linkedin ? { label: "LinkedIn", href: urlify(lead.company_linkedin)!, kind: "linkedin" as const } : null,
    lead.company_blog ? { label: t("ld.companyBlog"), href: urlify(lead.company_blog)!, kind: "blog" as const } : null,
    lead.company_instagram ? { label: "Instagram", href: `https://instagram.com/${String(lead.company_instagram).replace(/^@/, "")}`, kind: "instagram" as const } : null,
  ].filter(Boolean) as { label: string; href: string; kind: "website" | "linkedin" | "blog" | "instagram" }[];
  const revenueStr = lead.annual_revenue ? `$${lead.annual_revenue}` : null;
  const employees = lead.employees ?? lead.company_employee_count ?? null;
  const icp = typeof lead.lead_score === "number" ? lead.lead_score : null;
  const milestone = campaignRollups.find(c => c.status === "active")
    ? t("co.milestoneActive", { name: campaignRollups.find(c => c.status === "active")!.name })
    : positive ? t("co.milestonePositive") : null;

  // Research
  const technologies: string[] = (Array.isArray(lead.organization_technologies) ? lead.organization_technologies : (Array.isArray(enr.technologies) ? enr.technologies : [])) as string[];
  const keywords: string[] = lead.keywords ? String(lead.keywords).split(",").map((k: string) => k.trim()).filter(Boolean) : [];
  const websiteServices: string[] = lead.website_summary ? String(lead.website_summary).split(",").map((s: string) => s.trim()).filter(Boolean) : [];
  const social = [
    lead.company_posts_content ? { platform: t("ld.companyPost"), content: String(lead.company_posts_content).slice(0, 400) } : null,
    lead.recent_linkedin_post ? { platform: "LinkedIn", content: String(lead.recent_linkedin_post).slice(0, 400) } : null,
  ].filter(Boolean) as { platform: string; content: string }[];
  const sourceMeta = [
    lead.source_universe ? { label: t("co.sourceUniverse"), value: String(lead.source_universe) } : null,
    lead.company_founded_year ? { label: t("co.founded"), value: String(lead.company_founded_year) } : null,
    lead.company_sub_industry ? { label: t("lead.company.industry"), value: String(lead.company_sub_industry) } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const contactsForFilter = allContacts.map((c: any) => ({ id: c.id, name: `${c.primary_first_name ?? ""} ${c.primary_last_name ?? ""}`.trim() || "—" }));

  return (
    <div className="p-6 w-full fade-in">
      {/* Return-to-lead / breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        {fromLeadId ? (
          <Link href={`/leads/${fromLeadId}`} className="hover:underline flex items-center gap-1 font-semibold" style={{ color: C.blue }}>
            <ArrowLeft size={13} /> {t("co.backToLead", { name: fromLeadName ?? "" })}
          </Link>
        ) : (
          <Link href="/leads?view=companies" className="hover:underline flex items-center gap-1">
            <ArrowLeft size={12} /> {t("cmd.hint.company")}
          </Link>
        )}
        <span>/</span>
        <span style={{ color: C.textBody }}>{companyName}</span>
      </div>

      <CompanyHero
        name={companyName}
        industry={[lead.company_industry, lead.company_sub_industry].filter(Boolean).join(" · ") || null}
        location={location} website={websiteUrl}
        metrics={{ employees, revenue: revenueStr, contacts: contactIds.length, activeCampaigns: activeCampaignsCount, icp, messages: messages.length, replies: replies.length, positive }}
      />

      <AccountIntelligence facts={facts} signals={signals} hookLeadId={lead.id ?? null} companyName={companyName} />

      <section className="reveal rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
        <CompanyTabs tabs={[
          { label: t("ld2.tab.overview") },
          { label: t("ld.tab.contacts"), count: contactIds.length || undefined },
          { label: t("ld2.tab.engagement") },
          { label: t("ld2.tab.research") },
        ]}>
          <div className="px-4 sm:px-6 pb-6 pt-2">
            <CompanyOverview
              essentials={{ subIndustry: lead.company_sub_industry ?? null, founded: lead.company_founded_year ? String(lead.company_founded_year) : null, hq: location, websiteLabel: lead.company_website ?? null, websiteUrl, linkedinUrl: urlify(lead.company_linkedin), icp }}
              commercial={{ campaigns: campaignRollups.map(c => ({ id: c.id, name: c.name, status: c.status, contacts: c.contacts, seller: c.seller })), messages: messages.length, replies: replies.length, positive, milestone }}
              presence={presence}
              location={{ text: location, mapQuery: location ? `${companyName} ${location}` : null }}
            />
          </div>
          <div className="px-4 sm:px-6 pb-6 pt-2">
            <CompanyContacts contacts={contactRows} />
          </div>
          <div className="px-4 sm:px-6 pb-6 pt-2">
            <CompanyEngagement events={events} localeTag={tag} contacts={contactsForFilter} campaigns={campaignRollups} />
          </div>
          <div className="px-4 sm:px-6 pb-6 pt-2">
            <CompanyResearch technologies={technologies} keywords={keywords} industryTrends={lead.industry_trends ?? null} news={lead.recent_website_news ?? null} social={social} websiteServices={websiteServices} sourceMeta={sourceMeta} />
          </div>
        </CompanyTabs>
      </section>
    </div>
  );
}
