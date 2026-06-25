"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { C } from "@/lib/design";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function CompanyTabs({
  tabs,
  children,
}: {
  tabs: { label: string; count?: number }[];
  children: React.ReactNode[];
}) {
  // Deep-link a tab via ?tab=<label-slug> (e.g. ?tab=calls) so a call entry in
  // the Conversation can jump straight to the Calls tab.
  const params = useSearchParams();
  const want = params.get("tab");
  const initial = want ? Math.max(0, tabs.findIndex((t) => slug(t.label) === slug(want))) : 0;
  const [active, setActive] = useState(initial);
  // Collapsible: the tab content can be folded away (chevron on the right).
  // Picking a tab always re-opens it so switching never lands on a blank panel.
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <div className="flex items-center gap-6 px-6 border-t" style={{ borderColor: C.border }}>
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => { setActive(i); setCollapsed(false); }}
            className="text-sm font-medium py-3 relative transition-colors"
            style={{ color: active === i && !collapsed ? C.textPrimary : C.textMuted }}
          >
            {tab.label}{tab.count !== undefined ? ` (${tab.count})` : ""}
            {active === i && !collapsed && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ backgroundColor: "var(--brand, #c9a83a)" }} />
            )}
          </button>
        ))}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="ml-auto flex items-center gap-1 text-xs font-semibold py-3 transition-colors"
          style={{ color: C.textMuted }}
          aria-label={collapsed ? "Expand section" : "Collapse section"}
        >
          {collapsed ? "Expand" : "Collapse"}
          <ChevronDown size={14} style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }} />
        </button>
      </div>

      {!collapsed && (
        <div className="mt-6">
          {children[active]}
        </div>
      )}
    </>
  );
}
