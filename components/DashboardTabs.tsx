"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { LayoutDashboard, BarChart3, Download } from "lucide-react";

const gold = "#C9A83A";

export default function DashboardTabs({ children }: { children: React.ReactNode[] }) {
  const [tab, setTab] = useState(0);

  const tabs = [
    { label: "Overview", icon: LayoutDashboard, color: gold },
    { label: "Reports",  icon: BarChart3,       color: C.accent },
  ];

  return (
    <div>
      <div className="flex items-center gap-0.5 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const active = tab === i;
          const Icon = t.icon;
          return (
            <button
              key={t.label}
              onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all relative rounded-t-lg"
              style={{
                color: active ? t.color : C.textMuted,
                backgroundColor: active ? `${t.color}08` : "transparent",
              }}
            >
              <Icon size={15} style={{ opacity: active ? 1 : 0.7 }} />
              {t.label}
              {active && (
                <div
                  className="absolute bottom-0 left-2 right-2 rounded-t"
                  style={{ height: 3, background: `linear-gradient(90deg, ${t.color}, ${t.color}99)`, borderRadius: "3px 3px 0 0" }}
                />
              )}
            </button>
          );
        })}
        {tab === 1 && (
          <>
            <div className="flex-1" />
            <button
              onClick={() => window.open("/reports/print", "_blank")}
              className="flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold mb-1"
              style={{
                background: `linear-gradient(135deg, ${C.accent}18, ${C.accent}10)`,
                color: C.accent,
                border: `1px solid ${C.accent}35`,
                boxShadow: `0 1px 4px ${C.accent}18`,
              }}
            >
              <Download size={13} /> Export PDF
            </button>
          </>
        )}
      </div>
      <div className="fade-in" key={tab}>
        {Array.isArray(children) && children[tab]}
      </div>
    </div>
  );
}
