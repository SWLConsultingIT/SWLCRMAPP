import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Globe, MapPin, Users as UsersIcon, Mail, Phone,
  Star, ExternalLink, Share2,
  Newspaper, BookOpen, Building2, Megaphone,
} from "lucide-react";
import { LinkedInIcon, InstagramIcon, TwitterXIcon, FacebookIcon, GoogleIcon, WebsiteIcon } from "@/components/SocialIcons";
import CompanyTabs from "@/components/CompanyTabs";
import ContactCards from "@/components/ContactCards";
import ActivityTimeline from "@/components/ActivityTimeline";

const gold = "#C9A83A";
const goldLight = "rgba(201,168,58,0.08)";
const goldGlow = "rgba(201,168,58,0.15)";

// ── Data fetchers ──

async function getLead(id: string) {
  const { data } = await supabase.from("leads").select("*").eq("id", id).single();
  return data;
}

async function getCompanyContacts(companyName: string, currentLeadId: string) {
  if (!companyName) return [];
  const { data } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, primary_title_role, primary_seniority, status, lead_score, is_priority, allow_linkedin, allow_email, allow_call, primary_work_email, primary_phone, primary_linkedin_url, current_channel")
    .eq("company_name", companyName)
    .order("lead_score", { ascending: false });
  return data ?? [];
}

async function getCampaignStats(leadIds: string[]) {
  if (!leadIds.length) return { campaigns: 0, messages: 0, replies: 0 };
  const [{ count: campaigns }, { count: messages }, { count: replies }] = await Promise.all([
    supabase.from("campaigns").select("*", { count: "exact", head: true }).in("lead_id", leadIds),
    supabase.from("campaign_messages").select("*", { count: "exact", head: true }).in("lead_id", leadIds).eq("status", "sent"),
    supabase.from("lead_replies").select("*", { count: "exact", head: true }).in("lead_id", leadIds),
  ]);
  return { campaigns: campaigns ?? 0, messages: messages ?? 0, replies: replies ?? 0 };
}

// ── Helpers ──

function formatRevenue(val: number | null) {
  if (!val) return null;
  if (val >= 1_000_000) return `£${(val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1)}M`;
  if (val >= 1_000) return `£${(val / 1_000).toFixed(0)}K`;
  return `£${val}`;
}

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.3;
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={14} fill={i < full ? "#F59E0B" : i === full && half ? "#F59E0B" : "none"}
          style={{ color: i < full || (i === full && half) ? "#F59E0B" : "#D1D5DB" }} />
      ))}
      <span className="text-xs font-medium ml-1" style={{ color: C.textBody }}>{rating}</span>
    </div>
  );
}

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT", color: C.hot, bg: C.hotBg };
  if (score && score >= 50) return { label: "WARM", color: C.warm, bg: C.warmBg };
  return { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: "New", color: C.blue, bg: C.blueLight },
  contacted: { label: "Contacted", color: C.orange, bg: C.orangeLight },
  connected: { label: "Connected", color: C.accent, bg: C.accentLight },
  responded: { label: "Responded", color: C.green, bg: C.greenLight },
  qualified: { label: "Qualified", color: C.green, bg: C.greenLight },
  proposal_sent: { label: "Proposal Sent", color: C.accent, bg: C.accentLight },
  closed_won: { label: "Won", color: C.green, bg: C.greenLight },
  closed_lost: { label: "Lost", color: C.red, bg: C.redLight },
  nurturing: { label: "Nurturing", color: C.textMuted, bg: "#F3F4F6" },
};

