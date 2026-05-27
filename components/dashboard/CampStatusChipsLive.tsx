"use client";

// Instant-feel status chips for the Campaigns leaderboard. The previous
// version used <Link href=...> elements which forced a full server roundtrip
// on every click — the chip waited ~1s to switch state.
//
// This component keeps the URL in sync via router.replace (so the choice is
// shareable and survives reload) BUT applies the row filter client-side
// using an inline <style> block that targets data-camp-status on each tr.
// Result: the chip and the table both update synchronously on click.

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type CampStatusTab = { id: string; label: string; count: number };

export default function CampStatusChipsLive({
  tabs,
  initial,
  baseParams,
}: {
  tabs: CampStatusTab[];
  initial: string;
  /** URL-encoded base param string already including tab=campaigns and any
   * inherited from/to/etc. — the chip just appends its own camp_status. */
  baseParams: string;
}) {
  const router = useRouter();
  const [active, setActive] = useState(initial);
  const [, startTransition] = useTransition();

  // Keep local state in sync if another nav changes the URL (e.g. browser
  // back). Without this the chip can drift from what the URL says.
  useEffect(() => {
    if (initial !== active) setActive(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  function pick(id: string) {
    setActive(id); // synchronous, paints next frame
    startTransition(() => {
      const sp = new URLSearchParams(baseParams);
      if (id === "active") sp.delete("camp_status");
      else sp.set("camp_status", id);
      router.replace(`/?${sp.toString()}`, { scroll: false });
    });
  }

  // CSS: hide rows that don't match the active filter. "all" shows everything.
  const css = active === "all"
    ? `tbody.camp-rows tr[data-camp-status] { display: table-row; }`
    : `tbody.camp-rows tr[data-camp-status]:not([data-camp-status="${active}"]) { display: none; }`;

  return (
    <>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {tabs.map(tab => {
          const on = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => pick(tab.id)}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1.5 transition-colors"
              style={{
                backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : "transparent",
                borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border,
                color: on ? gold : C.textBody,
              }}
            >
              {tab.label}
              <span className="text-[9.5px] tabular-nums px-1 py-0 rounded"
                style={{ background: on ? "transparent" : C.surface, color: on ? gold : C.textDim }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>
      <style dangerouslySetInnerHTML={{ __html: css }} />
    </>
  );
}
