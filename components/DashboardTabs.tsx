"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { LayoutDashboard, BarChart3, Download } from "lucide-react";

const gold = "#C9A83A";

export default function DashboardTabs({ children }: { children: React.ReactNode[] }) {
  const [tab, setTab] = useState(0);

  const tabs = [
    { label: "Overview", icon: LayoutDashboard, color: gold },
    { label: "Reports", icon: BarChart3, color: C.accent },
  ];

  function handleDownload() {
    window.print();
  }

  return (
    <div>
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const active = tab === i;
          const Icon = t.icon;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: active ? t.color : C.textMuted }}>
              <Icon size={15} />
              {t.label}
              {active && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
        {tab === 1 && (
          <>
            <div className="flex-1" />
            <button onClick={handleDownload}
              className="flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 mb-1"
              style={{ backgroundColor: `${C.accent}12`, color: C.accent, border: `1px solid ${C.accent}30` }}>
              <Download size={13} /> Export PDF
            </button>
          </>
        )}
      </div>
      {Array.isArray(children) && children[tab]}
    </div>
  );
}
