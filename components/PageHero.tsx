import { type LucideIcon } from "lucide-react";

type PageHeroProps = {
  icon: LucideIcon;
  section: string;
  title: string;
  description: string;
  accentColor: string;
  status?: { label: string; active?: boolean };
  badge?: string;
};

export default function PageHero({
  icon: Icon,
  section,
  title,
  description,
  accentColor,
  status,
  badge,
}: PageHeroProps) {
  return (
    <div
      className="rounded-2xl overflow-hidden mb-6"
      style={{ boxShadow: "0 4px 28px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)" }}
    >
      <div
        className="px-8 py-7 flex items-center justify-between gap-6 relative"
        style={{
          background: `
            radial-gradient(ellipse 50% 90% at 95% 50%, color-mix(in srgb, ${accentColor} 22%, transparent) 0%, transparent 60%),
            radial-gradient(ellipse 35% 70% at 0% 100%, color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent) 0%, transparent 55%),
            linear-gradient(135deg, #04070d 0%, #08101e 60%, #0a1525 100%)
          `,
        }}
      >
        {/* Grid overlay — same density as the login screen for visual consistency. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px)`,
            backgroundSize: "56px 56px",
          }}
        />

        {/* Bottom-edge gold-dark gradient line for premium framing. */}
        <div
          className="absolute left-0 right-0 bottom-0 h-px pointer-events-none"
          style={{
            background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${accentColor} 35%, transparent) 35%, color-mix(in srgb, ${accentColor} 35%, transparent) 65%, transparent 100%)`,
          }}
        />

        {/* Left: icon + text */}
        <div className="flex items-center gap-5 relative z-10">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              backgroundColor: `color-mix(in srgb, ${accentColor} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
              boxShadow: `0 0 28px color-mix(in srgb, ${accentColor} 22%, transparent), inset 0 1px 0 color-mix(in srgb, ${accentColor} 25%, transparent)`,
            }}
          >
            <Icon size={22} style={{ color: accentColor }} />
          </div>
          <div>
            {/* Section pill — matches the login "GROWTHAI SALES ENGINE" treatment. */}
            <div
              className="inline-flex items-center gap-1.5 mb-2 px-2.5 py-0.5 rounded-full border w-fit"
              style={{
                borderColor: `color-mix(in srgb, ${accentColor} 30%, transparent)`,
                backgroundColor: `color-mix(in srgb, ${accentColor} 8%, transparent)`,
              }}
            >
              <span className="w-1 h-1 rounded-full pulse-dot" style={{ backgroundColor: accentColor }} />
              <span
                className="text-[9px] font-bold tracking-[0.18em] uppercase"
                style={{ color: accentColor }}
              >
                {section}
              </span>
            </div>
            <h1
              className="text-[26px] font-bold text-white leading-[1.05]"
              style={{
                letterSpacing: "-0.02em",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
              }}
            >
              {title}
            </h1>
            <p className="text-[13px] mt-1.5 leading-relaxed max-w-2xl" style={{ color: "rgba(217,222,226,0.6)" }}>
              {description}
            </p>
          </div>
        </div>

        {/* Right: status + badge */}
        <div className="flex items-center gap-2.5 shrink-0 relative z-10">
          {status && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.1)",
                backdropFilter: "blur(8px)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full pulse-dot"
                style={{ backgroundColor: status.active !== false ? "#22C55E" : "#F59E0B" }}
              />
              <span className="text-[12px] font-medium text-white">{status.label}</span>
            </div>
          )}
          {badge && (
            <span
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{
                backgroundColor: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#94A3B8",
              }}
            >
              {badge}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
