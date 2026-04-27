import { C } from "@/lib/design";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  primaryCta?: { label: string; href?: string; onClick?: () => void };
  secondaryCta?: { label: string; href?: string; onClick?: () => void };
  /** Override the default brand-gold accent (e.g. red for an error empty). */
  accent?: string;
  /** Soft background tone for the icon halo. */
  accentSoft?: string;
};

const gold = "var(--brand, #c9a83a)";

export default function EmptyState({
  icon: Icon, title, description, primaryCta, secondaryCta, accent, accentSoft,
}: Props) {
  const c = accent ?? gold;
  const cs = accentSoft ?? "color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)";

  return (
    <div
      className="rounded-2xl border px-8 py-14 flex flex-col items-center text-center"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
        style={{
          backgroundColor: cs,
          boxShadow: `0 0 0 6px color-mix(in srgb, ${c} 4%, transparent)`,
        }}
      >
        <Icon size={24} style={{ color: c }} />
      </div>
      <h3 className="text-[16px] font-semibold mb-1.5" style={{ color: C.textPrimary }}>
        {title}
      </h3>
      {description && (
        <p
          className="text-[13px] max-w-md leading-relaxed mb-6"
          style={{ color: C.textMuted }}
        >
          {description}
        </p>
      )}
      <div className="flex items-center gap-2">
        {primaryCta && (primaryCta.href ? (
          <Link
            href={primaryCta.href}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold transition-[opacity,box-shadow] duration-150 hover:opacity-90 hover:shadow-md"
            style={{ backgroundColor: c, color: "#fff" }}
          >
            {primaryCta.label}
          </Link>
        ) : (
          <button
            onClick={primaryCta.onClick}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold transition-[opacity,box-shadow] duration-150 hover:opacity-90 hover:shadow-md"
            style={{ backgroundColor: c, color: "#fff" }}
          >
            {primaryCta.label}
          </button>
        ))}
        {secondaryCta && (secondaryCta.href ? (
          <Link
            href={secondaryCta.href}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 hover:bg-black/[0.04]"
            style={{ color: C.textBody }}
          >
            {secondaryCta.label}
          </Link>
        ) : (
          <button
            onClick={secondaryCta.onClick}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 hover:bg-black/[0.04]"
            style={{ color: C.textBody }}
          >
            {secondaryCta.label}
          </button>
        ))}
      </div>
    </div>
  );
}
