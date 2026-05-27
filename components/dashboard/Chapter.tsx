// Chapter divider for the dashboard's long scroll. Heavier visual weight
// than a SectionHeader so the eye registers it as a hierarchy jump, not
// a row label.
//
// Visual recipe:
//   ─ Full-width gold gradient hairline at the top — the "section break"
//   ─ Embossed gold icon badge (gold gradient fill + shadow halo)
//   ─ Eyebrow "01 · OVERVIEW" in gold caps
//   ─ Large dark title + supporting description
//
// Anchors enable in-page jumps from the sticky ChapterNav.

import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export default function Chapter({
  id,
  number,
  icon: Icon,
  title,
  description,
}: {
  /** Slug used as the section anchor for in-page jump links. */
  id: string;
  /** 1-based ordinal shown as a quiet "01 · OVERVIEW" prefix. */
  number: number;
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  description: string;
}) {
  return (
    <header id={id} className="relative pt-10 pb-2 scroll-mt-20">
      {/* Full-width gold gradient separator — the "section break" mark.
          Stretches edge-to-edge so it reads as a hard transition between
          chapters, not a header decoration tied to the content column. */}
      <div
        aria-hidden
        className="absolute -left-4 sm:-left-6 -right-4 sm:-right-6 top-0 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${gold} 55%, transparent) 30%, ${gold} 50%, color-mix(in srgb, ${gold} 55%, transparent) 70%, transparent 100%)`,
        }}
      />
      {/* Soft gold corner glow — gives the chapter a quiet "spotlight" without
          flooding the whole row with color. */}
      <div
        aria-hidden
        className="absolute -top-6 left-0 w-40 h-32 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at top left, color-mix(in srgb, ${gold} 14%, transparent) 0%, transparent 65%)`,
        }}
      />

      <div className="relative flex items-start gap-4">
        {Icon && (
          <span
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`,
              color: "#1A1505",
              boxShadow: `0 6px 18px color-mix(in srgb, ${gold} 28%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
            }}
          >
            <Icon size={18} />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p
            className="text-[10.5px] font-bold uppercase tracking-[0.22em] mb-1.5 inline-flex items-center gap-2"
            style={{ color: gold }}
          >
            <span className="tabular-nums opacity-70">{String(number).padStart(2, "0")}</span>
            <span className="w-3 h-px" style={{ background: `color-mix(in srgb, ${gold} 50%, transparent)` }} aria-hidden />
            <span>{title}</span>
          </p>
          <h2
            className="text-[22px] font-semibold leading-tight tracking-[-0.02em]"
            style={{ color: C.textPrimary }}
          >
            {title}
          </h2>
          <p
            className="text-[13px] mt-1 max-w-[680px]"
            style={{ color: C.textMuted }}
          >
            {description}
          </p>
        </div>
      </div>
    </header>
  );
}
