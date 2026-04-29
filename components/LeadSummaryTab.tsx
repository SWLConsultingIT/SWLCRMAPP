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
    <div
      className="rounded-2xl border p-6 relative overflow-hidden"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        borderTop: `3px solid ${gold}`,
        boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
      }}
    >
      {/* Soft gold halo behind the icon */}
      <div
        aria-hidden
        className="absolute -top-12 -right-12 w-36 h-36 rounded-full pointer-events-none opacity-40"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 18%, transparent) 0%, transparent 70%)` }}
      />

      <div className="flex items-center justify-between mb-5 relative">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`,
              boxShadow: `0 0 24px color-mix(in srgb, ${gold} 28%, transparent), inset 0 1px 0 rgba(255,255,255,0.25)`,
            }}
          >
            <Sparkles size={18} style={{ color: "#fff" }} />
          </div>
          <div>
            <h3
              className="text-[15px] font-semibold"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}
            >
              AI Summary
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              {generatedAt
                ? `Generated ${new Date(generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
                : "Not generated yet"}
            </p>
          </div>
        </div>
        {summary && (
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-[opacity,transform,box-shadow] disabled:opacity-50 hover:-translate-y-0.5 hover:shadow-md"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Regenerate
          </button>
        )}
      </div>

      {error && (
        <div
          className="px-3 py-2.5 mb-4 rounded-lg text-xs flex items-center gap-2"
          style={{ backgroundColor: C.redLight, color: C.red, border: `1px solid color-mix(in srgb, ${C.red} 22%, transparent)` }}
        >
          {error}
        </div>
      )}

      {summary ? (
        <div
          className="rounded-xl px-4 py-3.5 relative"
          style={{
            backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 4%, transparent)",
            border: "1px solid color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent)",
          }}
        >
          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>
            {summary}
          </p>
        </div>
      ) : (
        <div className="text-center py-10 relative">
          <p className="text-sm mb-5 max-w-sm mx-auto leading-relaxed" style={{ color: C.textMuted }}>
            Get an AI-generated intelligence brief on this lead — personalized outreach angle based on enrichment data.
          </p>
          <button
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center gap-2 text-xs font-semibold px-5 py-2.5 rounded-lg transition-[opacity,transform,box-shadow] disabled:opacity-50 hover:-translate-y-0.5 hover:shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`,
              color: "#04070d",
              boxShadow: `0 0 18px color-mix(in srgb, ${gold} 22%, transparent)`,
            }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? "Generating…" : "Generate Summary"}
          </button>
        </div>
      )}
    </div>
  );
}
