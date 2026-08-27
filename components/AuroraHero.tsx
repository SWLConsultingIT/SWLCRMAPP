import type { ReactNode } from "react";

/** A single KPI chip in the hero's stat band. */
export type AuroraKpi = {
  value: ReactNode;
  label: string;
  /** "gold" = primary (gold number), "green"/"red" = semantic, else default ink. */
  tone?: "gold" | "green" | "red" | "default";
};

/**
 * Shared page hero — a constant, animated gold aurora glowing behind a
 * frosted-glass panel (boss-approved 2026-08-27). Styling lives in
 * globals.css (`.aurora-*`, theme-aware via [data-theme], reduced-motion safe).
 *
 * Presentational only (no hooks), so it works in both server and client pages.
 */
export default function AuroraHero({
  eyebrow,
  title,
  subtitle,
  actions,
  kpis,
  className = "",
  bare = false,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  kpis?: AuroraKpi[];
  className?: string;
  /** Omit the default bottom margin (for parents that manage spacing). */
  bare?: boolean;
}) {
  return (
    <div className={`aurora-hero ${bare ? "" : "mb-6"} ${className}`}>
      <div className="aurora-mesh" aria-hidden />
      <div className="aurora-mesh2" aria-hidden />
      <div className="aurora-glass">
        <div className="aurora-top">
          <div className="aurora-head">
            <div className="aurora-eyebrow">
              <span className="aurora-tick" aria-hidden />
              {eyebrow}
            </div>
            <h1 className="aurora-title">{title}</h1>
            {subtitle && <p className="aurora-sub">{subtitle}</p>}
          </div>
          {actions && <div className="aurora-acts">{actions}</div>}
        </div>
        {kpis && kpis.length > 0 && (
          <div className="aurora-chips">
            {kpis.map((k, i) => (
              <div key={i} className={`aurora-chip${k.tone === "gold" ? " pri" : ""}`}>
                <div
                  className={`aurora-chip-v${
                    k.tone === "green" ? " gr" : k.tone === "red" ? " rd" : ""
                  }`}
                >
                  {k.value}
                </div>
                <div className="aurora-chip-l">{k.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
