"use client";

// Research tab — enriched context, essentials first / detail on demand. Order:
// Deep-dive (self-generating), LinkedIn Enrichment (kept prominent, not buried),
// Personalized Info, Social & Content, then Technical/raw (collapsed chips with
// "view all"). Reuses the existing research components verbatim.

import { useState } from "react";
import { Card } from "@/components/ui";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { LinkedInIcon } from "@/components/SocialIcons";
import { SectionHeader, EmptyLine } from "@/components/lead/ui";
import LeadSummaryTab from "@/components/LeadSummaryTab";
import LinkedInEnrichment from "@/components/LinkedInEnrichment";
import PersonalizedInfoPanel from "@/components/PersonalizedInfoPanel";
import LeadQA from "@/components/LeadQA";

const gold = "var(--brand, #c9a83a)";

function ChipCloud({ label, items, tone = "blue", initial = 10 }: {
  label: string; items: string[]; tone?: "blue" | "gold"; initial?: number;
}) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, initial);
  const color = tone === "gold" ? gold : C.blue;
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>{label}</p>
      <div className="flex flex-wrap gap-1.5 items-center">
        {shown.map((it) => (
          <span key={it} className="text-[11px] font-medium px-2 py-0.5 rounded-md"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`, color }}>{it}</span>
        ))}
        {items.length > initial && (
          <button onClick={() => setAll(a => !a)} className="text-[11px] font-bold px-1.5" style={{ color: C.blue }}>
            {all ? "− less" : `+ ${items.length - initial} more`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function LeadResearch({ lead, leadId }: { lead: any; leadId: string }) {
  const { t } = useLocale();
  const enr = (lead.enrichment as any) ?? {};
  const techs: string[] = (Array.isArray(lead.organization_technologies) ? lead.organization_technologies : (Array.isArray(enr.technologies) ? enr.technologies : [])) as string[];
  const keywords: string[] = lead.keywords ? String(lead.keywords).split(",").map((k: string) => k.trim()).filter(Boolean) : (Array.isArray(enr.keywords) ? enr.keywords : []);

  const social = [
    lead.recent_linkedin_post && { platform: "LinkedIn", icon: <LinkedInIcon size={15} />, color: "#0A66C2", content: String(lead.recent_linkedin_post) },
    lead.recent_ig_post && { platform: "Instagram", icon: <span style={{ fontSize: 14 }}>📸</span>, color: "#E1306C", content: String(lead.recent_ig_post) },
    lead.twitter_last_posts && { platform: "X / Twitter", icon: <span style={{ fontSize: 13, fontWeight: 800 }}>𝕏</span>, color: C.textPrimary, content: Array.isArray(lead.twitter_last_posts) ? lead.twitter_last_posts.join(" · ") : String(lead.twitter_last_posts) },
    lead.company_posts_content && { platform: t("ld.companyPost"), icon: <span style={{ fontSize: 14 }}>🏢</span>, color: gold, content: String(lead.company_posts_content) },
  ].filter(Boolean) as { platform: string; icon: any; color: string; content: string }[];

  const career: string[] = lead.primary_career ? String(lead.primary_career).split("\n").filter(Boolean) : [];
  const websiteServices: string[] = lead.website_summary ? String(lead.website_summary).split(",").map((s: string) => s.trim()).filter(Boolean) : [];
  const hasTechnical = techs.length > 0 || keywords.length > 0 || career.length > 0 || websiteServices.length > 0 || lead.recent_website_news || lead.industry_trends;

  return (
    <div className="space-y-5">
      {/* Deep-dive — self-generates / shows its own generate CTA when empty */}
      <LeadSummaryTab leadId={leadId} initialSummary={lead.ai_summary ?? null} initialGeneratedAt={lead.ai_summary_at ?? null} accent={gold} />

      {/* LinkedIn enrichment — prominent */}
      <LinkedInEnrichment leadId={leadId} />

      {/* Personalized info (renders null when empty) */}
      <PersonalizedInfoPanel enrichment={lead.enrichment} leadId={leadId} companyName={lead.company_name} />

      {/* Social & Content */}
      <Card>
        <SectionHeader title={t("ld.tab.social")} />
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

      {/* Technical / raw — essentials first, detail on demand */}
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

      {/* Copilot */}
      <LeadQA leadId={leadId} initialHistory={(lead as any).ai_chat ?? null} accent={C.green} />
    </div>
  );
}
