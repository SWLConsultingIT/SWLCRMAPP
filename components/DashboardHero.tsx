"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

export default function DashboardHero() {
  const { t } = useLocale();
  return (
    <div
      className="rounded-2xl overflow-hidden mb-6 relative"
      style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.10)" }}
    >
      <div
        className="px-10 py-10 relative"
        style={{
          background: `
            radial-gradient(ellipse 60% 90% at 100% 50%, color-mix(in srgb, var(--brand, #c9a83a) 22%, transparent) 0%, transparent 60%),
            radial-gradient(ellipse 50% 80% at 0% 100%, color-mix(in srgb, var(--brand-dark, #b79832) 16%, transparent) 0%, transparent 55%),
            radial-gradient(ellipse 30% 50% at 50% 0%, rgba(26,127,116,0.10) 0%, transparent 60%),
            linear-gradient(135deg, #04070d 0%, #08101e 60%, #0a1525 100%)
          `,
        }}
      >
        {/* Grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px)`,
            backgroundSize: "56px 56px",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0 h-px pointer-events-none"
          style={{
            background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${gold} 38%, transparent) 35%, color-mix(in srgb, ${gold} 38%, transparent) 65%, transparent 100%)`,
          }}
        />

        <div className="relative z-10 flex items-end justify-between gap-8 flex-wrap">
          <div className="max-w-2xl">
            <div
              className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full border w-fit"
              style={{
                borderColor: `color-mix(in srgb, ${gold} 30%, transparent)`,
                backgroundColor: `color-mix(in srgb, ${gold} 7%, transparent)`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: gold }} />
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: gold }}>
                {t("dash.pillLive")}
              </span>
            </div>

            <h1
              className="text-[44px] leading-[1.05] font-bold mb-3"
              style={{
                color: "#f8fafc",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                letterSpacing: "-0.025em",
              }}
            >
              {t("dash.title.a")} <span style={{ color: gold }}>{t("dash.title.b")}</span>
            </h1>
            <p className="text-[15px] leading-relaxed max-w-xl" style={{ color: "rgba(217,222,226,0.65)" }}>
              {t("dash.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/campaigns/new"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-[opacity,transform,box-shadow] duration-150 hover:opacity-90 hover:shadow-md"
              style={{ backgroundColor: gold, color: "#04070d" }}
            >
              <Megaphone size={14} /> {t("dash.cta.newCampaign")}
            </Link>
            <Link
              href="/voice"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium border transition-colors duration-150 hover:bg-white/5"
              style={{
                color: "#f8fafc",
                borderColor: "rgba(255,255,255,0.18)",
                backgroundColor: "rgba(255,255,255,0.04)",
              }}
            >
              {t("dash.cta.voice")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
