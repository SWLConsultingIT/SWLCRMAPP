"use client";

// Company Overview — essentials NOT already in the hero (no employees/revenue/
// industry/ICP repeat), location folded into HQ, a single website/linkedin
// representation, and a Commercial Summary that answers "what are we doing with
// this account?" (the single home for outreach metrics + the account's next
// action).

import Link from "next/link";
import { Card } from "@/components/ui";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { LinkedInIcon } from "@/components/SocialIcons";
import { MapPin, ExternalLink, Globe, Megaphone, Phone, Zap } from "lucide-react";
import { SectionHeader, InfoRow, EmptyLine } from "@/components/lead/ui";

const gold = "var(--brand, #c9a83a)";

type CampaignRollup = { id: string; name: string; status: string; contacts: number; seller: string | null };
type NextAction = { contact: string; title: string; when: string | null; tone: "overdue" | "today" | "upcoming"; more: number } | null;

export default function CompanyOverview({
  essentials, commercial, presence, mapQuery,
}: {
  essentials: { founded: string | null; hq: string | null; phone: string | null; websiteLabel: string | null; websiteUrl: string | null; linkedinUrl: string | null; icpName: string | null };
  commercial: { campaigns: CampaignRollup[]; outreach: { messages: number; replies: number; positive: number }; milestone: string | null; nextAction: NextAction };
  presence: { label: string; href: string; kind: "website" | "linkedin" | "blog" | "instagram" }[];
  mapQuery: string | null;
}) {
  const { t } = useLocale();
  const e = essentials;
  const hasEssentials = e.founded || e.hq || e.phone || e.websiteUrl || e.linkedinUrl || e.icpName;
  const na = commercial.nextAction;
  const naColor = na ? (na.tone === "overdue" ? C.red : na.tone === "today" ? gold : C.blue) : C.textMuted;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* essentials */}
      <Card>
        <SectionHeader title={t("co.essentials")} />
        {hasEssentials ? (
          <div className="grid grid-cols-2 gap-3.5">
            {e.founded && <InfoRow label={t("co.founded")} value={e.founded} />}
            {e.hq && (
              <InfoRow icon={<MapPin size={14} />} label={t("co.hq")}>
                <span>{e.hq}</span>
                {mapQuery && (
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noreferrer"
                    className="ml-2 text-[11px] font-semibold inline-flex items-center gap-0.5 hover:underline" style={{ color: C.blue }}>
                    {t("co.viewMap")} <ExternalLink size={10} />
                  </a>
                )}
              </InfoRow>
            )}
            {e.phone && <InfoRow icon={<Phone size={14} />} label={t("ld.mobile")} value={e.phone} />}
            {e.icpName && <InfoRow icon={<Zap size={14} />} label={t("co.icp")} value={e.icpName} />}
            {e.websiteUrl && <InfoRow icon={<Globe size={14} />} label={t("co.website")} href={e.websiteUrl} external value={e.websiteLabel ?? e.websiteUrl} />}
            {e.linkedinUrl && <InfoRow icon={<LinkedInIcon size={14} />} label="LinkedIn" href={e.linkedinUrl} external value={t("co.companyPage")} />}
          </div>
        ) : <EmptyLine>{t("co.noEssentials")}</EmptyLine>}
        {presence.length > 0 && (
          <div className="mt-3.5 pt-3.5 border-t flex flex-wrap gap-2" style={{ borderColor: C.border }}>
            {presence.map(p => (
              <a key={p.kind} href={p.href} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border px-2.5 py-1.5" style={{ borderColor: C.border, color: C.blue, backgroundColor: C.surface }}>
                {p.kind === "linkedin" ? <LinkedInIcon size={13} /> : <Globe size={13} />} {p.label} <ExternalLink size={11} style={{ opacity: 0.6 }} />
              </a>
            ))}
          </div>
        )}
      </Card>

      {/* commercial summary — the single home for outreach + next account action */}
      <Card>
        <SectionHeader title={t("co.commercialSummary")} />
        {na && (
          <div className="mb-3 rounded-xl p-2.5 flex items-center gap-2" style={{ backgroundColor: `color-mix(in srgb, ${naColor} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${naColor} 26%, ${C.border})` }}>
            <Zap size={14} style={{ color: naColor }} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{t("co.col.nextAction")}</p>
              <p className="text-[12.5px] font-semibold truncate" style={{ color: C.textPrimary }}>
                <span style={{ color: naColor }}>{na.contact}</span> · {na.title}{na.when ? ` · ${na.when}` : ""}{na.more > 0 ? ` · +${na.more}` : ""}
              </p>
            </div>
          </div>
        )}
        {commercial.campaigns.length > 0 ? (
          <div className="space-y-2">
            {commercial.campaigns.slice(0, 4).map(c => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center gap-2 text-[13px] hover:opacity-80">
                <Megaphone size={13} style={{ color: gold }} className="shrink-0" />
                <span className="font-semibold truncate" style={{ color: C.textPrimary }}>{c.name}</span>
                <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${c.status === "active" ? C.green : C.textMuted} 14%, transparent)`, color: c.status === "active" ? C.green : C.textMuted }}>{c.status}</span>
                <span className="ml-auto text-[11.5px] tabular-nums shrink-0" style={{ color: C.textMuted }}>{c.contacts} {t("ld2.contacts")}{c.seller ? ` · ${c.seller}` : ""}</span>
              </Link>
            ))}
          </div>
        ) : <EmptyLine>{t("co.noCampaigns")}</EmptyLine>}
        <div className="mt-3.5 pt-3.5 border-t flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px]" style={{ borderColor: C.border, color: C.textMuted }}>
          <span><b style={{ color: C.textPrimary }}>{commercial.outreach.messages}</b> {t("ld2.metric.messages").toLowerCase()}</span>
          <span><b style={{ color: C.textPrimary }}>{commercial.outreach.replies}</b> {t("ld2.metric.replies").toLowerCase()}</span>
          <span style={{ color: commercial.outreach.positive > 0 ? C.green : C.textMuted, fontWeight: 700 }}>{commercial.outreach.positive} {t("ld2.metric.positive").toLowerCase()}</span>
        </div>
        {commercial.milestone && <p className="mt-2 text-[12px]" style={{ color: C.textBody }}>{commercial.milestone}</p>}
      </Card>
    </div>
  );
}
