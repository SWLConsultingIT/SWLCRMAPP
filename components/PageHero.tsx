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
        className="px-7 py-5 flex items-center justify-between gap-6 relative"
        style={{
          background: `
            radial-gradient(ellipse 55% 70% at 90% 50%, color-mix(in srgb, ${accentColor} 19%, transparent) 0%, transparent 60%),
            radial-gradient(ellipse 30% 50% at 5%  80%, rgba(255,255,255,0.06) 0%, transparent 50%),
            linear-gradient(135deg, #0D1524 0%, #172035 55%, #1A2640 100%)
          `,
        }}
      >
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)`,
            backgroundSize: "32px 32px",
          }}
        />

        {/* Left: icon + text */}
        <div className="flex items-center gap-4 relative z-10">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{
              backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accentColor} 25%, transparent)`,
              boxShadow: `0 0 20px color-mix(in srgb, ${accentColor} 15%, transparent)`,
            }}
          >
            <Icon size={22} style={{ color: accentColor }} />
          </div>
          <div>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.15em] mb-0.5"
              style={{ color: accentColor, opacity: 0.9 }}
            >
              {section}
            </p>
            <h1
              className="text-[19px] font-bold text-white leading-tight"
              style={{ letterSpacing: "-0.02em" }}
            >
              {title}
            </h1>
            <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: "#8EA3BE" }}>
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
