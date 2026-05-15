"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, Target, MessageSquare, Mic, Shield, TrendingUp, AlertTriangle, Award, X, Quote, ArrowRight, ListChecks } from "lucide-react";
import { C } from "@/lib/design";

type CoachState = {
  analysis: string | null;
  score: number | null;
  generatedAt: string | null;
  model: string | null;
};

// Section taxonomy — each # heading maps to a visual treatment. Order
// here drives render order; unknown sections fall to a default card at
// the end (Phase 1; if the prompt evolves we revisit).
const SECTION_META: Array<{
  match: RegExp;
  key: string;
  label: string;
  icon: typeof Sparkles;
  tint: "neutral" | "good" | "bad" | "info" | "warning";
  defaultOpen?: boolean;
}> = [
  { match: /^CALL SCORE/i,                        key: "score",         label: "Score",                       icon: Sparkles,       tint: "neutral", defaultOpen: true },
  { match: /^EXECUTIVE ASSESSMENT/i,              key: "assessment",    label: "Executive Assessment",        icon: Sparkles,       tint: "neutral", defaultOpen: true },
  { match: /^WHAT THE SELLER DID WELL/i,          key: "wins",          label: "What worked",                 icon: ThumbsUp,       tint: "good",    defaultOpen: true },
  { match: /^BIGGEST MISSED OPPORTUNITIES/i,      key: "misses",        label: "Missed opportunities",        icon: ThumbsDown,     tint: "bad",     defaultOpen: true },
  { match: /^NEXT CALL IMPROVEMENTS/i,            key: "next_improvements", label: "Top improvements for next call", icon: ListChecks, tint: "info", defaultOpen: true },
  { match: /^IDEAL NEXT STEP/i,                   key: "next_step",     label: "Ideal next step",             icon: ArrowRight,     tint: "info",    defaultOpen: true },
  { match: /^BEST MOMENT OF THE CALL/i,           key: "best_moment",   label: "Best moment",                 icon: Award,          tint: "good" },
  { match: /^WORST MOMENT OF THE CALL/i,          key: "worst_moment",  label: "Worst moment",                icon: AlertTriangle,  tint: "bad" },
  { match: /^BUYING SIGNALS DETECTED/i,           key: "buying_signals", label: "Buying signals",             icon: TrendingUp,     tint: "good" },
  { match: /^MOMENTS THAT INCREASED TRUST/i,      key: "trust_up",      label: "Trust gained",                icon: Shield,         tint: "good" },
  { match: /^MOMENTS THAT REDUCED TRUST/i,        key: "trust_down",    label: "Trust lost",                  icon: Shield,         tint: "bad" },
  { match: /^DISCOVERY ANALYSIS/i,                key: "discovery",     label: "Discovery analysis",          icon: Target,         tint: "neutral" },
  { match: /^POSITIONING ANALYSIS/i,              key: "positioning",   label: "Positioning analysis",        icon: Target,         tint: "neutral" },
  { match: /^COMMUNICATION ANALYSIS/i,            key: "communication", label: "Communication analysis",      icon: Mic,            tint: "neutral" },
  { match: /^OBJECTION HANDLING ANALYSIS/i,       key: "objections",    label: "Objection handling",          icon: Shield,         tint: "neutral" },
  { match: /^WHAT SHOULD HAVE BEEN SAID INSTEAD/i, key: "rewrites",     label: "Better lines to use",         icon: Quote,          tint: "info" },
];

type ParsedSection = { key: string; label: string; icon: typeof Sparkles; tint: "neutral" | "good" | "bad" | "info" | "warning"; defaultOpen: boolean; lines: string[]; };

function parseSections(text: string): ParsedSection[] {
  const out: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      if (current) out.push(current);
      const title = h1[1].trim();
      const meta = SECTION_META.find(s => s.match.test(title));
      current = {
        key: meta?.key ?? `extra-${out.length}`,
        label: meta?.label ?? title,
        icon: meta?.icon ?? Sparkles,
        tint: meta?.tint ?? "neutral",
        defaultOpen: meta?.defaultOpen ?? false,
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) out.push(current);
  return out;
}

function tintColors(tint: ParsedSection["tint"]) {
  switch (tint) {
    case "good":    return { fg: C.green,    bg: `${C.green}10`,   border: `${C.green}30`  };
    case "bad":     return { fg: C.red,      bg: `${C.red}10`,     border: `${C.red}30`    };
    case "info":    return { fg: "#7C3AED",  bg: "#F5F3FF",        border: "#DDD6FE"       };
    case "warning": return { fg: "#D97706",  bg: "#FFFBEB",        border: "#FDE68A"       };
    default:        return { fg: C.textBody, bg: C.bg,             border: C.border        };
  }
}

