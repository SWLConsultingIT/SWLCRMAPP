"use client";

// Step 3 banner for tailored-mode wizard: shows what fraction of the
// batch's leads have each of the enrichment signals the per-lead
// tailor prompt cares about. Reads from /api/campaigns/wizard-signal-
// stats. No AI cost — pure SELECT counts.

import { useEffect, useState } from "react";
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

const ROWS: Array<{ key: keyof Signals; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: "recent_linkedin_post", label: "Recent LinkedIn post", icon: FileText },
  { key: "recent_website_news", label: "Recent company news", icon: Newspaper },
  { key: "industry_trends", label: "Industry trends", icon: TrendingUp },
  { key: "organization_technologies", label: "Tech stack", icon: Cpu },
  { key: "website_summary", label: "Website summary", icon: Globe },
  { key: "company_mission", label: "Company mission", icon: Target },
  { key: "call_talking_points", label: "Pre-call talking points", icon: Phone },
];

export default function SignalCoverageBanner({ leadIds }: Props) {
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
          <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Signal coverage</h3>
        </div>
        <p className="text-xs" style={{ color: C.textMuted }}>Loading…</p>
      </div>
    );
  }

  const total = stats?.total ?? 0;
  if (total === 0) {
    return (
      <div className="rounded-2xl border px-5 py-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-xs" style={{ color: C.textMuted }}>No leads selected for this batch.</p>
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
          <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Signal coverage</h3>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
            {total} leads
          </span>
        </div>
        <p className="text-[11px]" style={{ color: C.textMuted }}>
          What enrichment the per-lead AI has to work with
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
              <span className="text-[12px] flex-1 truncate" style={{ color: C.textBody }}>{row.label}</span>
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
