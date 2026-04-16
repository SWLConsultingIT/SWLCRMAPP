"use client";

import { usePathname } from "next/navigation";
import { Bell, HelpCircle, Search, ChevronRight } from "lucide-react";
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

function openCommandPalette() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
  );
}

export default function TopHeader() {
  const pathname = usePathname();
  const pageName = getPageName(pathname);

  return (
    <header
      className="flex items-center px-6 h-14 border-b shrink-0 z-10"
      style={{ backgroundColor: "#FFFFFF", borderColor: C.border }}
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
      <div className="flex items-center gap-2 w-56 justify-end">
        <Link
          href="/queue"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
          style={{ color: C.textMuted }}
        >
          <Bell size={16} />
        </Link>
        <button
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
          style={{ color: C.textMuted }}
        >
          <HelpCircle size={16} />
        </button>
        <div
          className="flex items-center gap-2.5 pl-3 ml-1"
          style={{ borderLeft: `1px solid ${C.border}` }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{
              background: `linear-gradient(135deg, ${C.gold}, #e8c84a)`,
              color: "#1A1A2E",
            }}
          >
            GE
          </div>
          <div>
            <p className="text-xs font-semibold leading-tight" style={{ color: C.textPrimary }}>
              Growth Engine
            </p>
            <p className="text-[10px] leading-tight" style={{ color: C.textMuted }}>
              SWL Consulting
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
