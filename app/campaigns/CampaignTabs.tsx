"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { C } from "@/lib/design";
import { Megaphone, PlusCircle, FileText } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

// Map URL ?tab=<slug> to tab index. Keeps deep-links shareable (and lets the
// Command Palette + the legacy /campaigns/new redirect open the New Flow
// tab directly without an intermediate landing page).
const TAB_SLUGS = ["active", "new", "templates"] as const;
type TabSlug = typeof TAB_SLUGS[number];

export default function CampaignTabs({ readyCount, activeCount, children }: {
  readyCount: number;
  activeCount: number;
  children: React.ReactNode[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const initial = (() => {
    const slug = sp.get("tab") as TabSlug | null;
    const idx = slug ? TAB_SLUGS.indexOf(slug) : -1;
    return idx >= 0 ? idx : 0;
  })();
  const [tab, setTab] = useState(initial);

  // Keep tab state and URL in sync — if the user clicks a tab, the URL
  // updates so a refresh / share preserves the view, and if a server-side
  // navigation lands here with ?tab=new the right tab is already selected.
  useEffect(() => {
    const slug = sp.get("tab") as TabSlug | null;
    const idx = slug ? TAB_SLUGS.indexOf(slug) : -1;
    if (idx >= 0 && idx !== tab) setTab(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  function selectTab(i: number) {
    setTab(i);
    const params = new URLSearchParams(sp.toString());
    if (i === 0) params.delete("tab");
    else params.set("tab", TAB_SLUGS[i]);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Templates: third tab. Lives here (not in the sidebar) so new users don't
  // see another nav item to learn — they discover templates naturally when
  // they're already on /campaigns. See feature note 2026-05-14.
  // Keep the labels in sync with the page header ("Outreach Flow™"). Naming
  // drift between the hero ("Outreach Flow") and the tab ("Active Campaigns")
  // was a recurring papercut — sellers ended up unsure whether a flow and a
  // campaign were the same thing.
  const tabs = [
    { label: "Active Flows", icon: Megaphone, count: activeCount, color: gold },
    { label: "New Flow", icon: PlusCircle, count: readyCount, color: C.blue },
    { label: "Templates", icon: FileText, count: 0, color: "#7C3AED" },
  ];

  return (
    <div>
      <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const active = tab === i;
          const Icon = t.icon;
          return (
            <button key={t.label} onClick={() => selectTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-[opacity,transform,box-shadow,background-color,border-color] relative"
              style={{ color: active ? t.color : C.textMuted }}>
              <Icon size={15} />
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: active ? `${t.color}15` : C.surface, color: active ? t.color : C.textDim }}>
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
