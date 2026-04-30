import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { ThemeProvider } from "@/lib/theme";
import { LocaleProvider } from "@/lib/i18n";
import { BrandProvider } from "@/lib/brand";
import { AuthProvider } from "@/lib/auth-context";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "GrowthAI — Sales Engine",
  description: "Growth Engine — SWL Consulting",
};

// Belt-and-braces: the server already sets `data-theme="dark"` on <html> when
// the swl-theme cookie says dark, so SSR is flash-free. This script only runs
// on the client and re-syncs the attribute against the cookie in case the
// server snapshot is stale (e.g. after an in-tab theme change but before the
// next full reload).
const themeScript = `try{var m=document.cookie.match(/(?:^|;\\s*)swl-theme=(light|dark)/);if(m&&m[1]==='dark')document.documentElement.setAttribute('data-theme','dark');else if(m&&m[1]==='light')document.documentElement.removeAttribute('data-theme');}catch(e){}`;

// Public/pre-auth routes must always show SWL default branding — never inherit a tenant's color.
const PUBLIC_ROUTES = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback"];

// Reset brand vars to SWL gold with !important so an inline style left over from
// a previous tenant session can't bleed into the public/login surface. Inline
// styles beat regular stylesheets, but !important in a stylesheet beats inline
// without !important — so this is the only reliable way to undo the leak.
const PUBLIC_BRAND_RESET = `:root{--brand:#c9a83a !important;--brand-dark:#b79832 !important;--brand-soft:rgba(201,168,58,0.15) !important;}`;

// Sync script — runs before paint on initial load AND clears the inline vars
// that BrandProvider may have set on a prior tenant page. Belt-and-braces with
// the !important stylesheet above so SPA navigations are also handled.
const PUBLIC_BRAND_CLEAR_SCRIPT = `try{document.documentElement.style.removeProperty('--brand');document.documentElement.style.removeProperty('--brand-dark');document.documentElement.style.removeProperty('--brand-soft');document.cookie='swl-brand=; Path=/; Max-Age=0; SameSite=Lax';}catch(e){}`;

// Read the brand cookie (written by BrandProvider after DB fetch) and emit
// the <style> tag server-side so the brand color is painted on the first byte.
function getBrandStyle(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  try {
    const b = JSON.parse(decodeURIComponent(cookieValue)) as {
      enabled?: boolean; color?: string; dark?: string; soft?: string;
    };
    if (!b.enabled || !b.color || !b.dark || !b.soft) return null;
    // Validate hex-ish values to prevent CSS injection via cookie tampering.
    if (!/^#[0-9A-Fa-f]{6}$/.test(b.color) || !/^#[0-9A-Fa-f]{6}$/.test(b.dark)) return null;
    if (!/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*[\d.]+\s*\)$/.test(b.soft)) return null;
    return `:root{--brand:${b.color};--brand-dark:${b.dark};--brand-soft:${b.soft};}`;
  } catch { return null; }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const pathname = headerStore.get("x-pathname") ?? "";
  const isPublicRoute = PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(`${r}/`));
  const brandCss = isPublicRoute ? null : getBrandStyle(cookieStore.get("swl-brand")?.value);
  // Read the theme cookie server-side so we paint the dark backdrop on the
  // first byte. Without this the page renders light → ThemeProvider mounts →
  // pulls from DB → flips to dark, producing a visible flash on every reload.
  const themeCookie = cookieStore.get("swl-theme")?.value;
  const isDark = themeCookie === "dark";

  return (
    <html
      lang="es"
      className={`${inter.variable} ${outfit.variable} h-full`}
      data-theme={isDark ? "dark" : undefined}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {isPublicRoute && <script dangerouslySetInnerHTML={{ __html: PUBLIC_BRAND_CLEAR_SCRIPT }} />}
        {isPublicRoute && <style dangerouslySetInnerHTML={{ __html: PUBLIC_BRAND_RESET }} />}
        {brandCss && <style dangerouslySetInnerHTML={{ __html: brandCss }} />}
      </head>
      <body className="h-full antialiased">
        <ThemeProvider>
          <LocaleProvider>
            <BrandProvider>
              <AuthProvider>
                <AppShell>{children}</AppShell>
              </AuthProvider>
            </BrandProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
