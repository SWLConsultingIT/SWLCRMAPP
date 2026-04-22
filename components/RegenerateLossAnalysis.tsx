"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

export default function RegenerateLossAnalysis({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    try {
      await fetch(`/api/leads/${leadId}/loss-analysis`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handle} disabled={loading}
      className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded border transition-opacity hover:opacity-80 disabled:opacity-50"
      style={{ borderColor: "#7C3AED30", color: "#7C3AED", backgroundColor: "#F5F3FF" }}>
      {loading
        ? <><Loader2 size={10} className="animate-spin" /> Regenerating…</>
        : <><RefreshCw size={10} /> Regenerate</>}
    </button>
  );
}
