// Chapter divider — a self-contained banner card that lives inside the page
// padding (no negative margins, no overflow risk). The banner IS the section
// break: a horizontal gold-tinted strip with the chapter number, title, and
// description. Heavier than a SectionHeader so the eye registers it as a
// hierarchy jump, lighter than a full card-wrap so the content below still
// breathes.
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
  id: string;
  number: number;
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  description: string;
}) {
  return (
    <header
      id={id}
      className="relative scroll-mt-20 rounded-2xl border overflow-hidden mt-4"
      style={{
        borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`,
        background: `linear-gradient(135deg,
          color-mix(in srgb, ${gold} 7%, ${C.card}) 0%,
          ${C.card} 65%)`,
        boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 18%, transparent), 0 6px 20px color-mix(in srgb, ${gold} 6%, transparent)`,
      }}
    >
      {/* Left-edge accent — gold vertical bar that anchors the banner */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{
          background: `linear-gradient(180deg, ${gold} 0%, color-mix(in srgb, ${gold} 60%, transparent) 100%)`,
        }}
      />

      <div className="relative flex items-center gap-4 px-5 py-4 pl-6">
        {Icon && (
          <span
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`,
              color: "#1A1505",
              boxShadow: `0 4px 12px color-mix(in srgb, ${gold} 26%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
            }}
          >
            <Icon size={18} />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p
            className="text-[10.5px] font-bold uppercase tracking-[0.22em] inline-flex items-center gap-2"
            style={{ color: gold }}
          >
            <span className="tabular-nums opacity-75">{String(number).padStart(2, "0")}</span>
            <span className="w-3 h-px" style={{ background: `color-mix(in srgb, ${gold} 50%, transparent)` }} aria-hidden />
            <span>{title}</span>
          </p>
          <p
            className="text-[13px] mt-1.5 max-w-[720px]"
            style={{ color: C.textMuted }}
          >
            {description}
          </p>
        </div>
      </div>
    </header>
  );
}
