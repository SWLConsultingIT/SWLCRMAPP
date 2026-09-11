"use client";

// Company Overview — essentials NOT already in the hero + a compact commercial
// summary + compact location and real online-presence links only.

import { Card } from "@/components/ui";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { LinkedInIcon } from "@/components/SocialIcons";
import { MapPin, ExternalLink, Globe, Megaphone } from "lucide-react";
import { SectionHeader, InfoRow, EmptyLine } from "@/components/lead/ui";

const gold = "var(--brand, #c9a83a)";

type CampaignRollup = { id: string; name: string; status: string; contacts: number; seller: string | null };

export default function CompanyOverview({
  essentials, commercial, presence, location,
}: {
  essentials: { subIndustry: string | null; founded: string | null; hq: string | null; websiteLabel: string | null; websiteUrl: string | null; linkedinUrl: string | null; icp: number | null };
  commercial: { campaigns: CampaignRollup[]; messages: number; replies: number; positive: number; milestone: string | null };
  presence: { label: string; href: string; kind: "website" | "linkedin" | "blog" | "instagram" }[];
  location: { text: string | null; mapQuery: string | null };
}) {
  const { t } = useLocale();
  const e = essentials;
  const hasEssentials = e.subIndustry || e.founded || e.hq || e.websiteUrl || e.linkedinUrl || e.icp != null;

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        {/* essentials */}
        <Card>
          <SectionHeader title={t("co.essentials")} />
          {hasEssentials ? (
            <div className="grid grid-cols-2 gap-3.5">
              {e.subIndustry && <InfoRow label={t("lead.company.industry")} value={e.subIndustry} />}
              {e.founded && <InfoRow label={t("co.founded")} value={e.founded} />}
              {e.hq && <InfoRow icon={<MapPin size={14} />} label={t("co.hq")} value={e.hq} />}
              {e.icp != null && <InfoRow label={t("co.icpFit")} value={`${e.icp} / 100`} />}
              {e.websiteUrl && <InfoRow icon={<Globe size={14} />} label={t("co.website")} href={e.websiteUrl} external value={e.websiteLabel ?? e.websiteUrl} />}
              {e.linkedinUrl && <InfoRow icon={<LinkedInIcon size={14} />} label="LinkedIn" href={e.linkedinUrl} external value={t("co.companyPage")} />}
            </div>
          ) : <EmptyLine>{t("co.noEssentials")}</EmptyLine>}

          {/* location + presence */}
          {(location.text || presence.length > 0) && (
            <div className="mt-3.5 pt-3.5 border-t space-y-2.5" style={{ borderColor: C.border }}>
              {location.text && (
                <div className="flex items-center gap-2 text-[13px]" style={{ color: C.textBody }}>
                  <MapPin size={14} style={{ color: C.textMuted }} /> {location.text}
                  {location.mapQuery && (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.mapQuery)}`} target="_blank" rel="noreferrer"
                      className="ml-auto text-[12px] font-semibold inline-flex items-center gap-1 hover:underline" style={{ color: C.blue }}>
                      {t("co.viewMap")} <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              )}
              {presence.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {presence.map(p => (
                    <a key={p.kind} href={p.href} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border px-2.5 py-1.5" style={{ borderColor: C.border, color: C.blue, backgroundColor: C.surface }}>
                      {p.kind === "linkedin" ? <LinkedInIcon size={13} /> : <Globe size={13} />} {p.label} <ExternalLink size={11} style={{ opacity: 0.6 }} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* commercial summary */}
        <Card>
          <SectionHeader title={t("co.commercialSummary")} />
          {commercial.campaigns.length > 0 ? (
            <div className="space-y-2">
              {commercial.campaigns.slice(0, 4).map(c => (
                <div key={c.id} className="flex items-center gap-2 text-[13px]">
                  <Megaphone size={13} style={{ color: gold }} className="shrink-0" />
                  <span className="font-semibold truncate" style={{ color: C.textPrimary }}>{c.name}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${c.status === "active" ? C.green : C.textMuted} 14%, transparent)`, color: c.status === "active" ? C.green : C.textMuted }}>{c.status}</span>
                  <span className="ml-auto text-[11.5px] tabular-nums" style={{ color: C.textMuted }}>{c.contacts} {t("ld2.contacts")}{c.seller ? ` · ${c.seller}` : ""}</span>
                </div>
              ))}
            </div>
          ) : <EmptyLine>{t("co.noCampaigns")}</EmptyLine>}
          <div className="mt-3.5 pt-3.5 border-t flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px]" style={{ borderColor: C.border, color: C.textMuted }}>
            <span><b style={{ color: C.textPrimary }}>{commercial.messages}</b> {t("ld2.metric.messages").toLowerCase()}</span>
            <span><b style={{ color: C.textPrimary }}>{commercial.replies}</b> {t("ld2.metric.replies").toLowerCase()}</span>
            <span style={{ color: commercial.positive > 0 ? C.green : C.textMuted, fontWeight: 700 }}>{commercial.positive} {t("ld2.metric.positive").toLowerCase()}</span>
          </div>
          {commercial.milestone && <p className="mt-2 text-[12px]" style={{ color: C.textBody }}>{commercial.milestone}</p>}
        </Card>
      </div>
    </div>
  );
}
