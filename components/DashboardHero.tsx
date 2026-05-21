"use client";

import { useEffect, useState } from "react";
import { Users, MessageSquare, CheckCircle2 } from "lucide-react";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

// "Today's pulse" data the parent passes down. Counts are derived from the
// same 14d trend payloads the dashboard already fetches, so no extra
// network — we just pick "today" off the day buckets.
type TodayPulse = {
  leadsToday: number;
  repliesToday: number;
  transferredToday: number;
};

type Props = {
  pulse?: TodayPulse;
};

/**
 * Compact dashboard hero. Padding/type scale shrunk so the KPI strip lands
 * above the fold on a 13" display. Adds:
 *   • A today-pulse row (3 mini-tiles) under the headline so the seller
 *     sees momentum at a glance without scanning down to the stat cards.
 *   • Today's date in the eyebrow pill so the "right now" claim has a
 *     visible anchor.
 */
export default function DashboardHero({ pulse }: Props) {
  const { t, locale } = useLocale();
  const [dateLabel, setDateLabel] = useState<string>("");

  useEffect(() => {
    // Render the date client-side so SSR / TZ mismatches don't show the
    // wrong day. Format: "Tue · 21 May" in en, "mar · 21 may" in es.
    const now = new Date();
    const fmt = new Intl.DateTimeFormat(locale === "es" ? "es-AR" : "en-GB", {
      weekday: "short", day: "numeric", month: "short",
    });
    setDateLabel(fmt.format(now));
  }, [locale]);

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

        <div className="relative z-10 flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border"
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
              {dateLabel && (
                <span className="text-[9px] font-bold tracking-[0.16em] uppercase px-2 py-0.5 rounded-full border"
                  style={{
                    color: "rgba(217,222,226,0.7)",
                    borderColor: "rgba(217,222,226,0.18)",
                    backgroundColor: "rgba(255,255,255,0.03)",
                  }}>
                  {dateLabel}
                </span>
              )}
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

          {/* Today's pulse — 3 mini-tiles to the right of the headline.
              Renders only when pulse data is provided AND any value is
              non-zero, so empty days don't show a row of zeros. */}
          {pulse && (pulse.leadsToday + pulse.repliesToday + pulse.transferredToday > 0) && (
            <div className="flex items-stretch gap-2 shrink-0">
              <PulseTile icon={Users} value={pulse.leadsToday}
                label={locale === "es" ? "leads hoy" : "leads today"} />
              <PulseTile icon={MessageSquare} value={pulse.repliesToday}
                label={locale === "es" ? "respuestas hoy" : "replies today"} />
              <PulseTile icon={CheckCircle2} value={pulse.transferredToday}
                label={locale === "es" ? "ganados hoy" : "won today"} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PulseTile({ icon: Icon, value, label }: { icon: typeof Users; value: number; label: string }) {
  return (
    <div className="rounded-lg border px-3 py-2 min-w-[80px] text-center"
      style={{
        borderColor: `color-mix(in srgb, ${gold} 22%, transparent)`,
        backgroundColor: "rgba(255,255,255,0.03)",
      }}>
      <div className="flex items-center justify-center gap-1 mb-0.5">
        <Icon size={9} style={{ color: gold, opacity: 0.75 }} />
        <p className="text-[8px] font-bold uppercase tracking-[0.12em]"
          style={{ color: "rgba(217,222,226,0.55)" }}>{label}</p>
      </div>
      <p className="text-[18px] font-bold tabular-nums leading-none"
        style={{ color: "#f8fafc", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
        {value}
      </p>
    </div>
  );
}
