// Chapter divider — the dashboard's hardest visual break.
// Composition: a tall navy ink strip on the left (chapter ordinal in gold),
// gold accent line, then the section title + description on the card surface.
// The strip is the brand anchor; gold pops *off* it instead of fighting the
// content surface. This is the move that makes the dashboard feel like SWL
// rather than a stock template.
//
// No negative margins — banner lives inside the parent's padding so it can
// never overflow horizontally.

import { C, N, T } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export default function Chapter({
  id,
  number,
  icon: Icon,
  title,
  description,
}: {
  id: string;
  number: number;
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  description: string;
}) {
  return (
    <header
      id={id}
      className="relative scroll-mt-24 rounded-2xl border overflow-hidden flex"
      style={{
        borderColor: `color-mix(in srgb, ${gold} 28%, ${C.border})`,
        backgroundColor: C.card,
        boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 22%, transparent), 0 8px 24px color-mix(in srgb, ${N.ink} 6%, transparent)`,
      }}
    >
      {/* Navy ink strip — anchors the banner with the chapter ordinal. The
          gold "01" / "02" sits against deep navy so it reads as a premium
          chapter marker (Linear docs / Stripe issue tracker pattern). */}
      <div
        className="relative flex flex-col items-center justify-center px-4 sm:px-5 shrink-0"
        style={{
          background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
          minWidth: 96,
        }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-[0.24em] mb-1"
          style={{ color: `color-mix(in srgb, ${gold} 70%, white)`, opacity: 0.85 }}
        >
          {/* eyebrow */}
          CH
        </span>
        <span
          className={`${T.numLg}`}
          style={{
            color: N.goldOnDark,
            fontFamily: "var(--font-outfit), system-ui, sans-serif",
            textShadow: `0 1px 0 ${N.ink}`,
          }}
        >
          {String(number).padStart(2, "0")}
        </span>
        {/* Right-edge gold hairline — separates the strip from the content */}
        <span
          aria-hidden
          className="absolute right-0 top-0 bottom-0 w-px"
          style={{ background: `linear-gradient(to bottom, transparent 0%, ${gold} 18%, ${gold} 82%, transparent 100%)` }}
        />
      </div>

      {/* Content side — title + description over the soft gold-tinted card */}
      <div
        className="relative flex-1 min-w-0 flex items-center gap-4 px-5 sm:px-6 py-4 sm:py-5"
        style={{
          background: `linear-gradient(90deg, color-mix(in srgb, ${gold} 9%, ${C.card}) 0%, ${C.card} 70%)`,
        }}
      >
        {Icon && (
          <span
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`,
              color: N.ink,
              boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 28%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
            }}
          >
            <Icon size={18} />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h2
            className={`${T.display}`}
            style={{
              color: C.textPrimary,
              fontFamily: "var(--font-outfit), system-ui, sans-serif",
            }}
          >
            {title}
          </h2>
          <p
            className="text-[13.5px] mt-1.5 max-w-[760px] leading-relaxed"
            style={{ color: C.textMuted }}
          >
            {description}
          </p>
        </div>
      </div>
    </header>
  );
}
