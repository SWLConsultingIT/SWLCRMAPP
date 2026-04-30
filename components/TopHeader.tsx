"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, HelpCircle, Search, ChevronRight, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { useAuthUser } from "@/lib/auth-context";

const ROUTE_KEYS: Record<string, { key: string; brand?: string }> = {
  "/":              { key: "nav.dashboard" },
  "/company-bios":  { key: "nav.companyBio" },
  "/icp":           { key: "", brand: "Lead Miner™" },
  "/campaigns":     { key: "", brand: "Outreach Flow™" },
  "/voice":         { key: "", brand: "Voice & Templates" },
  "/templates":     { key: "", brand: "Voice & Templates" },
  "/leads":         { key: "nav.leads" },
  "/accounts":      { key: "nav.accounts" },
  "/opportunities": { key: "nav.opportunities" },
  "/queue":         { key: "nav.queue" },
  "/admin":         { key: "nav.admin" },
};

function usePageName(pathname: string): string {
  const { t } = useLocale();
  if (pathname === "/") return t("nav.dashboard");
  for (const [path, entry] of Object.entries(ROUTE_KEYS)) {
    if (path !== "/" && pathname.startsWith(path)) return entry.brand ?? t(entry.key);
  }
  return "";
}

function getInitials(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) return "??";
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getUserColor(name: unknown): { from: string; to: string } {
  if (typeof name !== "string") return { from: C.gold, to: "color-mix(in srgb, var(--brand, #c9a83a) 72%, white)" };
  if (name === "Admin") return { from: "#7C3AED", to: "#9F67FF" };
  if (name.startsWith("Francisco")) return { from: "#0A66C2", to: "#2D8AE8" };
  return { from: C.gold, to: "color-mix(in srgb, var(--brand, #c9a83a) 72%, white)" };
}

function openCommandPalette() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
  );
}

export default function TopHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const pageName = usePageName(pathname);
  const { t } = useLocale();
  // Read from shared AuthContext — was a duplicate /api/auth/me fetch on every
  // header mount before. Saves one round-trip per navigation.
  const user = useAuthUser();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    try {
      localStorage.removeItem("swl-theme");
      localStorage.removeItem("swl-locale");
    } catch {}
    router.push("/login");
  }

  const displayName = user?.displayName ?? "";
  const initials = displayName ? getInitials(displayName) : "…";
  const userColor = displayName ? getUserColor(displayName) : { from: C.gold, to: "color-mix(in srgb, var(--brand, #c9a83a) 72%, white)" };
  const firstName = displayName ? displayName.split(" ")[0] : "";

  return (
    <header
      className="flex items-center px-6 h-14 border-b shrink-0 z-10"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: "0 1px 0 rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.03)",
      }}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm w-56 min-w-0">
        <span className="font-semibold" style={{ color: C.textMuted }}>GrowthAI</span>
        {pageName && (
          <>
            <ChevronRight size={13} style={{ color: C.textDim }} />
            <span className="font-bold truncate" style={{ color: C.textPrimary }}>{pageName}</span>
          </>
        )}
      </div>

      {/* Center: command bar */}
      <div className="flex-1 flex justify-center px-6">
        <button
          onClick={openCommandPalette}
          className="flex items-center gap-3 rounded-xl px-4 py-2 text-sm w-full max-w-xs transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm"
          style={{
            backgroundColor: C.bg,
            border: `1px solid ${C.border}`,
            color: C.textDim,
          }}
        >
          <Search size={13} style={{ color: C.textDim }} />
          <span className="flex-1 text-left">{t("header.search")}</span>
          <kbd
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: C.border2, color: C.textDim }}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: actions + user */}
      <div className="flex items-center gap-1 w-56 justify-end">
        <Link
          href="/queue"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
          style={{ color: C.textMuted }}
          title={t("nav.queue")}
        >
          <Bell size={16} />
        </Link>
        <Link
          href="/settings"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
          style={{ color: pathname.startsWith("/settings") ? C.gold : C.textMuted }}
          title={t("nav.settings")}
        >
          <Settings size={16} />
        </Link>
        <button
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
          style={{ color: C.textMuted }}
          title="Help"
        >
          <HelpCircle size={16} />
        </button>
        <button
          onClick={handleLogout}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
          style={{ color: C.textMuted }}
          title={t("header.signOut")}
        >
          <LogOut size={16} />
        </button>

        {/* User chip */}
        <div
          className="flex items-center gap-2 ml-2 pl-2 border-l"
          style={{ borderColor: C.border }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 select-none"
            style={{
              background: `linear-gradient(135deg, ${userColor.from}, ${userColor.to})`,
              color: "#fff",
              boxShadow: `0 1px 6px ${userColor.from}50`,
            }}
          >
            {initials}
          </div>
          <div className="leading-none">
            <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>
              {firstName || "—"}
            </p>
            <p className="text-[9px] mt-0.5 font-medium uppercase tracking-wider" style={{ color: C.textDim }}>
              {user?.companyName || "—"}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
