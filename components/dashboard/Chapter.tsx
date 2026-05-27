// Big "chapter divider" used by the dashboard to break the long scroll into
// readable sections (Overview / ICPs / Campaigns / Channels / Sellers /
// Intelligence). Heavier than a SectionHeader so the eye registers it as a
// hierarchy jump, not a row label.
//
// Anatomy: thin hairline rule above, gold-accented icon, large title +
// small description. Inspired by Stripe / Linear docs chapter dividers.

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
  /** 1-based ordinal shown as a quiet "01 / OVERVIEW" prefix. */
  number: number;
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  description: string;
}) {
  return (
    <header id={id} className="pt-4 pb-1 scroll-mt-20">
      <div
        className="h-px w-full mb-5"
        style={{
          background: `linear-gradient(90deg, ${C.border} 0%, ${C.border} 40%, transparent 100%)`,
        }}
        aria-hidden
      />
      <div className="flex items-start gap-3">
        {Icon && (
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 20%, transparent), color-mix(in srgb, ${gold} 8%, transparent))`,
              color: gold,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${gold} 18%, transparent)`,
            }}
          >
            <Icon size={16} />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5"
            style={{ color: gold }}
          >
            {String(number).padStart(2, "0")} · {title}
          </p>
          <h2
            className="text-[18px] font-semibold leading-tight tracking-[-0.015em]"
            style={{ color: C.textPrimary }}
          >
            {title}
          </h2>
          <p
            className="text-[12.5px] mt-1 max-w-[640px]"
            style={{ color: C.textMuted }}
          >
            {description}
          </p>
        </div>
      </div>
    </header>
  );
}
