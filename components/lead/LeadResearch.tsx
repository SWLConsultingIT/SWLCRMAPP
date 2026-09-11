"use client";

// Research tab — reorganized from one long vertical scroll of stacked cards into
// a left rail with five focused sections: Deep Dive · LinkedIn · Firmographics &
// Tech · Social · Copilot. Each section reuses the existing research components
// verbatim; only the navigation/layout changed. On narrow widths the rail
// collapses to a horizontal scroll of chips above the content.

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Sparkles, Building2, Share2, Bot } from "lucide-react";
import { LinkedInIcon } from "@/components/SocialIcons";
import { SectionHeader, EmptyLine, ChipCloud } from "@/components/lead/ui";
import LeadSummaryTab from "@/components/LeadSummaryTab";
import LinkedInEnrichment from "@/components/LinkedInEnrichment";
import PersonalizedInfoPanel from "@/components/PersonalizedInfoPanel";
import LeadQA from "@/components/LeadQA";

const gold = "var(--brand, #c9a83a)";

export default function LeadResearch({ lead, leadId }: { lead: any; leadId: string }) {
  const { t } = useLocale();
  const [active, setActive] = useState(0);

  const enr = (lead.enrichment as any) ?? {};
  const techs: string[] = (Array.isArray(lead.organization_technologies) ? lead.organization_technologies : (Array.isArray(enr.technologies) ? enr.technologies : [])) as string[];
  const keywords: string[] = lead.keywords ? String(lead.keywords).split(",").map((k: string) => k.trim()).filter(Boolean) : (Array.isArray(enr.keywords) ? enr.keywords : []);
  const career: string[] = lead.primary_career ? String(lead.primary_career).split("\n").filter(Boolean) : [];
  const websiteServices: string[] = lead.website_summary ? String(lead.website_summary).split(",").map((s: string) => s.trim()).filter(Boolean) : [];
  const hasTechnical = techs.length > 0 || keywords.length > 0 || career.length > 0 || websiteServices.length > 0 || !!lead.recent_website_news || !!lead.industry_trends;
  const hasPersonalized = enr && typeof enr === "object" && Object.keys(enr).length > 0;

  const social = [
    lead.recent_linkedin_post && { platform: "LinkedIn", icon: <LinkedInIcon size={15} />, color: "#0A66C2", content: String(lead.recent_linkedin_post) },
    lead.recent_ig_post && { platform: "Instagram", icon: <span style={{ fontSize: 14 }}>📸</span>, color: "#E1306C", content: String(lead.recent_ig_post) },
    lead.twitter_last_posts && { platform: "X / Twitter", icon: <span style={{ fontSize: 13, fontWeight: 800 }}>𝕏</span>, color: C.textPrimary, content: Array.isArray(lead.twitter_last_posts) ? lead.twitter_last_posts.join(" · ") : String(lead.twitter_last_posts) },
    lead.company_posts_content && { platform: t("ld.companyPost"), icon: <span style={{ fontSize: 14 }}>🏢</span>, color: gold, content: String(lead.company_posts_content) },
  ].filter(Boolean) as { platform: string; icon: any; color: string; content: string }[];

  const firmoTech = (
    <div className="space-y-5">
      <PersonalizedInfoPanel enrichment={lead.enrichment} leadId={leadId} companyName={lead.company_name} />
      {hasTechnical && (
        <Card>
          <SectionHeader title={t("ld2.technical")} />
          <div className="space-y-4">
            <ChipCloud label={t("ld.technologies")} items={techs} tone="blue" />
            <ChipCloud label={t("ld.keywords")} items={keywords} tone="gold" />
            {websiteServices.length > 0 && <ChipCloud label={t("ld.services")} items={websiteServices} tone="blue" initial={12} />}
            {career.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>{t("ld.careerEducation")}</p>
                <ul className="space-y-1">
                  {career.map((c, i) => <li key={i} className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>• {c.replace(/^[•\-]\s*/, "")}</li>)}
                </ul>
              </div>
            )}
            {lead.industry_trends && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>{t("ld.industryContext")}</p>
                <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{lead.industry_trends}</p>
              </div>
            )}
            {lead.recent_website_news && (
              <div className="p-3 rounded-lg" style={{ backgroundColor: "color-mix(in srgb, #EA580C 10%, transparent)", borderLeft: `3px solid ${C.orange}` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.orange }}>{t("ld.recentNews")}</p>
                <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{lead.recent_website_news}</p>
              </div>
            )}
          </div>
        </Card>
      )}
      {!hasTechnical && !hasPersonalized && <EmptyLine>{t("ld2.research.empty")}</EmptyLine>}
    </div>
  );

  const socialView = (
    <Card>
      <SectionHeader title={t("ld2.research.social")} />
      {social.length > 0 ? (
        <div className="space-y-3">
          {social.map((p, i) => (
            <div key={i} className="flex gap-3 p-3 rounded-xl" style={{ backgroundColor: C.bg }}>
              <div className="w-8 h-8 rounded-full grid place-items-center shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${p.color} 12%, transparent)` }}>{p.icon}</div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold mb-0.5" style={{ color: p.color }}>{p.platform}</p>
                <p className="text-[13px] leading-relaxed" style={{ color: C.textBody }}>{p.content}</p>
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyLine>{t("ld.noSocial")}</EmptyLine>}
    </Card>
  );

  const sections: { key: string; label: string; icon: ReactNode; node: ReactNode }[] = [
    { key: "deep", label: t("ld2.research.deepDive"), icon: <Sparkles size={15} />, node: <LeadSummaryTab leadId={leadId} initialSummary={lead.ai_summary ?? null} initialGeneratedAt={lead.ai_summary_at ?? null} accent={gold} /> },
    { key: "linkedin", label: t("ld2.research.linkedin"), icon: <LinkedInIcon size={14} />, node: <LinkedInEnrichment leadId={leadId} /> },
    { key: "firmo", label: t("ld2.research.firmoTech"), icon: <Building2 size={15} />, node: firmoTech },
    { key: "social", label: t("ld2.research.social"), icon: <Share2 size={15} />, node: socialView },
    { key: "copilot", label: t("ld2.research.copilot"), icon: <Bot size={15} />, node: <LeadQA leadId={leadId} initialHistory={(lead as any).ai_chat ?? null} accent={C.green} /> },
  ];

  return (
    <div className="md:grid md:grid-cols-[190px_1fr] md:gap-5">
      {/* Rail — vertical on desktop, horizontal scroll on mobile */}
      <nav className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-2 md:pb-0 mb-2 md:mb-0">
        {sections.map((s, i) => {
          const on = active === i;
          return (
            <button key={s.key} type="button" onClick={() => setActive(i)}
              className="flex items-center gap-2.5 text-[13px] font-semibold rounded-lg px-3 py-2.5 whitespace-nowrap transition-colors shrink-0 text-left"
              style={{
                backgroundColor: on ? `color-mix(in srgb, ${gold} 12%, transparent)` : "transparent",
                color: on ? (C.textPrimary) : C.textMuted,
              }}>
              <span className="w-6 h-6 rounded-md grid place-items-center shrink-0"
                style={{ backgroundColor: on ? gold : C.surface, color: on ? "#1a1505" : C.textMuted, border: on ? "none" : `1px solid ${C.border}` }}>
                {s.icon}
              </span>
              {s.label}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0">{sections[active].node}</div>
    </div>
  );
}
