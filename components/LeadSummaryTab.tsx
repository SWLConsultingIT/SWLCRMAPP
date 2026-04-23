"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";

type Props = {
  leadId: string;
  initialSummary: string | null;
  initialGeneratedAt: string | null;
};

export default function LeadSummaryTab({ leadId, initialSummary, initialGeneratedAt }: Props) {
  const router = useRouter();
  const [summary, setSummary] = useState<string | null>(initialSummary);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/summary`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed");
      setSummary(data.summary);
      setGeneratedAt(new Date().toISOString());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate summary");
    } finally {
      setLoading(false);
    }
  }

  const gold = "var(--brand, #c9a83a)";

  return (
    <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }}>
            <Sparkles size={16} style={{ color: "#fff" }} />
          </div>
          <div>
            <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>AI Summary</h3>
            <p className="text-[11px]" style={{ color: C.textMuted }}>
              {generatedAt
                ? `Generated ${new Date(generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
                : "Not generated yet"}
            </p>
          </div>
        </div>
        {summary && (
          <button onClick={generate} disabled={loading}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-opacity disabled:opacity-50"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Regenerate
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 mb-4 rounded-lg text-xs" style={{ backgroundColor: C.redLight, color: C.red }}>
          {error}
        </div>
      )}

      {summary ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>
          {summary}
        </p>
      ) : (
        <div className="text-center py-10">
          <p className="text-sm mb-4" style={{ color: C.textMuted }}>
            Get an AI-generated intelligence brief on this lead — personalized outreach angle based on enrichment data.
          </p>
          <button onClick={generate} disabled={loading}
            className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-opacity disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? "Generating…" : "Generate Summary"}
          </button>
        </div>
      )}
    </div>
  );
}
