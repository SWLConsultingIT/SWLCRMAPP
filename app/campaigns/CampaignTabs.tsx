"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { Megaphone, PlusCircle } from "lucide-react";

const gold = "#C9A83A";

export default function CampaignTabs({ readyCount, activeCount, children }: {
  readyCount: number;
  activeCount: number;
  children: React.ReactNode[];
}) {
  const [tab, setTab] = useState(0);

  const tabs = [
    { label: "Active Campaigns", icon: Megaphone, count: activeCount, color: gold },
    { label: "New Campaign", icon: PlusCircle, count: readyCount, color: C.blue },
  ];

  return (
    <div>
      <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const active = tab === i;
          const Icon = t.icon;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: active ? t.color : C.textMuted }}>
              <Icon size={15} />
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: active ? `${t.color}15` : "#F3F4F6", color: active ? t.color : C.textDim }}>
                  {t.count}
                </span>
              )}
              {active && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />
              )}
            </button>
          );
        })}
      </div>

      {Array.isArray(children) && children[tab]}
    </div>
  );
}
