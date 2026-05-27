// AI Insight panel — companion to HeroStat on the Overview chapter.
//
// Visual concept: a dark-navy card matching HeroStat's elevation, with a
// gold "AI / Intelligence" eyebrow, the headline insight as the lead
// (positive / warning / neutral), and up to 2 secondary chips beneath for
// the next ranked insights. The dark surface keeps gold popping; the
// secondary chips fade to navy hairline so the eye knows which insight
// matters most.

import { Sparkles, AlertTriangle, TrendingUp, Activity } from "lucide-react";
import { C, N, T } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type InsightTone = "positive" | "warning" | "neutral";

export type Insight = {
  tone: InsightTone;
  text: string;
};

export default function InsightPanel({
  title,
  insights,
  emptyText,
}: {
  title: string;
  insights: Insight[];
  emptyText: string;
}) {
  const lead = insights[0];
  const rest = insights.slice(1, 3);

  const accentColor = (tone: InsightTone) =>
    tone === "warning" ? "#F2B23E"
    : tone === "positive" ? "#26D07C"
    : N.goldOnDark;

  const Icon = (tone: InsightTone) =>
    tone === "warning" ? AlertTriangle
    : tone === "positive" ? TrendingUp
    : Activity;

  return (
    <div
      className="relative rounded-2xl border overflow-hidden p-5 sm:p-6 flex flex-col"
      style={{
        borderColor: `color-mix(in srgb, ${gold} 26%, ${N.hairline})`,
        background: `linear-gradient(160deg, ${N.ink2} 0%, ${N.ink3} 60%, ${N.stripe} 100%)`,
        minHeight: 260,
        boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 16%, transparent), 0 18px 40px -16px ${N.ink}`,
      }}
    >
      {/* Subtle gold halo top-left for "intelligence" feel */}
      <div
        aria-hidden
        className="absolute -top-20 -left-20 w-64 h-64 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 18%, transparent) 0%, transparent 65%)` }}
      />

      {/* Header */}
      <div className="relative flex items-center gap-2.5">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 70%, white) 100%)`,
            color: N.ink,
            boxShadow: `0 4px 12px color-mix(in srgb, ${gold} 32%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
          }}
        >
          <Sparkles size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <p
            className={`${T.label}`}
            style={{ color: N.goldOnDark, opacity: 0.85 }}
          >
            AI · Insight
          </p>
          <p
            className="text-[12.5px] mt-0.5"
            style={{ color: "color-mix(in srgb, white 65%, transparent)" }}
          >
            {title}
          </p>
        </div>
      </div>

      {/* Lead insight */}
      <div className="relative mt-5 flex-1 flex flex-col">
        {!lead ? (
          <p className="text-[13px] flex-1 flex items-center" style={{ color: "color-mix(in srgb, white 55%, transparent)" }}>
            {emptyText}
          </p>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  backgroundColor: `color-mix(in srgb, ${accentColor(lead.tone)} 18%, transparent)`,
                  color: accentColor(lead.tone),
                }}
              >
                {(() => { const I = Icon(lead.tone); return <I size={13} />; })()}
              </span>
              <p
                className="text-[15px] sm:text-[16px] leading-snug font-semibold flex-1"
                style={{ color: "color-mix(in srgb, white 95%, transparent)", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
              >
                {lead.text}
              </p>
            </div>

            {/* Secondary insight chips */}
            {rest.length > 0 && (
              <div className="mt-auto pt-4 space-y-2" style={{ borderTop: rest.length ? `1px dashed color-mix(in srgb, ${gold} 18%, transparent)` : "none", marginTop: 16 }}>
                {rest.map((it, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5"
                    style={{ color: "color-mix(in srgb, white 70%, transparent)" }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                      style={{ background: accentColor(it.tone) }}
                    />
                    <p className="text-[12px] leading-snug flex-1">{it.text}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
