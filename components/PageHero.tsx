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
      style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}
    >
      <div
        className="px-8 py-6 flex items-center justify-between gap-6"
        style={{ background: `radial-gradient(ellipse at 85% 40%, ${accentColor}28 0%, transparent 55%), linear-gradient(135deg, #0F172A 0%, #1A2540 100%)` }}
      >
        {/* Left: icon + text */}
        <div className="flex items-center gap-5">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{
              backgroundColor: `${accentColor}22`,
              border: `1px solid ${accentColor}44`,
            }}
          >
            <Icon size={24} style={{ color: accentColor }} />
          </div>
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-widest mb-1"
              style={{ color: accentColor }}
            >
              {section}
            </p>
            <h1 className="text-xl font-bold text-white leading-tight">{title}</h1>
            <p className="text-sm mt-0.5 leading-relaxed" style={{ color: "#94A3B8" }}>
              {description}
            </p>
          </div>
        </div>

        {/* Right: status + badge */}
        <div className="flex items-center gap-2.5 shrink-0">
          {status && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
            >
              <span
                className="w-2 h-2 rounded-full pulse-dot"
                style={{ backgroundColor: status.active !== false ? "#22C55E" : "#F59E0B" }}
              />
              <span className="text-sm font-medium text-white">{status.label}</span>
            </div>
          )}
          {badge && (
            <span
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#94A3B8" }}
            >
              {badge}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
