"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { C } from "@/lib/design";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Accordion sections (formerly horizontal tabs). Each section folds open/closed
// independently — multiple can be open at once. Deep-linking still works via
// ?tab=<label-slug> (e.g. a call entry jumping to the Calls section), which
// opens that section on load.
export default function CompanyTabs({
  tabs,
  children,
}: {
  tabs: { label: string; count?: number }[];
  children: React.ReactNode[];
}) {
  const params = useSearchParams();
  const want = params.get("tab");
  const initial = want ? Math.max(0, tabs.findIndex((t) => slug(t.label) === slug(want))) : 0;
  const [open, setOpen] = useState<Set<number>>(() => new Set([initial]));

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="border-t" style={{ borderColor: C.border }}>
      {tabs.map((tab, i) => {
        const isOpen = open.has(i);
        return (
          <div key={tab.label} className="border-b" style={{ borderColor: C.border }}>
            <button
              onClick={() => toggle(i)}
              className="w-full flex items-center justify-between px-6 py-4 text-left transition-colors hover:opacity-90"
              style={{ color: isOpen ? C.textPrimary : C.textBody }}
              aria-expanded={isOpen}
            >
              <span className="text-sm font-semibold flex items-center gap-2">
                {isOpen && <span className="w-1 h-4 rounded-full" style={{ backgroundColor: "var(--brand, #c9a83a)" }} />}
                {tab.label}
                {tab.count !== undefined && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: C.bg, color: C.textMuted }}>
                    {tab.count}
                  </span>
                )}
              </span>
              <ChevronDown
                size={16}
                style={{ color: C.textMuted, transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
              />
            </button>
            {isOpen && <div className="px-6 pb-6">{children[i]}</div>}
          </div>
        );
      })}
    </div>
  );
}
