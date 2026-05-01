"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { fetchBrandingCached, clearAllSessionCache } from "@/lib/session-cache";

type BrandState = {
  primaryColor: string;   // effective color (either brand or gold fallback)
  enabled: boolean;       // whether use_brand_colors is on
};

const DEFAULT_GOLD = "#c9a83a";
const BrandContext = createContext<BrandState>({ primaryColor: DEFAULT_GOLD, enabled: false });

// Public/pre-auth routes must always show SWL default branding — never inherit a client's color.
const PUBLIC_ROUTES = ["/login", "/signup", "/forgot-password", "/reset-password"];

export function useBrand() {
  return useContext(BrandContext);
}

function clearBrandVars() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.removeProperty("--brand");
  root.style.removeProperty("--brand-dark");
  root.style.removeProperty("--brand-soft");
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

const BRAND_COOKIE = "swl-brand";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function applyBrand(color: string) {
  const root = document.documentElement;
  root.style.setProperty("--brand", color);
  root.style.setProperty("--brand-dark", darken(color, 0.12));
  root.style.setProperty("--brand-soft", hexToRgba(color, 0.15));
}

// Persist the brand to a cookie so the server can inline it in <head> on the
// next request — zero flash, no localStorage dependency.
function writeBrandCookie(enabled: boolean, color: string) {
  try {
    const payload = JSON.stringify({
      enabled,
      color,
      dark: darken(color, 0.12),
      soft: hexToRgba(color, 0.15),
    });
    document.cookie = `${BRAND_COOKIE}=${encodeURIComponent(payload)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch { /* ignore */ }
}

function clearBrandCookie() {
  try { document.cookie = `${BRAND_COOKIE}=; path=/; max-age=0; SameSite=Lax`; } catch { /* ignore */ }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BrandState>({ primaryColor: DEFAULT_GOLD, enabled: false });
  const pathname = usePathname();
  const isPublicRoute = PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(`${r}/`));

  // Mirror isPublicRoute into a ref so the auth-state-change listener — which
  // is registered ONCE inside an empty-deps useEffect — always sees the
  // current value. Without this, an admin who first lands on /login captured
  // isPublicRoute=true in the listener's closure; the post-login SIGNED_IN
  // fired pullBrandFromDb but bailed early, so the tenant brand never painted.
  const isPublicRouteRef = useRef(isPublicRoute);
  isPublicRouteRef.current = isPublicRoute;
  // Stash the auth-effect's pullBrandFromDb so we can re-fire it from the
  // public-route effect when the user transitions /login → / (the SIGNED_IN
  // event can race ahead of the navigation render, leaving the listener with
  // stale ref state).
  const pullRef = useRef<(() => void) | null>(null);

  // Public-route effect — runs whenever pathname enters/exits a public route.
  useEffect(() => {
    if (isPublicRoute) {
      clearBrandVars();
      clearBrandCookie();
      setState({ primaryColor: DEFAULT_GOLD, enabled: false });
    } else {
      // Just left a public route → make sure the tenant brand is hydrated.
      pullRef.current?.();
    }
  }, [isPublicRoute]);

  // Auth-bound effect — fires once on mount and again on every auth state
  // change (sign-in, sign-out, token refresh, user switch). DOES NOT re-run on
  // pathname change anymore; the SSR <style> tag in app/layout.tsx already
  // paints the brand on first byte for every authenticated nav, so the client
  // only needs to refresh the in-memory state when the actual user changes.
  useEffect(() => {
    let alive = true;

    async function pullBrandFromDb() {
      if (isPublicRouteRef.current) return;
      const d = await fetchBrandingCached();
      if (!alive) return;
      if (!d) {
        clearBrandVars();
        clearBrandCookie();
        setState({ primaryColor: DEFAULT_GOLD, enabled: false });
        return;
      }
      const color = d.primary_color || DEFAULT_GOLD;
      const enabled = !!d.use_brand_colors && !!d.primary_color;
      setState({ primaryColor: enabled ? color : DEFAULT_GOLD, enabled });
      if (enabled) {
        applyBrand(color);
        writeBrandCookie(true, color);
      } else {
        clearBrandVars();
        clearBrandCookie();
      }
    }

    pullRef.current = pullBrandFromDb;
    pullBrandFromDb();

    let unsub: (() => void) | null = null;
    try {
      const sb = getSupabaseBrowser();
      const { data } = sb.auth.onAuthStateChange(() => {
        clearAllSessionCache();
        pullBrandFromDb();
      });
      unsub = () => data.subscription.unsubscribe();
    } catch {}

    return () => { alive = false; unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BrandContext.Provider value={state}>{children}</BrandContext.Provider>;
}
