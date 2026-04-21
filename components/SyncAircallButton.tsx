"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check } from "lucide-react";
import { C } from "@/lib/design";

export default function SyncAircallButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function sync() {
    setLoading(true);
    setDone(false);
    try {
      await fetch("/api/aircall/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      });
      setDone(true);
      router.refresh();
      setTimeout(() => setDone(false), 2000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={sync}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
      style={{
        borderColor: C.border,
        backgroundColor: done ? "#DCFCE7" : C.card,
        color: done ? "#16A34A" : C.textMuted,
      }}
    >
      {done ? (
        <><Check size={12} /> Synced</>
      ) : (
        <><RefreshCw size={12} className={loading ? "animate-spin" : ""} /> {loading ? "Syncing…" : "Sync from Aircall"}</>
      )}
    </button>
  );
}
