"use client";

// Account (company) hero — compact identity + the account's headline metrics.
// Values shown here are NOT repeated in the Overview cards below.

import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Factory, MapPin, Globe } from "lucide-react";
import { MetricStrip } from "@/components/lead/ui";

const gold = "var(--brand, #c9a83a)";

export default function CompanyHero({
  name, industry, location, website, metrics,
}: {
  name: string;
  industry: string | null;
  location: string | null;
  website: string | null;
  metrics: {
    employees: string | number | null; revenue: string | null; contacts: number;
    activeCampaigns: number; icp: number | null;
    messages: number; replies: number; positive: number;
  };
}) {
  const { t } = useLocale();
  const positivePct = metrics.replies > 0 ? Math.round((metrics.positive / metrics.replies) * 100) : 0;

  return (
    <div className="rounded-2xl border mb-5 relative overflow-hidden reveal"
      style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
      <div className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, transparent, ${gold} 30%, color-mix(in srgb, ${gold} 72%, white) 50%, ${gold} 70%, transparent)` }} />

      <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center text-lg font-bold text-white shrink-0"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {name[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0">
            <h1 className="text-[19px] sm:text-[22px] font-bold leading-tight truncate"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>{name}</h1>
            <div className="flex items-center gap-x-2 gap-y-0.5 mt-0.5 text-[12.5px] flex-wrap" style={{ color: C.textMuted }}>
              {industry && <span className="inline-flex items-center gap-1"><Factory size={12} /> {industry}</span>}
              {location && <><span style={{ color: C.textDim }}>·</span><span className="inline-flex items-center gap-1"><MapPin size={12} /> {location}</span></>}
            </div>
          </div>
        </div>
        {website && (
          <a href={website} target="_blank" rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-bold shrink-0 self-start md:self-auto"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1a1505" }}>
            <Globe size={14} /> {t("co.viewWebsite")}
          </a>
        )}
      </div>

      <div className="px-4 sm:px-5 py-3 border-t flex items-center gap-x-4 gap-y-2 flex-wrap"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <MetricStrip items={[
          ...(metrics.employees ? [{ label: t("lead.company.employees"), value: metrics.employees }] : []),
          ...(metrics.revenue ? [{ label: t("lead.company.revenue"), value: metrics.revenue }] : []),
          { label: t("ld2.contacts"), value: metrics.contacts },
          { label: t("co.activeCampaigns"), value: metrics.activeCampaigns },
          ...(metrics.icp != null ? [{ label: t("co.icpFit"), value: `${metrics.icp}` }] : []),
        ]} />
        <span className="hidden sm:inline-block h-5 w-px" style={{ backgroundColor: C.border }} aria-hidden />
        <div className="flex items-center gap-x-3 text-[12px]" style={{ color: C.textMuted }}>
          <span><b style={{ color: C.textPrimary }}>{metrics.messages}</b> {t("ld2.metric.messages").toLowerCase()}</span>
          <span><b style={{ color: C.textPrimary }}>{metrics.replies}</b> {t("ld2.metric.replies").toLowerCase()}</span>
          <span style={{ color: metrics.positive > 0 ? C.green : C.textMuted, fontWeight: 700 }}>{positivePct}% {t("ld2.metric.positive").toLowerCase()}</span>
        </div>
      </div>
    </div>
  );
}
