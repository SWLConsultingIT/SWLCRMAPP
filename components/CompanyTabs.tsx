"use client";

import { useState } from "react";
import { C } from "@/lib/design";

export default function CompanyTabs({
  tabs,
  children,
}: {
  tabs: { label: string; count?: number }[];
  children: React.ReactNode[];
}) {
  const [active, setActive] = useState(0);

  return (
    <>
      <div className="flex items-center gap-6 px-6 border-t" style={{ borderColor: C.border }}>
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActive(i)}
            className="text-sm font-medium py-3 relative transition-colors"
            style={{ color: active === i ? C.textPrimary : C.textMuted }}
          >
            {tab.label}{tab.count !== undefined ? ` (${tab.count})` : ""}
            {active === i && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ backgroundColor: "var(--brand, #c9a83a)" }} />
            )}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {children[active]}
      </div>
    </>
  );
}
