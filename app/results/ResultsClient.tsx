"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { Trophy, X } from "lucide-react";
import { WonView, LostLeadsView, type LostLead } from "@/components/LeadsCampaignsClient";
import type { OpportunityLead } from "@/components/OpportunitiesTable";

const gold = "var(--brand, #c9a83a)";

type Props = {
  wonLeads: OpportunityLead[];
  lostLeads: LostLead[];
};

// Two-tab Results page: Won and Lost are the only terminal outcomes the
// pipeline produces. Nurture stays in /leads as an in-flight chip (a
// re-engaged lead is still mid-pipeline). View components are reused
// verbatim from LeadsCampaignsClient so this page can't drift in card
// shape, status colors, or recover-action UX.
export default function ResultsClient({ wonLeads, lostLeads }: Props) {
  const [tab, setTab] = useState<"won" | "lost">(wonLeads.length > 0 ? "won" : "lost");

  const tabs = [
    { key: "won"  as const, label: "Won",  count: wonLeads.length,  color: C.green, icon: Trophy },
    { key: "lost" as const, label: "Lost", count: lostLeads.length, color: C.red,   icon: X },
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

      {tab === "won"  && <WonView leads={wonLeads} />}
      {tab === "lost" && <LostLeadsView leads={lostLeads} />}
    </div>
  );
}
