// One prominent highlight that replaces the 4-line Insights box. Instead of
// showing 4 quiet bullets, we surface THE single most important signal of
// the period and give it real visual weight. Quality over quantity.
//
// Hidden entirely when there's nothing notable — the absence of the banner
// is itself a signal ("everything's normal, nothing to react to").

import { CheckCircle2, AlertTriangle, Lightbulb, Sparkles } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type Tone = "positive" | "warning" | "neutral";

export default function HighlightCallout({
  tone,
  eyebrow,
  text,
}: {
  tone: Tone;
  /** Small uppercase eyebrow label above the headline ("HIGHLIGHT", "ALERT", ...). */
  eyebrow: string;
  /** Single-sentence headline — the operator should be able to read this from across the room. */
  text: string;
}) {
  const palette =
    tone === "warning"  ? { color: C.red,   bg: `color-mix(in srgb, ${C.red}   8%, transparent)`,  Icon: AlertTriangle, accentBar: C.red }
  : tone === "positive" ? { color: C.green, bg: `color-mix(in srgb, ${C.green} 8%, transparent)`,  Icon: CheckCircle2,  accentBar: C.green }
  : /* neutral */         { color: gold,    bg: `color-mix(in srgb, ${gold}   8%, transparent)`,  Icon: Lightbulb,     accentBar: gold };
  const Icon = palette.Icon;

  return (
    <section
      className="relative rounded-2xl border overflow-hidden flex items-center gap-4 px-5 py-4"
      style={{ borderColor: C.border, background: palette.bg, borderLeft: `3px solid ${palette.accentBar}` }}
    >
      <span
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: `color-mix(in srgb, ${palette.color} 16%, transparent)`,
          color: palette.color,
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${palette.color} 22%, transparent)`,
        }}
      >
        <Icon size={18} strokeWidth={2.2} />
      </span>

      <div className="flex-1 min-w-0">
        <p
          className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1"
          style={{ color: palette.color }}
        >
          {eyebrow}
        </p>
        <p
          className="text-[15px] leading-snug font-medium"
          style={{ color: C.textPrimary }}
        >
          {text}
        </p>
      </div>

      {/* Sparkle accent — only for the positive tone to add a touch of life
          without crossing into "gamified". Skipped on warning/neutral. */}
      {tone === "positive" && (
        <Sparkles size={14} className="shrink-0 hidden sm:inline" style={{ color: palette.color, opacity: 0.55 }} />
      )}
    </section>
  );
}
