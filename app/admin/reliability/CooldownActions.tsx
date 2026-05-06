"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Zap, PauseCircle } from "lucide-react";
import { C } from "@/lib/design";

// Per-row + per-campaign cooldown actions for the reliability dashboard.
//
// CancelCooldownButton: strips rate-limit metadata so the dispatcher picks
// up the row on the next tick. Use when admin verified manually that the
// underlying provider block has cleared.
//
// PauseCampaignButton: stamps a far-future cooldown on every queued message
// of a campaign (or sibling group) so nothing fires until admin un-pauses.
// The "panic button" the user asked for after watching the dispatcher burn
// 7 invites against a rate-limited Graeme account in successive ticks.

export function CancelCooldownButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/reliability/cancel-cooldown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={go}
        disabled={busy}
        title="Strip cooldown — dispatcher retries on next tick"
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
        style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 12%, transparent)`, color: C.gold }}
      >
        {busy ? <Loader2 size={9} className="animate-spin" /> : <Zap size={9} />}
        {busy ? "Clearing" : "Force retry"}
      </button>
      {err && <span className="text-[10px]" style={{ color: C.red }}>{err}</span>}
    </div>
  );
}

export function PauseCampaignButton({ campaignName, queuedCount }: { campaignName: string; queuedCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function go() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/reliability/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
      setConfirming(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold transition-opacity hover:opacity-80"
        style={{ backgroundColor: C.redLight, color: C.red }}
      >
        <PauseCircle size={9} /> Pause all {queuedCount} queued
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[10px]" style={{ color: C.textBody }}>Pause {queuedCount} queued?</span>
      <button
        onClick={go}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
        style={{ backgroundColor: C.red, color: "white" }}
      >
        {busy ? <Loader2 size={9} className="animate-spin" /> : "Confirm"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
        style={{ backgroundColor: C.surface, color: C.textBody }}
      >
        Cancel
      </button>
      {err && <span className="text-[10px]" style={{ color: C.red }}>{err}</span>}
    </div>
  );
}
