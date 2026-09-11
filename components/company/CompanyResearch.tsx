"use client";

// Company → Research: all enriched/technical context, essentials-first with
// progressive disclosure. Empty sections are hidden or shown as a compact
// "no signals" line — never a giant empty card.

import { Card } from "@/components/ui";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { LinkedInIcon } from "@/components/SocialIcons";
import { SectionHeader, ChipCloud, EmptyLine } from "@/components/lead/ui";

const gold = "var(--brand, #c9a83a)";

export default function CompanyResearch({
  technologies, keywords, industryTrends, news, social, websiteServices, sourceMeta,
}: {
  technologies: string[]; keywords: string[];
  industryTrends: string | null; news: string | null;
  social: { platform: string; content: string }[];
  websiteServices: string[];
  sourceMeta: { label: string; value: string }[];
}) {
  const { t } = useLocale();
  const hasTech = technologies.length > 0 || keywords.length > 0 || websiteServices.length > 0;
  const hasSignals = !!industryTrends || !!news || social.length > 0;

  return (
    <div className="space-y-4">
      {/* Technical / enrichment */}
      {hasTech ? (
        <Card>
          <SectionHeader title={t("ld2.technical")} />
          <div className="space-y-4">
            <ChipCloud label={t("ld.technologies")} items={technologies} tone="blue" />
            <ChipCloud label={t("ld.keywords")} items={keywords} tone="gold" />
            <ChipCloud label={t("ld.services")} items={websiteServices} tone="neutral" initial={12} />
          </div>
        </Card>
      ) : null}

      {/* Signals: industry / news / social — only when there's content */}
      <Card>
        <SectionHeader title={t("co.signalsResearch")} />
        {hasSignals ? (
          <div className="space-y-3">
            {news && (
              <div className="p-3 rounded-lg" style={{ backgroundColor: "color-mix(in srgb, #EA580C 10%, transparent)", borderLeft: `3px solid ${C.orange}` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.orange }}>{t("ld.recentNews")}</p>
                <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{news}</p>
              </div>
            )}
            {industryTrends && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textDim }}>{t("ld.industryContext")}</p>
                <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{industryTrends}</p>
              </div>
            )}
            {social.map((s, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-xl" style={{ backgroundColor: C.bg }}>
                <div className="w-8 h-8 rounded-full grid place-items-center shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)` }}>
                  {s.platform === "LinkedIn" ? <LinkedInIcon size={14} /> : <span style={{ fontSize: 14 }}>🏢</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold mb-0.5" style={{ color: gold }}>{s.platform}</p>
                  <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{s.content}</p>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyLine>{t("co.noSignals")}</EmptyLine>}
      </Card>

      {/* Source metadata — collapsed, tertiary */}
      {sourceMeta.length > 0 && (
        <Card>
          <SectionHeader title={t("co.sourceMeta")} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {sourceMeta.map((m, i) => (
              <div key={i}>
                <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{m.label}</p>
                <p className="text-[12.5px] font-medium break-words" style={{ color: C.textBody }}>{m.value}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
