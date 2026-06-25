"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

// Scrapes the lead's company website (server-side fetch + Haiku summary, no
// external service) and refreshes so the Company section shows the fresh read.
export default function ScrapeCompanyButton({ leadId, hasScrape }: { leadId: string; hasScrape?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/scrape-company`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Scrape failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={loading}
        className="text-xs font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 hover:shadow-sm"
        style={{ color: gold, border: `1px solid color-mix(in srgb, ${gold} 35%, transparent)`, backgroundColor: `color-mix(in srgb, ${gold} 6%, transparent)` }}
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
        {loading ? "Scraping…" : hasScrape ? "Re-scrape site" : "Scrape site"}
      </button>
      {error && <span className="text-[10px]" style={{ color: C.red }}>{error}</span>}
    </div>
  );
}
