"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

// Sits next to CallButton on the lead detail header. Calls
// /api/leads/[id]/next-in-campaign on mount; if the response carries a
// next leadId, the button is enabled and a click pushes the seller into
// that lead's detail page so they can hit Call again without a round
// trip through /queue. Pre-fetching on mount (vs on hover) is cheap and
// makes the button feel instantaneous after each call ends — sellers
// burning through a list don't tolerate a 200ms wait.
//
// The "remaining" count is shown as a chip on the button so the seller
// has a sense of how much queue is left for this flow.

type NextResponse = {
  next?: { leadId: string; campaignId: string } | null;
  total?: number;
  reason?: string;
};

type Props = {
  leadId: string;
  size?: "sm" | "md";
};

export default function NextCallButton({ leadId, size = "sm" }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const [nextLeadId, setNextLeadId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/leads/${leadId}/next-in-campaign`, { cache: "no-store" })
      .then(r => r.json())
      .then((data: NextResponse) => {
        if (!alive) return;
        if (data.next?.leadId) {
          setNextLeadId(data.next.leadId);
          setRemaining(data.total ?? 0);
          setState("ready");
        } else {
          setState("empty");
        }
      })
      .catch(() => { if (alive) setState("empty"); });
    return () => { alive = false; };
  }, [leadId]);

  if (state === "empty") return null;

  const isLoading = state === "loading";
  const disabled = isLoading || !nextLeadId;

  const padding = size === "sm" ? "px-3 py-2" : "px-4 py-2.5";
  const fontSize = size === "sm" ? "text-[13px]" : "text-sm";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (nextLeadId) router.push(`/leads/${nextLeadId}`); }}
      className={`relative inline-flex items-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-[opacity,transform] disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90 ${padding} ${fontSize}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${C.blue} 12%, transparent)`,
        color: C.blue,
        border: `1px solid color-mix(in srgb, ${C.blue} 30%, transparent)`,
      }}
      title={isLoading ? "Checking for next call…" : `${remaining} call${remaining === 1 ? "" : "s"} left in this flow`}
    >
      {isLoading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
      Next call
      {!isLoading && remaining > 0 && (
        <span className="ml-1 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md"
          style={{
            backgroundColor: `color-mix(in srgb, ${C.blue} 22%, transparent)`,
          }}>
          {remaining}
        </span>
      )}
    </button>
  );
}
