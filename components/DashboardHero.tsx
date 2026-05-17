"use client";

import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

// Compact hero — padding and type scale shrunk so the KPI strip lands above
// the fold on 13" displays. Same gradient + grid overlay treatment but the
// vertical footprint dropped ~50% (py-10 → py-5, h1 44px → 26px).
export default function DashboardHero() {
  const { t } = useLocale();
  return (
    <div
      className="rounded-xl overflow-hidden mb-4 relative"
      style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.08)" }}
    >
      <div
        className="px-6 py-5 relative"
        style={{
          background: `
            radial-gradient(ellipse 60% 90% at 100% 50%, color-mix(in srgb, var(--brand, #c9a83a) 22%, transparent) 0%, transparent 60%),
            radial-gradient(ellipse 50% 80% at 0% 100%, color-mix(in srgb, var(--brand-dark, #b79832) 16%, transparent) 0%, transparent 55%),
            linear-gradient(135deg, #04070d 0%, #08101e 60%, #0a1525 100%)
          `,
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0 h-px pointer-events-none"
          style={{
            background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${gold} 38%, transparent) 35%, color-mix(in srgb, ${gold} 38%, transparent) 65%, transparent 100%)`,
          }}
        />

        <div className="relative z-10 flex items-center justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <div
              className="inline-flex items-center gap-1.5 mb-2 px-2.5 py-0.5 rounded-full border w-fit"
              style={{
                borderColor: `color-mix(in srgb, ${gold} 30%, transparent)`,
                backgroundColor: `color-mix(in srgb, ${gold} 7%, transparent)`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: gold }} />
              <span className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: gold }}>
                {t("dash.pillLive")}
              </span>
            </div>

            <h1
              className="text-[26px] leading-[1.1] font-bold"
              style={{
                color: "#f8fafc",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                letterSpacing: "-0.02em",
              }}
            >
              {t("dash.title.a")} <span style={{ color: gold }}>{t("dash.title.b")}</span>
            </h1>
            <p className="text-[12px] leading-snug mt-1 max-w-2xl" style={{ color: "rgba(217,222,226,0.6)" }}>
              {t("dash.subtitle")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
