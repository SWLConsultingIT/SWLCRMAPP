import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { ThemeProvider } from "@/lib/theme";
import { LocaleProvider } from "@/lib/i18n";
import { BrandProvider } from "@/lib/brand";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "GrowthAI — Sales Engine",
  description: "Growth Engine — SWL Consulting",
};

const themeScript = `try{var t=localStorage.getItem('swl-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}`;

// Public/pre-auth routes must always show SWL default branding — never inherit a tenant's color.
const PUBLIC_ROUTES = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback"];

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

  return (
    <html lang="es" className={`${inter.variable} ${outfit.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {brandCss && <style dangerouslySetInnerHTML={{ __html: brandCss }} />}
      </head>
      <body className="h-full antialiased">
        <ThemeProvider>
          <LocaleProvider>
            <BrandProvider>
              <AppShell>{children}</AppShell>
            </BrandProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
