"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, HelpCircle, Search, ChevronRight, LogOut } from "lucide-react";
import Link from "next/link";
import { C } from "@/lib/design";

const ROUTES: Record<string, string> = {
  "/":              "Dashboard",
  "/company-bios":  "Company Bio",
  "/icp":           "Lead Miner™",
  "/campaigns":     "Outreach Flow™",
  "/leads":         "Leads & Campaigns",
  "/accounts":      "Accounts & Usage",
  "/opportunities": "Opportunities",
  "/queue":         "Queue",
  "/admin":         "Admin",
};

function getPageName(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  for (const [key, name] of Object.entries(ROUTES)) {
    if (key !== "/" && pathname.startsWith(key)) return name;
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
  if (typeof name !== "string") return { from: C.gold, to: "#e8c84a" };
  if (name === "Admin") return { from: "#7C3AED", to: "#9F67FF" };
  if (name.startsWith("Francisco")) return { from: "#0A66C2", to: "#2D8AE8" };
  return { from: C.gold, to: "#e8c84a" };
}

function openCommandPalette() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
  );
}

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

export default function TopHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const pageName = getPageName(pathname);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => setUser(d.user ?? null))
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const displayName = user?.displayName ?? "";
  const initials = displayName ? getInitials(displayName) : "…";
  const userColor = displayName ? getUserColor(displayName) : { from: C.gold, to: "#e8c84a" };
  const firstName = displayName ? displayName.split(" ")[0] : "";

  return (
    <header
      className="flex items-center px-6 h-14 border-b shrink-0 z-10"
      style={{
        backgroundColor: "#FFFFFF",
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
          className="flex items-center gap-3 rounded-xl px-4 py-2 text-sm w-full max-w-xs transition-all hover:shadow-sm"
          style={{
            backgroundColor: C.bg,
            border: `1px solid ${C.border}`,
            color: C.textDim,
          }}
        >
          <Search size={13} style={{ color: C.textDim }} />
          <span className="flex-1 text-left">Ask anything...</span>
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
          title="Queue"
        >
          <Bell size={16} />
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
          title="Sign out"
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
              SWL Consulting
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
