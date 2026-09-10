"use client";

// Step 3 banner for tailored-mode wizard: shows what fraction of the
// batch's leads have each of the enrichment signals the per-lead
// tailor prompt cares about. Reads from /api/campaigns/wizard-signal-
// stats. No AI cost — pure SELECT counts.

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { Sparkles, FileText, Newspaper, TrendingUp, Cpu, Globe, Target, Phone } from "lucide-react";
import { C } from "@/lib/design";

const gold = C.gold;

type Signals = {
  recent_linkedin_post: number;
  recent_website_news: number;
  industry_trends: number;
  organization_technologies: number;
  website_summary: number;
  company_mission: number;
  call_talking_points: number;
};

type Props = { leadIds: string[] };

// Module scope: `key` addresses the count, `labelKey` is what the row prints.
const ROWS: Array<{ key: keyof Signals; labelKey: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: "recent_linkedin_post", labelKey: "sig.row.liPost", icon: FileText },
  { key: "recent_website_news", labelKey: "sig.row.news", icon: Newspaper },
  { key: "industry_trends", labelKey: "sig.row.trends", icon: TrendingUp },
  { key: "organization_technologies", labelKey: "sig.row.techStack", icon: Cpu },
  { key: "website_summary", labelKey: "sig.row.website", icon: Globe },
  { key: "company_mission", labelKey: "sig.row.mission", icon: Target },
  { key: "call_talking_points", labelKey: "sig.row.talking", icon: Phone },
];

export default function SignalCoverageBanner({ leadIds }: Props) {
  const { t } = useLocale();
  const [stats, setStats] = useState<{ total: number; signals: Signals } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (leadIds.length === 0) { setLoading(false); return; }
    const ac = new AbortController();
    setLoading(true);
    fetch("/api/campaigns/wizard-signal-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds }),
      signal: ac.signal,
    })
      .then(r => r.json())
      .then(d => { if (d && typeof d.total === "number") setStats(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [leadIds]);

  if (loading) {
    return (
      <div className="rounded-2xl border px-5 py-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} style={{ color: gold }} />
          <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("sig.title")}</h3>
        </div>
        <p className="text-xs" style={{ color: C.textMuted }}>{t("sig.loading")}</p>
      </div>
    );
  }

  const total = stats?.total ?? 0;
  if (total === 0) {
    return (
      <div className="rounded-2xl border px-5 py-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-xs" style={{ color: C.textMuted }}>{t("sig.noLeads")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border px-5 py-4"
      style={{
        background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 4%, ${C.card}) 100%)`,
        borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`,
      }}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: gold }} />
          <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("sig.title")}</h3>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
            {t("sig.leadsCount", { n: total })}
          </span>
        </div>
        <p className="text-[11px]" style={{ color: C.textMuted }}>
          {t("sig.whatAiHas")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
        {ROWS.map(row => {
          const count = stats?.signals[row.key] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const Icon = row.icon;
          return (
            <div key={row.key} className="flex items-center gap-3">
              <Icon size={12} />
              <span className="text-[12px] flex-1 truncate" style={{ color: C.textBody }}>{t(row.labelKey)}</span>
              <span className="text-[11px] tabular-nums" style={{ color: C.textMuted }}>
                {count}/{total}
              </span>
              <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: C.surface }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 50 ? gold : C.textMuted }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
