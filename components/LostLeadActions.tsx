"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trophy, Loader2, Check } from "lucide-react";
import { C } from "@/lib/design";

type Props = {
  leadId: string;
};

export default function LostLeadActions({ leadId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"recover" | "won" | null>(null);
  const [done, setDone] = useState<"recover" | "won" | null>(null);

  async function recover() {
    if (busy) return;
    setBusy("recover");
    try {
      const res = await fetch(`/api/leads/${leadId}/recover`, { method: "POST" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Recovery failed" }));
        alert(error || "Recovery failed");
        return;
      }
      setDone("recover");
      setTimeout(() => router.push("/leads"), 900);
    } finally {
      setBusy(null);
    }
  }

  async function markWon() {
    if (busy) return;
    const ok = confirm("Mark this lead as WON? This will promote it to Opportunities and trigger the Odoo sync.");
    if (!ok) return;
    setBusy("won");
    try {
      await fetch(`/api/leads/${leadId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed_won" }),
      });
      setDone("won");
      setTimeout(() => router.push("/opportunities"), 900);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={recover}
        disabled={busy !== null}
        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:opacity-85 disabled:opacity-50"
        style={{
          backgroundColor: done === "recover" ? "#DCFCE7" : C.blueLight,
          color: done === "recover" ? "#16A34A" : C.blue,
          border: `1px solid ${done === "recover" ? "#BBF7D0" : C.blue + "30"}`,
        }}
      >
        {busy === "recover" ? <Loader2 size={12} className="animate-spin" /> :
         done === "recover" ? <Check size={12} /> : <RotateCcw size={12} />}
        {done === "recover" ? "Recovered" : "Recover Lead"}
      </button>

      <button
        onClick={markWon}
        disabled={busy !== null}
        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:opacity-85 disabled:opacity-50"
        style={{
          backgroundColor: done === "won" ? "#16A34A" : "#22C55E",
          color: "#fff",
          boxShadow: done === "won" ? "none" : "0 2px 8px rgba(34,197,94,0.25)",
        }}
      >
        {busy === "won" ? <Loader2 size={12} className="animate-spin" /> :
         done === "won" ? <Check size={12} /> : <Trophy size={12} />}
        {done === "won" ? "Marked as Won" : "Mark as Won"}
      </button>
    </div>
  );
}