function scoreColor(score: number | null): { fg: string; bg: string; ring: string } {
  if (score == null) return { fg: C.textMuted, bg: C.surface, ring: C.border };
  if (score >= 8)     return { fg: C.green,    bg: `${C.green}15`, ring: `${C.green}40` };
  if (score >= 6)     return { fg: "#D97706",  bg: "#FEF3C7",      ring: "#FDE68A" };
  return                  { fg: C.red,      bg: C.redLight,     ring: `${C.red}40`   };
}

/**
 * Renders bullets + paragraphs from a section's lines. Bullets stay tight,
 * paragraphs get spacing, plain text wraps.
 */
function renderLines(lines: string[], color: string) {
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string | number) => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`u-${key}`} className="space-y-1 pl-1">
        {bullets.map((b, i) => (
          <li key={i} className="text-xs leading-relaxed flex gap-2" style={{ color: C.textBody }}>
            <span style={{ color, marginTop: 1 }}>•</span>
            <span className="flex-1">{b}</span>
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") { flush(i); return; }
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ""));
    } else if (/^\d+\.\s+/.test(line)) {
      bullets.push(line.replace(/^\d+\.\s+/, ""));
    } else {
      flush(i);
      out.push(
        <p key={i} className="text-xs leading-relaxed my-1" style={{ color: C.textBody }}>{line}</p>
      );
    }
  });
  flush("end");
  return out;
}

function SectionCard({ section, expandable = true }: { section: ParsedSection; expandable?: boolean }) {
  const [open, setOpen] = useState(section.defaultOpen);
  const colors = tintColors(section.tint);
  const Icon = section.icon;
  const isOpen = expandable ? open : true;

  return (
    <div className="rounded-lg border" style={{ borderColor: colors.border, backgroundColor: colors.bg }}>
      <button
        type="button"
        onClick={() => expandable && setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        style={{ cursor: expandable ? "pointer" : "default" }}
      >
        <Icon size={13} style={{ color: colors.fg }} />
        <span className="text-xs font-semibold flex-1" style={{ color: colors.fg }}>
          {section.label}
        </span>
        {expandable && (
          isOpen
            ? <ChevronUp size={12} style={{ color: colors.fg, opacity: 0.6 }} />
            : <ChevronDown size={12} style={{ color: colors.fg, opacity: 0.6 }} />
        )}
      </button>
      {isOpen && (
        <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: colors.border }}>
          {renderLines(section.lines, colors.fg)}
        </div>
      )}
    </div>
  );
}

/**
 * Score + Assessment hero — two-line summary you can scan in <1 second.
 * Wraps the score badge tight to the right of the assessment text.
 */
function Hero({ score, assessmentLines }: { score: number | null; assessmentLines: string[] }) {
  const sc = scoreColor(score);
  const assessmentText = assessmentLines.join(" ").trim();
  return (
    <div className="rounded-xl border p-4 flex items-start gap-4" style={{ borderColor: C.border, backgroundColor: C.card }}>
      <div className="shrink-0 w-14 h-14 rounded-full flex items-center justify-center"
        style={{ backgroundColor: sc.bg, border: `2px solid ${sc.ring}` }}>
        <div className="text-center">
          <p className="text-lg font-bold leading-none tabular-nums" style={{ color: sc.fg }}>
            {score ?? "?"}
          </p>
          <p className="text-[8px] leading-tight" style={{ color: sc.fg, opacity: 0.7 }}>/ 10</p>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: C.textMuted }}>
          AI Coach Assessment
        </p>
        <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>
          {assessmentText || "Analysis complete — see sections below."}
        </p>
      </div>
    </div>
  );
}

