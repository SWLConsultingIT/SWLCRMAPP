"use client";

// ─────────────────────────────────────────────────────────────────────────
// The page chrome shared by all six tabs: title, tab bar, period, filters.
//
// The tab bar is deliberately plain. The live one numbers its tabs like
// chapters, which implies a reading order that nobody follows — people
// arrive at the tab that matches the question they already have. So: names,
// one underline, no numerals.
//
// The filter row is shared, but not every filter applies to every tab. A
// control that would do nothing is not rendered rather than rendered inert
// — the live bar shows Seller on the Portfolio tab, where it cannot apply.
// ─────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, X } from "lucide-react";
import { C } from "@/lib/design";
import { gold, Pick } from "./ui";
import type { OverviewData, TabsData } from "@/lib/console-data";
import { ConsoleProvider, useD } from "./ctx";
import { VISIBLE_TABS, HIDDEN_TABS, type Tab } from "./tabs-data";

import Overview from "./Console";
import Icps from "./Icps";
import Campaigns from "./Campaigns";
import Channels from "./Channels";
import Sellers from "./Sellers";
import Portfolio from "./Portfolio";

/** Which filters mean anything on which tab. Portfolio is cross-tenant, so
 *  a campaign / ICP / seller picker there would be filtering by something
 *  that belongs to one client. */
const APPLIES: Record<Tab, Array<"campaign" | "icp" | "seller">> = {
  Overview: ["campaign", "icp", "seller"],
  ICPs: ["campaign", "seller"],
  Campaigns: ["icp", "seller"],
  Channels: ["campaign", "icp", "seller"],
  Sellers: ["campaign", "icp"],
  Portfolio: [],
};

/** Business-day key in America/Argentina/Buenos_Aires, the window everything
 *  else is measured in. A preset computed in UTC would slide the boundary. */
const bizDay = (ms: number) => new Date(ms - 180 * 60_000).toISOString().slice(0, 10);

/** from/to for each preset, or null for "All time". */
function presetRange(p: string): { from: string; to: string } | null {
  const now = Date.now();
  const to = bizDay(now);
  if (p === "All time") return null;
  const days = p === "Today" ? 1 : p === "7 days" ? 7 : p === "30 days" ? 30 : p === "90 days" ? 90 : 30;
  return { from: bizDay(now - (days - 1) * 86_400_000), to };
}

function Controls({ tab }: { tab: Tab }) {
  const D = useD();
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const a = D.active;

  // Every control writes the URL and lets the server re-read it. Local state
  // would have been a filter that changes a chip and nothing else — which is
  // exactly what the mock did.
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k); else next.set(k, v);
    }
    start(() => router.push(`?${next.toString()}`, { scroll: false }));
  };

  const setPreset = (p: string) => {
    const r = presetRange(p);
    go({ preset: p, from: r?.from ?? null, to: r?.to ?? null });
  };

  const on = APPLIES[tab] ?? [];
  const active = [
    on.includes("campaign") && a.campaign,
    on.includes("icp") && a.icp,
    on.includes("seller") && a.seller,
  ].filter(Boolean).length;

  return (
    <div className="sticky top-0 z-40 py-3 flex items-center gap-2.5 flex-wrap"
      style={{ backgroundColor: `color-mix(in srgb, ${C.bg} 92%, transparent)`, backdropFilter: "blur(12px)",
               opacity: pending ? 0.55 : 1, transition: "opacity .15s" }}>
      <div className="inline-flex rounded-full border overflow-hidden" style={{ borderColor: C.border }}>
        {D.period.presets.map(p => {
          const sel = a.preset ? a.preset === p : false;
          return (
            <button key={p} onClick={() => setPreset(p)} className="px-3 py-1 font-medium"
              style={{ fontSize: 12.5, backgroundColor: sel ? gold : "transparent", color: sel ? "#1A1405" : C.textBody }}>
              {p}
            </button>
          );
        })}
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium"
        style={{ fontSize: 12.5, borderColor: C.border, color: C.textBody }}>
        <CalendarDays size={12} /> {D.period.range}
      </span>

      {on.length > 0 && <span className="w-px h-4" style={{ backgroundColor: C.border }} />}
      {on.includes("campaign") && <Pick label="Campaign" options={D.filters.campaigns} value={a.campaign} onChange={v => go({ campaigns: v })} />}
      {on.includes("icp") && <Pick label="ICP" options={D.filters.icps} value={a.icp} onChange={v => go({ icps: v })} />}
      {on.includes("seller") && <Pick label="Seller" options={D.filters.sellers} value={a.seller} onChange={v => go({ sellers: v })} />}
      {active > 0 && (
        <button onClick={() => go({ campaigns: null, icps: null, sellers: null })}
          className="inline-flex items-center gap-1 font-medium" style={{ fontSize: 12, color: C.textMuted }}>
          <X size={11} /> Clear
        </button>
      )}

      <div className="flex-1" />
      <span style={{ fontSize: 11.5, color: C.textDim }}>{pending ? "loading…" : D.period.range}</span>
    </div>
  );
}

export default function Shell({ D, T, hero }: { D: OverviewData; T: TabsData; hero?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("Overview");
  // The window is chosen on the server and arrives with the data, so the
  // label describes what was actually measured rather than what a local
  // dropdown thinks. Changing it navigates; it does not re-slice in place.
  const label = D.period.range;

  // Portfolio stays in the map so the component keeps compiling and one
  // line brings it back; it is simply unreachable while hidden.
  const safeTab: Tab = HIDDEN_TABS.includes(tab) ? "Overview" : tab;
  const Body = { Overview, ICPs: Icps, Campaigns, Channels, Sellers, Portfolio }[safeTab];

  return (
    <ConsoleProvider value={{ D, T, goTab: (t) => setTab(t as Tab) }}>
    <div className="p-4 sm:p-6 w-full">
      {/* Same width as every other view — app/page.tsx, /leads, /results all
          use p-4 sm:p-6 w-full. A centred 1180px column left ~250px of dead
          margin either side that no other screen has. */}
      <div className="w-full" style={{ paddingBottom: 64 }}>

        {hero}

        {/* tabs — names, one underline, no chapter numerals */}
        <nav className="flex items-center gap-1 mt-5" style={{ borderBottom: `1px solid ${C.border}` }} role="tablist">
          {VISIBLE_TABS.map(t => {
            const on = t === tab;
            return (
              <button key={t} role="tab" aria-selected={on} onClick={() => setTab(t)}
                className="px-3 py-2 font-medium relative"
                style={{ fontSize: 13, color: on ? C.textPrimary : C.textMuted }}>
                {t}
                {on && <span aria-hidden className="absolute left-2 right-2 -bottom-px" style={{ height: 2, backgroundColor: gold, borderRadius: 2 }} />}
              </button>
            );
          })}
        </nav>

        <Controls tab={tab} />

        <Body label={label} />

        <p className="mt-16 text-center" style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.7 }}>
          Growth Engine · live data · {D.period.range}<br />
          Every figure is scoped to ACTIVITY in the period, not to leads loaded in it. Calls count distinct physical calls by canonical identity; Unknown is shown beside every rate and never inside it.
        </p>
      </div>
    </div>
    </ConsoleProvider>
  );
}
