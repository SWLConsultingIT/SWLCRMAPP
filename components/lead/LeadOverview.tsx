"use client";

// Overview tab — a commercial SUMMARY, not a data dump. Next Action (derived
// from the universal Activities system, reused via LeadActivitiesPanel
// variant="next"), then Contact + Commercial status, then Key metrics +
// compact Company snapshot that links to the real /companies/[name] page.

import Link from "next/link";
import { Card } from "@/components/ui";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { LinkedInIcon } from "@/components/SocialIcons";
import { Mail, Phone, MapPin, Building2, ExternalLink, Megaphone, Users, Send } from "lucide-react";
import { SectionHeader, InfoRow, MetricStrip } from "@/components/lead/ui";
import LeadActivitiesPanel from "@/components/LeadActivitiesPanel";
import LeadStatusSelect from "@/components/LeadStatusSelect";
import SendToOdooPanel from "@/components/SendToOdooPanel";
import ProspectClock from "@/components/ProspectClock";
import WrongNumberPill from "@/components/WrongNumberPill";

const gold = "var(--brand, #c9a83a)";

function isValidLinkedInUrl(url?: string | null): boolean {
  if (!url) return false;
  try { const u = new URL(url); return /(^|\.)linkedin\.com$/i.test(u.hostname) && /\/in\//.test(u.pathname); }
  catch { return false; }
}

export default function LeadOverview({
  lead, leadId, campaign, metrics, initialActivities, canAssignActivities,
  autoReplies, tz, place, company,
}: {
  lead: any; leadId: string; campaign: any;
  metrics: { messages: number; replies: number; positive: number; calls: number; step: string; stepPct: number };
  initialActivities: any[]; canAssignActivities: boolean;
  autoReplies: { positive?: string; negative?: string } | null;
  tz: string | null; place: string | null;
  company: { contacts: number; activeCampaigns: number } | null;
}) {
  const { t } = useLocale();
  const liUrl = lead.primary_linkedin_url as string | null;
  const email = (lead.primary_work_email ?? lead.primary_personal_email) as string | null;
  const location = [lead.company_city, lead.company_country].filter(Boolean).join(", ");
  const isWon = lead.status === "closed_won" || !!lead.transferred_to_odoo_at;
  const revenue = lead.annual_revenue ? `$${lead.annual_revenue}` : null;
  const employees = lead.employees ?? lead.company_employee_count ?? null;

  return (
    <div className="space-y-4">
      {/* NEXT ACTION — reuses the Activities source of truth (next-only view) */}
      <LeadActivitiesPanel
        leadId={leadId} leadLabel={`${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || lead.company_name}
        company={lead.company_name ?? null} leadPhone={lead.primary_phone ?? null}
        leadCountry={lead.company_country ?? null} leadStatus={lead.status ?? null}
        canAssignOthers={canAssignActivities} initialActivities={initialActivities} variant="next"
      />

      <div className="grid md:grid-cols-2 gap-4">
        {/* Contact */}
        <Card>
          <SectionHeader title={t("ld2.contact")} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <InfoRow icon={<Mail size={14} />} label={t("auth.email")} value={email ?? undefined} />
            <InfoRow icon={<Phone size={14} />} label={t("ld.mobile")}>
              {lead.allow_call === false
                ? <WrongNumberPill leadId={leadId} currentPhone={lead.primary_phone ?? null} />
                : (lead.primary_phone ?? <span style={{ color: C.textDim }}>—</span>)}
            </InfoRow>
            <InfoRow icon={<LinkedInIcon size={14} />} label="LinkedIn"
              href={isValidLinkedInUrl(liUrl) ? liUrl! : undefined} external
              value={isValidLinkedInUrl(liUrl) ? liUrl!.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "") : undefined} />
            <InfoRow icon={<MapPin size={14} />} label={t("ld.location")} value={location || undefined} />
          </div>
          {tz && <div className="mt-3 pt-3 border-t" style={{ borderColor: C.border }}><ProspectClock tz={tz} place={place} /></div>}
        </Card>

        {/* Commercial status */}
        <Card>
          <SectionHeader title={t("ld2.commercial")} />
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] uppercase tracking-wider" style={{ color: C.textDim }}>{t("pulse.col.seller")}</span>
              <span className="text-[13px] font-semibold" style={{ color: C.textBody }}>{lead.assigned_seller ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] uppercase tracking-wider" style={{ color: C.textDim }}>{t("ld2.lifecycle")}</span>
              <LeadStatusSelect leadId={leadId} initialStatus={lead.status} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] uppercase tracking-wider" style={{ color: C.textDim }}>{t("ld.tab.campaign")}</span>
              {campaign ? (
                <Link href={`/campaigns/${campaign.id}`} className="text-[13px] font-semibold inline-flex items-center gap-1.5 hover:underline" style={{ color: C.blue }}>
                  <Megaphone size={12} /> <span className="truncate max-w-[160px]">{campaign.name}</span>
                  <span className="tabular-nums" style={{ color: C.textMuted }}>· {metrics.step}</span>
                </Link>
              ) : <span className="text-[13px]" style={{ color: C.textDim }}>—</span>}
            </div>
            {isWon && (
              <div className="pt-3 border-t" style={{ borderColor: C.border }}>
                <div className="flex items-center gap-2 mb-2">
                  <Send size={13} style={{ color: C.green }} />
                  <span className="text-[12px] font-bold" style={{ color: C.green }}>{t("ld2.won")}</span>
                </div>
                <SendToOdooPanel leadId={leadId} transferred={!!lead.transferred_to_odoo_at} />
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Key metrics */}
        <Card>
          <SectionHeader title={t("ld2.keyMetrics")} />
          <MetricStrip items={[
            { label: t("ld2.metric.messages"), value: metrics.messages },
            { label: t("ld2.metric.replies"), value: metrics.replies },
            { label: t("ld2.metric.positive"), value: metrics.positive, tone: metrics.positive > 0 ? C.green : undefined },
            { label: t("ld2.metric.calls"), value: metrics.calls },
          ]} />
          <div className="mt-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-wider" style={{ color: C.textDim }}>{t("ld2.sequence")}</span>
              <span className="text-[11px] font-bold tabular-nums" style={{ color: gold }}>{metrics.step} · {metrics.stepPct}%</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
              <div className="h-1.5 rounded-full" style={{ width: `${metrics.stepPct}%`, backgroundColor: gold }} />
            </div>
          </div>
        </Card>

        {/* Company snapshot */}
        <Card>
          <SectionHeader title={t("ld2.companySnapshot")} action={lead.company_name ? (
            <Link href={`/companies/${encodeURIComponent(lead.company_name)}`} className="text-[12px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: C.blue }}>
              {t("ld.viewCompany")} <ExternalLink size={12} />
            </Link>
          ) : undefined} />
          {lead.company_name ? (
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold shrink-0" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#fff" }}>
                {lead.company_name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold leading-tight" style={{ color: C.textPrimary }}>{lead.company_name}</p>
                <p className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>
                  {[lead.company_industry, lead.company_sub_industry].filter(Boolean).join(" · ") || "—"}
                </p>
                <p className="text-[12px] mt-1.5" style={{ color: C.textBody }}>
                  {[employees ? `${employees} ${t("lead.company.employees").toLowerCase()}` : null, revenue].filter(Boolean).join(" · ") || null}
                </p>
                {location && <p className="text-[12px] inline-flex items-center gap-1 mt-0.5" style={{ color: C.textMuted }}><MapPin size={11} /> {location}</p>}
                {company && (
                  <div className="flex items-center gap-3 mt-2 text-[12px]" style={{ color: C.textMuted }}>
                    <span className="inline-flex items-center gap-1"><Users size={12} /> {company.contacts} {t("ld2.contacts")}</span>
                    <span className="inline-flex items-center gap-1"><Megaphone size={12} /> {company.activeCampaigns} {t("ld2.activeCampaigns")}</span>
                  </div>
                )}
              </div>
            </div>
          ) : <p className="text-[13px]" style={{ color: C.textDim }}>—</p>}
        </Card>
      </div>
    </div>
  );
}
