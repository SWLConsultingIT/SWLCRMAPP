"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, LogOut } from "lucide-react";

// Persistent gold strip rendered above TopHeader whenever the admin is
// inside a demo tenant (cookie-driven). Self-fetches /api/auth/me; the
// endpoint is already cache=private,max-age=30 so the cost is amortized.
type DemoState = { active: false } | { active: true; bioId: string; companyName: string | null };

export default function DemoBanner() {
  const [demo, setDemo] = useState<DemoState>({ active: false });
  const [exiting, setExiting] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // `cache: "no-store"` is non-negotiable here — /api/auth/me ships with
    // Cache-Control private/max-age=30 in non-demo mode, so without busting
    // the cache the banner would lag a full minute behind cookie flips.
    // We also re-run on pathname change so the banner reappears after a
    // client-side nav from /admin/demos → / right after entering a demo.
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d?.demoMode?.active) {
          setDemo({ active: true, bioId: d.demoMode.bioId, companyName: d.demoMode.companyName });
        } else {
          setDemo({ active: false });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  if (!demo.active) return null;

  async function exit() {
    setExiting(true);
    try {
      await fetch("/api/admin/demos/exit", { method: "POST" });
      // Hard nav — same reason as DemosClient.enterDemo. The session cache
      // (theme, locale, branding) and Sidebar role state all need a full
      // re-mount under the cleared cookie.
      window.location.assign("/admin/demos");
    } catch {
      setExiting(false);
    }
  }

  return (
    <div
      className="relative w-full flex items-center justify-between gap-3 px-4 py-2 border-b"
      style={{
        backgroundColor: "color-mix(in srgb, var(--brand-dark, #b79832) 14%, #04070d)",
        borderColor: "color-mix(in srgb, var(--brand-dark, #b79832) 35%, transparent)",
        color: "#F1F5F9",
      }}
      role="status"
      aria-live="polite"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] pointer-events-none"
        style={{
          background: "linear-gradient(90deg, transparent 0%, var(--brand, #c9a83a) 50%, transparent 100%)",
          opacity: 0.7,
        }}
      />
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 22%, transparent)" }}
        >
          <Sparkles size={12} style={{ color: "var(--brand, #c9a83a)" }} />
        </div>
        <p className="text-[12px] font-semibold truncate">
          <span className="text-[10px] font-bold uppercase tracking-wider mr-2 px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--brand, #c9a83a)", color: "#04070d", letterSpacing: "0.08em" }}>
            Demo mode
          </span>
          Viewing as <span className="font-bold" style={{ color: "var(--brand, #c9a83a)" }}>{demo.companyName ?? "demo tenant"}</span>
          <span className="hidden sm:inline ml-2 opacity-70">— your SWL data is untouched.</span>
        </p>
      </div>
      <button
        onClick={exit}
        disabled={exiting}
        className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold border transition-opacity hover:opacity-80 disabled:opacity-50 shrink-0"
        style={{
          borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 40%, transparent)",
          color: "var(--brand, #c9a83a)",
          backgroundColor: "transparent",
        }}
      >
        <LogOut size={11} /> {exiting ? "Exiting…" : "Exit demo"}
      </button>
    </div>
  );
}
