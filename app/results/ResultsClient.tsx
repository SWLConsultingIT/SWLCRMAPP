"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Trophy, X, RefreshCw } from "lucide-react";
import { WonView, LostLeadsView, RenurturingView, type LostLead, type RenurturingLead } from "@/components/LeadsCampaignsClient";
import type { OpportunityLead } from "@/components/OpportunitiesTable";

const gold = "var(--brand, #c9a83a)";

type Props = {
  wonLeads: OpportunityLead[];
  lostLeads: LostLead[];
  renurturingLeads: RenurturingLead[];
};

// Three-tab Results page: Won and Lost are the terminal outcomes, Re-
// nurture sits in between (a lead the pipeline lost but is being given
// a second chance in a fresh campaign). Boss feedback 2026-05-28 (r2):
// "nurture sacalo y ponelo en results, otra view de re-nurture". View
// components are reused verbatim from LeadsCampaignsClient so this page
// can't drift in card shape, status colors, or recover-action UX.
export default function ResultsClient({ wonLeads, lostLeads, renurturingLeads }: Props) {
  const { t } = useLocale();
  const [tab, setTab] = useState<"won" | "lost" | "renurture">(
    wonLeads.length > 0 ? "won" : lostLeads.length > 0 ? "lost" : "renurture",
  );

  const tabs = [
    { key: "won"       as const, label: t("results.tab.won"),       count: wonLeads.length,         color: C.green, icon: Trophy },
    { key: "lost"      as const, label: t("results.tab.lost"),      count: lostLeads.length,        color: C.red,   icon: X },
    { key: "renurture" as const, label: t("results.tab.renurture"), count: renurturingLeads.length, color: gold,    icon: RefreshCw },
  ];

  return (
    <div className="w-full">
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map(tab2 => {
          const isActive = tab === tab2.key;
          const Icon = tab2.icon;
          return (
            <button
              key={tab2.key}
              onClick={() => setTab(tab2.key)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-[color,background-color] relative whitespace-nowrap"
              style={{
                color: isActive ? tab2.color : C.textMuted,
                backgroundColor: isActive ? `color-mix(in srgb, ${tab2.color} 6%, transparent)` : "transparent",
              }}
            >
              <Icon size={13} />
              {tab2.label}
              {tab2.count > 0 && (
                <span
                  className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: isActive ? `color-mix(in srgb, ${tab2.color} 15%, transparent)` : C.cardHov,
                    color: isActive ? tab2.color : C.textDim,
                  }}
                >
                  {tab2.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: tab2.color }} />}
            </button>
          );
        })}
      </div>

      {tab === "won"       && <WonView leads={wonLeads} />}
      {tab === "lost"      && <LostLeadsView leads={lostLeads} />}
      {tab === "renurture" && <RenurturingView leads={renurturingLeads} />}
    </div>
  );
}
