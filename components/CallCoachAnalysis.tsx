"use client";

import { useState } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { C } from "@/lib/design";

type CoachState = {
  analysis: string | null;
  score: number | null;
  generatedAt: string | null;
  model: string | null;
};

/**
 * Renders simple markdown headings + bullets without pulling in a new
 * dependency. The Opus 4.7 output always follows the structured format
 * defined in lib/prompts/call-coach.ts so a light renderer is enough.
 */
function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];

  function flushBullets(key: string | number) {
    if (bulletBuffer.length === 0) return;
    out.push(
      <ul key={`ul-${key}`} className="list-disc pl-5 space-y-1 my-2">
        {bulletBuffer.map((b, i) => (
          <li key={i} className="text-xs leading-relaxed" style={{ color: C.textBody }}>{b}</li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith("# ")) {
      flushBullets(i);
      out.push(
        <h3 key={i} className="text-xs font-bold uppercase tracking-wider mt-4 mb-1.5"
          style={{ color: C.textPrimary, letterSpacing: "0.06em" }}>
          {line.slice(2)}
        </h3>
      );
    } else if (line.startsWith("## ")) {
      flushBullets(i);
      out.push(
        <h4 key={i} className="text-xs font-semibold mt-3 mb-1" style={{ color: C.textPrimary }}>
          {line.slice(3)}
        </h4>
      );
    } else if (/^[-*]\s+/.test(line)) {
      bulletBuffer.push(line.replace(/^[-*]\s+/, ""));
    } else if (line === "") {
      flushBullets(i);
    } else {
      flushBullets(i);
      out.push(
        <p key={i} className="text-xs leading-relaxed my-1.5" style={{ color: C.textBody }}>
          {line}
        </p>
      );
    }
  });
  flushBullets("end");
  return out;
}

function scoreColor(score: number | null): { fg: string; bg: string } {
  if (score == null) return { fg: C.textMuted, bg: C.surface };
  if (score >= 8) return { fg: C.green, bg: C.greenLight };
  if (score >= 6) return { fg: C.orange, bg: C.orangeLight };
  return { fg: C.red, bg: C.redLight };
}

export default function CallCoachAnalysis(props: {
  callId: string;
  hasTranscript: boolean;
  initial: CoachState;
}) {
  const [state, setState] = useState<CoachState>(props.initial);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(force = false) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${props.callId}/coach-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      setState({
        analysis: body.analysis,
        score: body.score,
        generatedAt: body.generatedAt,
        model: body.model,
      });
      setExpanded(true);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!props.hasTranscript) return null;

  // No analysis yet — show "Generate" CTA.
  if (!state.analysis) {
    return (
      <div className="mt-3 rounded-lg border p-3 flex items-center justify-between gap-3"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={14} style={{ color: "#b79832" }} />
          <p className="text-xs" style={{ color: C.textBody }}>
            <span className="font-semibold">AI Coach analysis</span> — actionable feedback on this call
          </p>
        </div>
        <button
          type="button"
          onClick={() => generate(false)}
          disabled={loading}
          className="text-xs font-medium px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0"
          style={{
            backgroundColor: "#b79832",
            color: "#04070d",
          }}
        >
          {loading ? (
            <><Loader2 size={12} className="animate-spin" /> Analyzing…</>
          ) : (
            <>Generate</>
          )}
        </button>
        {error && (
          <p className="text-xs ml-2" style={{ color: C.red }}>{error}</p>
        )}
      </div>
    );
  }

  // Has analysis — show header (score + collapse toggle) + body when expanded.
  const sc = scoreColor(state.score);
  return (
    <div className="mt-3 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }}>
      <div className="flex items-center justify-between gap-3 p-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Sparkles size={14} style={{ color: "#b79832" }} />
          <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>
            AI Coach analysis
          </span>
          {state.score !== null && (
            <span className="text-xs font-bold px-2 py-0.5 rounded shrink-0"
              style={{ backgroundColor: sc.bg, color: sc.fg }}>
              {state.score}/10
            </span>
          )}
          {state.generatedAt && (
            <span className="text-[10px] truncate" style={{ color: C.textMuted }}>
              · {new Date(state.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {expanded ? (
            <ChevronUp size={14} className="ml-auto shrink-0" style={{ color: C.textMuted }} />
          ) : (
            <ChevronDown size={14} className="ml-auto shrink-0" style={{ color: C.textMuted }} />
          )}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); generate(true); }}
          disabled={loading}
          title="Re-generate analysis (costs ~$0.05)"
          className="p-1.5 rounded transition-colors disabled:opacity-50 shrink-0"
          style={{ color: C.textMuted }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#b79832"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.textMuted; }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: C.border }}>
          {error && (
            <p className="text-xs mb-2" style={{ color: C.red }}>{error}</p>
          )}
          {renderMarkdown(state.analysis)}
        </div>
      )}
    </div>
  );
}
