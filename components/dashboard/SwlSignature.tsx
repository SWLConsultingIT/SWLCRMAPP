// SWL Consulting signature — a discrete branding footer used on every
// analytics surface (main dashboard + ICP/Campaign/Seller drill-downs).
// Same external logo asset the sidebar uses, but rendered inline-friendly
// (dark glyph that works on light surfaces).
//
// Three parts:
//   ─ left: micro caption explaining what's being signed (locale-aware)
//   ─ middle: thin divider line for visual rhythm
//   ─ right: "Powered by" + SWL wordmark + sales-engine tagline

import Image from "next/image";
import { C } from "@/lib/design";

const LOGO_SRC = "https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png";
const gold = "var(--brand, #c9a83a)";

export default function SwlSignature({
  caption,
  tagline,
}: {
  /** Locale-aware caption, e.g. "Métricas en vivo · no cacheadas" or "Live metrics". */
  caption: string;
  /** Locale-aware tagline under the wordmark, e.g. "Sales Engine · Analytics". */
  tagline: string;
}) {
  return (
    <footer
      className="flex items-center gap-4 pt-6 pb-3 mt-4 border-t"
      style={{ borderColor: C.border }}
    >
      <span
        className="text-[10.5px] tabular-nums"
        style={{ color: C.textDim }}
      >
        {caption}
      </span>

      <span
        className="hidden sm:block flex-1 h-px"
        style={{
          background: `linear-gradient(90deg, ${C.border}, transparent 45%, transparent 55%, ${C.border})`,
        }}
        aria-hidden
      />

      <div className="flex items-center gap-2 ml-auto sm:ml-0">
        <span
          className="text-[8.5px] font-bold tracking-[0.22em] uppercase"
          style={{ color: gold }}
        >
          Powered by
        </span>

        <div className="flex items-center gap-1.5">
          <Image
            src={LOGO_SRC}
            alt="SWL Consulting"
            width={56}
            height={14}
            className="h-3.5 w-auto object-contain"
            style={{
              filter: "var(--swl-logo-filter, none)",
            }}
            unoptimized
            priority={false}
          />
          <span
            className="hidden md:inline text-[10.5px] font-medium pl-2 ml-1 border-l"
            style={{ color: C.textMuted, borderColor: C.border }}
          >
            {tagline}
          </span>
        </div>
      </div>
    </footer>
  );
}
