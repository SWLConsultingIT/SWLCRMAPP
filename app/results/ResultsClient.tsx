"use client";

import { useState } from "react";
import { C } from "@/lib/design";
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
  const [tab, setTab] = useState<"won" | "lost" | "renurture">(
    wonLeads.length > 0 ? "won" : lostLeads.length > 0 ? "lost" : "renurture",
  );

  const tabs = [
    { key: "won"       as const, label: "Won",        count: wonLeads.length,         color: C.green, icon: Trophy },
    { key: "lost"      as const, label: "Lost",       count: lostLeads.length,        color: C.red,   icon: X },
    { key: "renurture" as const, label: "Re-nurture", count: renurturingLeads.length, color: gold,    icon: RefreshCw },
  ];

  return (
    <div className="w-full">
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map(t => {
          const isActive = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-[color,background-color] relative whitespace-nowrap"
              style={{
                color: isActive ? t.color : C.textMuted,
                backgroundColor: isActive ? `color-mix(in srgb, ${t.color} 6%, transparent)` : "transparent",
              }}
            >
              <Icon size={13} />
              {t.label}
              {t.count > 0 && (
                <span
                  className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: isActive ? `color-mix(in srgb, ${t.color} 15%, transparent)` : C.cardHov,
                    color: isActive ? t.color : C.textDim,
                  }}
                >
                  {t.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: t.color }} />}
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
