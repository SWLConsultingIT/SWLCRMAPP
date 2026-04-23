"use client";

import { createContext, useContext, useEffect, useState } from "react";

type BrandState = {
  primaryColor: string;   // effective color (either brand or gold fallback)
  enabled: boolean;       // whether use_brand_colors is on
};

const DEFAULT_GOLD = "#c9a83a";
const BrandContext = createContext<BrandState>({ primaryColor: DEFAULT_GOLD, enabled: false });

export function useBrand() {
  return useContext(BrandContext);
}

// Darken a hex color by a percentage (for --brand-dark).
function darken(hex: string, amt = 0.1): string {
  const m = hex.match(/^#([0-9A-Fa-f]{6})$/);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amt)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amt)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amt)));
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9A-Fa-f]{6})$/);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BrandState>({ primaryColor: DEFAULT_GOLD, enabled: false });

  useEffect(() => {
    fetch("/api/settings/branding")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const color = d.primary_color || DEFAULT_GOLD;
        const enabled = !!d.use_brand_colors && !!d.primary_color;
        setState({ primaryColor: enabled ? color : DEFAULT_GOLD, enabled });

        const root = document.documentElement;
        if (enabled) {
          root.style.setProperty("--brand", color);
          root.style.setProperty("--brand-dark", darken(color, 0.12));
          root.style.setProperty("--brand-soft", hexToRgba(color, 0.15));
        } else {
          root.style.removeProperty("--brand");
          root.style.removeProperty("--brand-dark");
          root.style.removeProperty("--brand-soft");
        }
      })
      .catch(() => {});
  }, []);

  return <BrandContext.Provider value={state}>{children}</BrandContext.Provider>;
}