export default function CallCoachAnalysis(props: {
  callId: string;
  hasTranscript: boolean;
  initial: CoachState;
}) {
  const [state, setState] = useState<CoachState>(props.initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Open by default RIGHT AFTER generation (so the seller sees the result),
  // but collapsed by default when the analysis was already cached from a
  // prior visit (so the call card stays scannable). justGenerated toggles
  // open the first render after a successful generate().
  const [expanded, setExpanded] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const [autoPolling, setAutoPolling] = useState(false);
  const pollAttemptsRef = useRef(0);

  // Auto-pipeline (2026-05-15): when the transcribe webhook fires it also
  // kicks off coach-analysis in the background. Poll the lightweight GET
  // for up to ~3 min (coach analysis can take 10-20s; pad for slow days).
  useEffect(() => {
    if (!props.hasTranscript || state.analysis) return;
    setAutoPolling(true);
    pollAttemptsRef.current = 0;
    const interval = setInterval(async () => {
      pollAttemptsRef.current += 1;
      if (pollAttemptsRef.current > 45) {
        setAutoPolling(false);
        clearInterval(interval);
        return;
      }
      try {
        const res = await fetch(`/api/calls/${props.callId}`, { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          if (body.coach_analysis) {
            setState({
              analysis: body.coach_analysis,
              score: body.coach_score ?? null,
              generatedAt: body.coach_generated_at ?? null,
              model: body.coach_model ?? null,
            });
            setAutoPolling(false);
            clearInterval(interval);
          }
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => { clearInterval(interval); setAutoPolling(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.callId, props.hasTranscript]);

  async function generate() {
    if (loading || state.analysis) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${props.callId}/coach-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
      setJustGenerated(true);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!props.hasTranscript) return null;

  // Auto-pipeline polling — soft "generating" state until coach analysis
  // lands or we exhaust the poll window.
  if (!state.analysis && autoPolling) {
    return (
      <div className="mt-3 rounded-lg border px-3 py-2.5 flex items-center gap-2"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <Loader2 size={12} className="animate-spin" style={{ color: "#b79832" }} />
        <p className="text-xs" style={{ color: C.textMuted }}>
          <span className="font-semibold" style={{ color: C.textBody }}>AI Coach analysis</span> — generating in background…
        </p>
      </div>
    );
  }

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
          onClick={generate}
          disabled={loading}
          className="text-xs font-medium px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0"
          style={{ backgroundColor: "#b79832", color: "#04070d" }}
        >
          {loading ? (
            <><Loader2 size={11} className="animate-spin" /> Analyzing…</>
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

  // Has analysis — structured render.
  const sections = parseSections(state.analysis);
  const assessment = sections.find(s => s.key === "assessment");
  const wins       = sections.find(s => s.key === "wins");
  const misses     = sections.find(s => s.key === "misses");
  const nextImprovements = sections.find(s => s.key === "next_improvements");
  const nextStep   = sections.find(s => s.key === "next_step");
  const restKeys = new Set([assessment?.key, wins?.key, misses?.key, nextImprovements?.key, nextStep?.key, "score"]);
  const rest = sections.filter(s => !restKeys.has(s.key));

  const isOpen = expanded || justGenerated;
  const sc = scoreColor(state.score);

  // Collapsed: compact header bar with score + assessment teaser + expand toggle.
  // Expanded: full structured render below the same header (now with collapse toggle).
  return (
    <div className="mt-4 space-y-3">
      {/* Header bar — always visible, click anywhere to toggle */}
      <button
        type="button"
        onClick={() => { setExpanded(o => !o); setJustGenerated(false); }}
        className="w-full rounded-xl border px-4 py-3 flex items-center gap-3 text-left transition-[box-shadow] hover:shadow-sm"
        style={{ borderColor: C.border, backgroundColor: C.card }}
      >
        <Sparkles size={14} style={{ color: "#b79832" }} className="shrink-0" />
        <span className="text-xs font-bold" style={{ color: C.textPrimary }}>
          AI Coach Analysis
        </span>
        {state.score !== null && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded shrink-0"
            style={{ backgroundColor: sc.bg, color: sc.fg, border: `1px solid ${sc.ring}` }}>
            {state.score}/10
          </span>
        )}
        <span className="flex-1 min-w-0 text-[11px] truncate" style={{ color: C.textMuted }}>
          {!isOpen && assessment?.lines.join(" ").slice(0, 120)}
          {!isOpen && (assessment?.lines.join(" ").length ?? 0) > 120 && "…"}
        </span>
        {isOpen
          ? <ChevronUp size={14} style={{ color: C.textMuted }} className="shrink-0" />
          : <ChevronDown size={14} style={{ color: C.textMuted }} className="shrink-0" />}
      </button>

      {!isOpen ? null : (<>
      {/* Hero: score + assessment */}
      <Hero score={state.score} assessmentLines={assessment?.lines ?? []} />

      {/* Wins + Misses side by side on wider screens */}
      {(wins || misses) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {wins   && <SectionCard section={wins}   expandable={false} />}
          {misses && <SectionCard section={misses} expandable={false} />}
        </div>
      )}

      {/* Top improvements — usually 5 bullets — full width */}
      {nextImprovements && <SectionCard section={nextImprovements} expandable={false} />}

      {/* Ideal next step — full width */}
      {nextStep && <SectionCard section={nextStep} expandable={false} />}

      {/* Deeper analyses — collapsed by default */}
      {rest.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold mt-2" style={{ color: C.textDim }}>
            More detail
          </p>
          {rest.map(s => <SectionCard key={s.key} section={s} />)}
        </div>
      )}
      </>)}
    </div>
  );
}