// ── Page ──

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  const allContacts = await getCompanyContacts(lead.company_name, "---none---");
  const contactIds = allContacts.map((c: any) => c.id);
  const stats = await getCampaignStats(contactIds);

  const technologies: string[] = lead.organization_technologies ?? [];
  const keywords = lead.keywords ? lead.keywords.split(",").map((k: string) => k.trim()).filter(Boolean) : [];

  const score = scoreBadge(lead.lead_score, lead.is_priority);
  const st = statusMap[lead.status] ?? statusMap.new;

  // Count positive replies across all contacts
  const { data: allReplies } = await supabase
    .from("lead_replies")
    .select("classification")
    .in("lead_id", contactIds)
    .in("classification", ["positive", "meeting_intent"]);
  const positiveReplies = allReplies?.length ?? 0;

  // Build activity timeline from all contacts
  const contactNameMap: Record<string, string> = {};
  allContacts.forEach((c: any) => {
    contactNameMap[c.id] = `${c.primary_first_name ?? ""} ${c.primary_last_name ?? ""}`.trim() || "Unknown";
  });

  const { data: allCampaigns } = await supabase
    .from("campaigns")
    .select("id, lead_id, name, channel, status, started_at, sellers(name)")
    .in("lead_id", contactIds)
    .order("started_at", { ascending: false });

  const campaignIds = (allCampaigns ?? []).map((c: any) => c.id);

  const [{ data: allMessages }, { data: allReplyData }] = await Promise.all([
    campaignIds.length > 0
      ? supabase.from("campaign_messages").select("id, campaign_id, lead_id, step_number, channel, content, status, sent_at")
          .in("campaign_id", campaignIds).eq("status", "sent").order("sent_at", { ascending: false })
      : { data: [] },
    supabase.from("lead_replies").select("id, lead_id, campaign_id, channel, reply_text, received_at, classification, ai_confidence, requires_human_review")
      .in("lead_id", contactIds).order("received_at", { ascending: false }),
  ]);

  // Map campaigns to lead_id for lookup
  const campaignByLead: Record<string, any> = {};
  (allCampaigns ?? []).forEach((c: any) => { if (!campaignByLead[c.lead_id]) campaignByLead[c.lead_id] = c; });

  type ActivityItem = {
    id: string; type: "message_sent" | "reply" | "campaign_start" | "lead_created";
    contactName: string; channel: string; content: string | null; timestamp: string;
    stepNumber?: number; classification?: string; aiConfidence?: number; requiresReview?: boolean; sellerName?: string;
  };

  const activityItems: ActivityItem[] = [];

  // Messages sent
  (allMessages ?? []).forEach((m: any) => {
    const camp = (allCampaigns ?? []).find((c: any) => c.id === m.campaign_id);
    activityItems.push({
      id: m.id, type: "message_sent",
      contactName: contactNameMap[m.lead_id ?? camp?.lead_id] ?? "Unknown",
      channel: m.channel ?? camp?.channel ?? "email",
      content: m.content?.substring(0, 100) ?? null,
      timestamp: m.sent_at, stepNumber: m.step_number,
    });
  });

  // Replies
  (allReplyData ?? []).forEach((r: any) => {
    activityItems.push({
      id: r.id, type: "reply",
      contactName: contactNameMap[r.lead_id] ?? "Unknown",
      channel: r.channel ?? "email",
      content: r.reply_text, timestamp: r.received_at,
      classification: r.classification, aiConfidence: r.ai_confidence,
      requiresReview: r.requires_human_review,
    });
  });

  // Campaign starts
  (allCampaigns ?? []).forEach((c: any) => {
    if (c.started_at) {
      activityItems.push({
        id: `camp-${c.id}`, type: "campaign_start",
        contactName: contactNameMap[c.lead_id] ?? "Unknown",
        channel: c.channel ?? "email", content: c.name,
        timestamp: c.started_at, sellerName: c.sellers?.name,
      });
    }
  });

  // Sort by timestamp desc
  activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Mock notes (from seller_notes field)
  const teamNotes: { author: string; text: string; time: string }[] = [];
  allContacts.forEach((c: any) => {
    if ((c as any).seller_notes) {
      // seller_notes isn't in the select, skip for now
    }
  });
  // Use lead's seller_notes if available
  if (lead.seller_notes) {
    teamNotes.push({ author: lead.assigned_seller ?? "Team", text: lead.seller_notes, time: "Recently" });
  }

  return (
    <div className="p-6 w-full fade-in">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        <Link href="/leads" className="hover:underline flex items-center gap-1">
          <ArrowLeft size={12} /> Leads
        </Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{lead.company_name ?? "Company"}</span>
      </div>

      {/* ═══ COMPANY HEADER ═══ */}
      <div className="rounded-xl border mb-0" style={{ backgroundColor: C.card, borderColor: C.border }}>

        {/* Top row: Logo + Name + Badges */}
        <div className="p-6 flex items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            {lead.organization_logo_url ? (
              <img src={lead.organization_logo_url} alt="" className="w-16 h-16 rounded-xl object-cover border" style={{ borderColor: C.border }} />
            ) : (
              <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold shrink-0"
                style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
                {(lead.company_name ?? "?")[0].toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>
                {lead.company_name ?? "Unknown Company"}
              </h1>
              <div className="flex items-center gap-2 mt-1.5">
                {lead.company_industry && (
                  <span className="flex items-center gap-1.5 text-sm" style={{ color: C.textBody }}>
                    <Building2 size={13} style={{ color: gold }} />
                    {lead.company_industry}{lead.company_sub_industry ? ` · ${lead.company_sub_industry}` : ""}
                  </span>
                )}
                <span className="text-sm" style={{ color: C.textDim }}>·</span>
                {(lead.company_city || lead.company_country) && (
                  <span className="flex items-center gap-1 text-sm" style={{ color: C.textMuted }}>
                    <MapPin size={12} /> {[lead.company_city, lead.company_country].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            </div>
          </div>

          <Link href={`/campaigns/new/lead/${lead.id}`}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold transition-all hover:shadow-lg hover:scale-[1.02] shrink-0"
            style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#04070d", boxShadow: `0 2px 8px ${gold}40` }}>
            <Megaphone size={15} /> Target this Lead
          </Link>
        </div>

        {/* Divider */}
        <div className="border-t" style={{ borderColor: C.border }} />

        {/* Metrics row */}
        <div className="px-6 py-4 grid grid-cols-4 gap-4">
          {/* ICP */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>ICP Score</p>
            <div className="flex items-center gap-2">
              <div className="w-1 h-8 rounded-full" style={{ backgroundColor: score.color }} />
              <span className="text-xs font-bold px-2 py-1 rounded"
                style={{ color: score.color, backgroundColor: score.bg }}>
                {score.label}
              </span>
              {lead.lead_score > 0 && (
                <span className="text-lg font-bold" style={{ color: C.textPrimary }}>{lead.lead_score}/100</span>
              )}
            </div>
          </div>

          {/* Employees */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Employees</p>
            <p className="text-xl font-bold" style={{ color: C.textPrimary }}>{lead.employees ? `${lead.employees}+` : "—"}</p>
          </div>

          {/* Revenue */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Annual Revenue</p>
            <p className="text-xl font-bold" style={{ color: C.textPrimary }}>{formatRevenue(Number(lead.annual_revenue)) ?? "—"}</p>
          </div>

          {/* Current Activity */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Current Activity</p>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stats.campaigns > 0 ? C.green : C.textDim }} />
              <p className="text-lg font-bold" style={{ color: C.textPrimary }}>
                {stats.campaigns > 0 ? `${stats.campaigns} Active Campaign${stats.campaigns > 1 ? "s" : ""}` : "No campaigns"}
              </p>
            </div>
          </div>
        </div>

        {/* Outreach stats bar */}
        <div className="mx-6 mb-4 px-5 py-3 rounded-lg flex items-center gap-8" style={{ backgroundColor: goldLight, border: `1px solid rgba(201,168,58,0.2)` }}>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold" style={{ color: C.textPrimary }}>{stats.messages}</span>
            <span className="text-sm" style={{ color: C.textMuted }}>Messages Sent</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold" style={{ color: C.textPrimary }}>{stats.replies}</span>
            <span className="text-sm" style={{ color: C.textMuted }}>Replies</span>
          </div>
          {stats.replies > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold" style={{ color: C.green }}>
                {positiveReplies} ({stats.replies > 0 ? Math.round((positiveReplies / stats.replies) * 100) : 0}%)
              </span>
              <span className="text-sm" style={{ color: C.textMuted }}>Positive Sentiment</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <CompanyTabs tabs={[
          { label: "Overview" },
          { label: "Contacts", count: allContacts.length },
          { label: "Activity" },
        ]}>

          {/* ═══ TAB 0: OVERVIEW ═══ */}
          <div className="space-y-6">

        {/* Row 1: Company Profile + Location & Contact */}
        <div className="grid grid-cols-2 gap-6">

          {/* Company Profile */}
          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Company Profile</h2>
              {lead.google_reviews_rating && <StarRating rating={Number(lead.google_reviews_rating)} />}
            </div>

            {lead.organization_tagline && (
              <p className="text-sm italic mb-3" style={{ color: C.accent }}>{lead.organization_tagline}</p>
            )}

            {(lead.organization_description || lead.organization_short_desc) && (
              <p className="text-sm leading-relaxed mb-4" style={{ color: C.textBody }}>
                {lead.organization_short_desc ?? lead.organization_description}
              </p>
            )}

            {lead.company_mission && (
              <div className="rounded-lg border p-3 mb-4" style={{ borderColor: C.border, backgroundColor: "#F9FAFB" }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Our Mission</p>
                <p className="text-sm italic" style={{ color: C.textBody }}>"{lead.company_mission}"</p>
              </div>
            )}

            <div className="flex items-center gap-6 pt-3 border-t" style={{ borderColor: C.border }}>
              {lead.employees && (
                <div>
                  <p className="text-xs uppercase font-semibold" style={{ color: C.textMuted }}>Employees</p>
                  <p className="text-lg font-bold" style={{ color: C.textPrimary }}>{lead.employees}</p>
                </div>
              )}
              {lead.annual_revenue && (
                <div>
                  <p className="text-xs uppercase font-semibold" style={{ color: C.textMuted }}>Revenue</p>
                  <p className="text-lg font-bold" style={{ color: C.textPrimary }}>{formatRevenue(Number(lead.annual_revenue))}</p>
                </div>
              )}
            </div>
          </div>

          {/* Location & Contact */}
          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h2 className="text-sm font-bold mb-4" style={{ color: C.textPrimary }}>Location & Contact</h2>

            {/* Map */}
            {(() => {
              const locationQuery = [lead.company_address_1, lead.company_city, lead.company_state, lead.company_country].filter(Boolean).join(", ");
              return locationQuery ? (
                <div className="rounded-lg h-36 mb-4 overflow-hidden border" style={{ borderColor: C.border }}>
                  <iframe
                    width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(locationQuery)}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                    title="Location map"
                  />
                </div>
              ) : null;
            })()}

            {/* Address */}
            {(lead.company_address_1 || lead.company_city) && (
              <div className="flex items-start gap-2 mb-3">
                <MapPin size={14} className="shrink-0 mt-0.5" style={{ color: C.textMuted }} />
                <p className="text-sm" style={{ color: C.textBody }}>
                  {[lead.company_address_1, lead.company_address_2, lead.company_cp, lead.company_city, lead.company_state, lead.company_country].filter(Boolean).join(", ")}
                </p>
              </div>
            )}

            {/* Contact details */}
            <div className="space-y-2.5 mt-4">
              {lead.company_phone && (
                <div className="flex items-center gap-2">
                  <Phone size={14} style={{ color: C.phone }} />
                  <span className="text-sm" style={{ color: C.textBody }}>{lead.company_phone}</span>
                </div>
              )}
              {lead.company_email && (
                <div className="flex items-center gap-2">
                  <Mail size={14} style={{ color: C.email }} />
                  <a href={`mailto:${lead.company_email}`} className="text-sm hover:underline" style={{ color: C.textBody }}>{lead.company_email}</a>
                </div>
              )}
              {lead.company_website && (
                <div className="flex items-center gap-2">
                  <Globe size={14} style={{ color: C.accent }} />
                  <a href={lead.company_website} target="_blank" rel="noopener noreferrer"
                    className="text-sm font-medium hover:underline" style={{ color: C.accent }}>
                    {lead.company_website.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Online Presence + Technologies & Keywords + Industry Intel */}
        <div className="grid grid-cols-3 gap-6">

          {/* Online Presence */}
          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: gold }}>Online Presence</h3>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: "Website", icon: <WebsiteIcon size={22} />, url: lead.company_website, activeBg: "#0D9488", activeText: "#FFFFFF" },
                { label: "LinkedIn", icon: <LinkedInIcon size={22} />, url: lead.company_linkedin, activeBg: "#0A66C2", activeText: "#FFFFFF" },
                { label: "Instagram", icon: <InstagramIcon size={22} />, url: lead.company_instagram ? `https://instagram.com/${lead.company_instagram}` : null, activeBg: "#E4405F", activeText: "#FFFFFF" },
                { label: "GMB", icon: <GoogleIcon size={22} />, url: lead.company_google_mybusiness, activeBg: "#FBBC05", activeText: "#1F2937" },
                { label: "Twitter", icon: <TwitterXIcon size={22} />, url: lead.twitter_url, activeBg: "#14171A", activeText: "#FFFFFF" },
                { label: "Facebook", icon: <FacebookIcon size={22} />, url: lead.facebook_url, activeBg: "#1877F2", activeText: "#FFFFFF" },
              ].map(({ label, icon, url, activeBg, activeText }) => {
                const hasUrl = !!url;
                return hasUrl ? (
                  <a key={label} href={url!} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-3 rounded-lg transition-all hover:opacity-90 hover:shadow-md cursor-pointer"
                    style={{ backgroundColor: activeBg }}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.2)" }}>
                      <div className="[&_svg]:fill-white [&_svg_path]:fill-white [&_svg_circle]:stroke-white [&_svg_line]:stroke-white [&_svg_path]:stroke-none [&_svg]:stroke-none">
                        {icon}
                      </div>
                    </div>
                    <span className="text-sm font-semibold" style={{ color: activeText }}>{label}</span>
                  </a>
                ) : (
                  <div key={label}
                    className="flex items-center gap-3 px-3 py-3 rounded-lg border"
                    style={{ borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" }}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 grayscale opacity-30" style={{ backgroundColor: "white" }}>
                      {icon}
                    </div>
                    <span className="text-sm font-medium" style={{ color: "#D1D5DB" }}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Technologies & Keywords */}
          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: gold }}>Technologies & Keywords</h3>

            {technologies.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {technologies.map((tech: string) => (
                  <span key={tech} className="text-xs font-medium px-2 py-1 rounded-md"
                    style={{ backgroundColor: C.accentLight, color: C.accent }}>
                    {tech}
                  </span>
                ))}
              </div>
            )}

            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {keywords.map((kw: string) => (
                  <span key={kw} className="text-xs px-2 py-1 rounded-full border"
                    style={{ borderColor: C.accent, color: C.accent }}>
                    {kw}
                  </span>
                ))}
              </div>
            )}

            {lead.similar_organization && (
              <p className="text-xs mt-3 pt-3 border-t" style={{ borderColor: C.border, color: C.textMuted }}>
                Similar to: <span className="font-medium" style={{ color: C.accent }}>{lead.similar_organization}</span>
              </p>
            )}
          </div>

          {/* Industry Intel */}
          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: gold }}>Industry Intel</h3>

            <p className="text-sm font-semibold mb-1" style={{ color: C.textPrimary }}>
              {lead.company_industry ?? "—"}
            </p>
            {lead.company_sub_industry && (
              <p className="text-xs uppercase mb-3" style={{ color: C.textMuted }}>{lead.company_sub_industry}</p>
            )}

            {lead.industry_trends && (
              <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: "#F9FAFB" }}>
                <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>{lead.industry_trends}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t" style={{ borderColor: C.border }}>
              {lead.source_tool && (
                <span className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>
                  {lead.source_tool}
                </span>
              )}
              {lead.source_universe && (
                <span className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>
                  {lead.source_universe}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Row 3: Latest Content & News + Company Social Activity */}
        <div className="grid grid-cols-5 gap-6">

          {/* Latest Content & News (3 cols) */}
          <div className="col-span-3 rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h2 className="text-sm font-bold mb-4" style={{ color: C.textPrimary }}>Latest Content & News</h2>

            <div className="grid grid-cols-2 gap-5">
              {lead.recent_website_news && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Newspaper size={12} style={{ color: C.orange }} />
                    <span className="text-xs font-semibold uppercase" style={{ color: C.textMuted }}>Website News</span>
                  </div>
                  <p className="text-sm font-semibold mb-1" style={{ color: C.textPrimary }}>
                    {lead.recent_website_news.substring(0, 80)}
                  </p>
                  <p className="text-xs line-clamp-2" style={{ color: C.textMuted }}>
                    {lead.recent_website_news.substring(80)}
                  </p>
                </div>
              )}

              {lead.company_blog && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <BookOpen size={12} style={{ color: C.blue }} />
                    <span className="text-xs font-semibold uppercase" style={{ color: C.textMuted }}>Blog</span>
                  </div>
                  <p className="text-sm line-clamp-3" style={{ color: C.textBody }}>{lead.company_blog}</p>
                </div>
              )}

              {(lead.company_linkedin_post || lead.recent_linkedin_post) && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Share2 size={12} style={{ color: "#0A66C2" }} />
                    <span className="text-xs font-semibold uppercase" style={{ color: C.textMuted }}>LinkedIn Post</span>
                  </div>
                  <p className="text-sm line-clamp-3" style={{ color: C.textBody }}>
                    {lead.recent_linkedin_post ?? lead.company_linkedin_post}
                  </p>
                </div>
              )}

              {lead.website_summary && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Globe size={12} style={{ color: C.accent }} />
                    <span className="text-xs font-semibold uppercase" style={{ color: C.textMuted }}>Website Summary</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {lead.website_summary.split(",").slice(0, 5).map((w: string, i: number) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>
                        {w.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!lead.recent_website_news && !lead.company_blog && !lead.company_linkedin_post && !lead.recent_linkedin_post && !lead.website_summary && (
                <div className="col-span-2 py-6 text-center">
                  <p className="text-sm" style={{ color: C.textDim }}>No content data available yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Company Social Activity (2 cols) */}
          <div className="col-span-2 rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h3 className="text-sm font-bold mb-4" style={{ color: C.textPrimary }}>Company Social Activity</h3>

            <div className="space-y-4">
              {(lead.recent_ig_post || lead.instagram_last_posts) && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#FDF2F8" }}>
                    <InstagramIcon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold" style={{ color: C.textMuted }}>Instagram</p>
                    <p className="text-sm line-clamp-2 mt-0.5" style={{ color: C.textBody }}>
                      {lead.recent_ig_post ?? lead.instagram_last_posts}
                    </p>
                  </div>
                </div>
              )}

              {lead.twitter_last_posts && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#F8FAFC" }}>
                    <TwitterXIcon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold" style={{ color: C.textMuted }}>Twitter / X</p>
                    <p className="text-sm line-clamp-2 mt-0.5" style={{ color: C.textBody }}>{lead.twitter_last_posts}</p>
                  </div>
                </div>
              )}

              {lead.company_posts_content && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: C.accentLight }}>
                    <Newspaper size={16} style={{ color: C.accent }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold" style={{ color: C.textMuted }}>Recent Posts</p>
                    <p className="text-sm line-clamp-2 mt-0.5" style={{ color: C.textBody }}>{lead.company_posts_content}</p>
                  </div>
                </div>
              )}

              {!lead.recent_ig_post && !lead.instagram_last_posts && !lead.twitter_last_posts && !lead.company_posts_content && (
                <p className="text-sm text-center py-4" style={{ color: C.textDim }}>No social activity data</p>
              )}
            </div>
          </div>
        </div>
          </div>

          {/* ═══ TAB 1: CONTACTS ═══ */}
          <ContactCards contacts={allContacts} />

          {/* ═══ TAB 2: ACTIVITY ═══ */}
          <ActivityTimeline activities={activityItems} notes={teamNotes} />

        </CompanyTabs>
      </div>
    </div>
  );
}
