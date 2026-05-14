"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

/**
 * Brief 1-2 sentence call summary. Cheap (Haiku 4.5, ~$0.0005). Runs once
 * per call and the result is cached forever. Click-once button.
 */
export default function CallSummary(props: {
  callId: string;
  hasTranscript: boolean;
  initialSummary: string | null;
  initialGeneratedAt: string | null;
}) {
  const [summary, setSummary] = useState<string | null>(props.initialSummary);
  const [generatedAt, setGeneratedAt] = useState<string | null>(props.initialGeneratedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.hasTranscript) return null;

  async function generate() {
    if (loading || summary) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${props.callId}/summary`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      setSummary(body.summary);
      setGeneratedAt(body.generatedAt);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  // Show cached summary as a clean badge-style block — no button, no clutter.
  if (summary) {
    return (
      <div className="mt-3 rounded-lg p-3 border" style={{ borderColor: `${C.green}30`, backgroundColor: `${C.green}08` }}>
        <div className="flex items-start gap-2">
          <Sparkles size={13} className="mt-0.5 shrink-0" style={{ color: C.green }} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: C.green }}>
              Summary
            </p>
            <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>{summary}</p>
          </div>
        </div>
      </div>
    );
  }

  // No summary yet — show the Generate button.
  return (
    <div className="mt-3 rounded-lg border px-3 py-2 flex items-center justify-between gap-3"
      style={{ borderColor: C.border, backgroundColor: C.bg }}>
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles size={13} style={{ color: C.green }} />
        <p className="text-xs" style={{ color: C.textBody }}>
          <span className="font-semibold">Summary</span> — 1-2 sentence recap
        </p>
      </div>
      <button
        type="button"
        onClick={generate}
        disabled={loading}
        className="text-xs font-medium px-3 py-1 rounded-md inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0"
        style={{ backgroundColor: C.green, color: "#fff" }}
      >
        {loading ? <><Loader2 size={11} className="animate-spin" /> …</> : "Generate"}
      </button>
      {error && <p className="text-[10px] ml-2" style={{ color: C.red }}>{error}</p>}
    </div>
  );
}
