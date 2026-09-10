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

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { C } from "@/lib/design";
import { gold, Pick } from "./ui";
import type { OverviewData, TabsData } from "@/lib/console-data";
import { ConsoleProvider, useD } from "./ctx";
import { TABS, type Tab } from "./tabs-data";

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

function Controls({ tab, period, setPeriod }: { tab: Tab; period: string; setPeriod: (p: string) => void }) {
  const D = useD();
  const [camp, setCamp] = useState(D.filters.campaigns[0]);
  const [icp, setIcp] = useState(D.filters.icps[0]);
  const [seller, setSeller] = useState(D.filters.sellers[0]);
  const on = APPLIES[tab];
  const active = [
    on.includes("campaign") && camp !== D.filters.campaigns[0],
    on.includes("icp") && icp !== D.filters.icps[0],
    on.includes("seller") && seller !== D.filters.sellers[0],
  ].filter(Boolean).length;

  return (
    <div className="sticky top-0 z-40 py-3 flex items-center gap-2.5 flex-wrap"
      style={{ backgroundColor: `color-mix(in srgb, ${C.bg} 92%, transparent)`, backdropFilter: "blur(12px)" }}>
      <div className="inline-flex rounded-full border overflow-hidden" style={{ borderColor: C.border }}>
        {D.period.presets.map(p => (
          <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1 font-medium"
            style={{ fontSize: 12.5, backgroundColor: p === period ? gold : "transparent", color: p === period ? "#1A1405" : C.textBody }}>
            {p}
          </button>
        ))}
      </div>
      <button onClick={() => setPeriod("Custom")} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium"
        style={{ fontSize: 12.5, borderColor: period === "Custom" ? gold : C.border, color: period === "Custom" ? gold : C.textBody }}>
        <CalendarDays size={12} /> {period === "Custom" ? D.period.range : "Custom"}
      </button>

      {on.length > 0 && <span className="w-px h-4" style={{ backgroundColor: C.border }} />}
      {on.includes("campaign") && <Pick label="Campaign" options={D.filters.campaigns} value={camp} onChange={setCamp} />}
      {on.includes("icp") && <Pick label="ICP" options={D.filters.icps} value={icp} onChange={setIcp} />}
      {on.includes("seller") && <Pick label="Seller" options={D.filters.sellers} value={seller} onChange={setSeller} />}
      {active > 0 && (
        <button onClick={() => { setCamp(D.filters.campaigns[0]); setIcp(D.filters.icps[0]); setSeller(D.filters.sellers[0]); }}
          className="inline-flex items-center gap-1 font-medium" style={{ fontSize: 12, color: C.textMuted }}>
          <X size={11} /> Clear
        </button>
      )}
      {tab === "Portfolio" && (
        <span style={{ fontSize: 11, color: C.textDim }}>filters apply within one client — not on this tab</span>
      )}

      <div className="flex-1" />
      <span style={{ fontSize: 11.5, color: C.textDim }}>{D.period.range}</span>
    </div>
  );
}

export default function Shell({ D, T, hero }: { D: OverviewData; T: TabsData; hero?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("Overview");
  // The window is chosen on the server and arrives with the data, so the
  // label describes what was actually measured rather than what a local
  // dropdown thinks. Changing it navigates; it does not re-slice in place.
  const [period, setPeriod] = useState(D.period.label);
  const label = D.period.range;

  const Body = { Overview, ICPs: Icps, Campaigns, Channels, Sellers, Portfolio }[tab];

  return (
    <ConsoleProvider value={{ D, T }}>
    <div className="p-4 sm:p-6 w-full">
      {/* ONE grid. The hero used to run full-bleed while the analysis sat in
          a narrower centred column, so the page had two different left edges
          and read as broken. Hero and content now share the same column. */}
      <div className="mx-auto w-full" style={{ maxWidth: 1180, paddingBottom: 64 }}>

        {hero}

        {/* tabs — names, one underline, no chapter numerals */}
        <nav className="flex items-center gap-1 mt-5" style={{ borderBottom: `1px solid ${C.border}` }} role="tablist">
          {TABS.map(t => {
            const on = t === tab;
            return (
              <button key={t} role="tab" aria-selected={on} onClick={() => setTab(t)}
                className="px-3 py-2 font-medium relative"
                style={{ fontSize: 13, color: on ? C.textPrimary : C.textMuted }}>
                {t}
                {t === "Portfolio" && (
                  <span className="ml-1.5 align-middle rounded-full px-1.5 py-px font-bold"
                    style={{ fontSize: 8.5, border: `1px solid ${C.border}`, color: C.textDim }}>SA</span>
                )}
                {on && <span aria-hidden className="absolute left-2 right-2 -bottom-px" style={{ height: 2, backgroundColor: gold, borderRadius: 2 }} />}
              </button>
            );
          })}
        </nav>

        <Controls tab={tab} period={period} setPeriod={setPeriod} />

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
