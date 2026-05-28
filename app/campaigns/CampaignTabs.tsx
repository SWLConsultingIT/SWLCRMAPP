"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { C } from "@/lib/design";
import { Megaphone, FileText } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

// Map URL ?tab=<slug> to tab index. Keeps deep-links shareable.
// 2026-05-28 — dropped the "Create New Flow" tab. Flow creation now
// starts from inside a Lead Miner section (button in the section
// header) so the seller always picks an ICP first; the standalone
// "new" tab had no ICP context and led to the wizard with all leads.
const TAB_SLUGS = ["flows", "templates"] as const;
type TabSlug = typeof TAB_SLUGS[number];

export default function CampaignTabs({ activeCount, children }: {
  /** Kept on the signature for API parity with older callers, but no
   *  longer rendered as a tab count after the New Flow tab removal. */
  readyCount?: number;
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

  // Templates lives in /campaigns (not in the sidebar) so users discover it
  // naturally when they're already on the page.
  // Tab labels match the page header ("Outreach Flow™"). Naming drift
  // between the hero and the tabs was a recurring papercut — sellers ended
  // up unsure whether a flow and a campaign were the same thing.
  const tabs = [
    { label: "Flows",     icon: Megaphone, count: activeCount, color: gold },
    { label: "Templates", icon: FileText,  count: 0,           color: "#7C3AED" },
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
