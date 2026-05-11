"use client";

// Multi-tenant switcher. Rendered in the sidebar below the logo block.
// Visible only when the logged-in user has ≥2 memberships — single-tenant
// users see nothing (no dropdown clutter for clients who only belong to
// their own workspace).
//
// On switch:
//   1. POST /api/auth/switch-tenant { companyBioId }
//   2. window.location.assign("/") — hard nav forces every server component
//      to re-resolve scope. A soft router.refresh() leaves stale client-side
//      query caches (campaigns, leads, etc.) pointing at the previous tenant.

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Check, Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const GOLD = "var(--brand, #c9a83a)";
const BORDER = "color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent)";

export default function TenantSwitcher() {
  const { user, memberships, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click. Native event-listener pattern (vs onBlur) so that
  // clicking another menu item inside the dropdown doesn't auto-close before
  // the click registers.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (loading || !user || memberships.length < 2) return null;

  const current = memberships.find(m => m.companyBioId === user.companyBioId) ?? memberships[0];

  async function switchTo(bioId: string) {
    if (switching || bioId === user?.companyBioId) { setOpen(false); return; }
    setSwitching(bioId);
    try {
      const res = await fetch("/api/auth/switch-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyBioId: bioId }),
      });
      if (res.ok) {
        window.location.assign("/");
      } else {
        setSwitching(null);
      }
    } catch {
      setSwitching(null);
    }
  }

  return (
    <div ref={ref} className="relative px-4 pt-3 pb-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors"
        style={{
          backgroundColor: open ? `color-mix(in srgb, ${GOLD} 10%, transparent)` : `color-mix(in srgb, ${GOLD} 5%, transparent)`,
          border: `1px solid ${BORDER}`,
          color: "rgba(255,255,255,0.9)",
        }}
      >
        {current.logoUrl ? (
          <img src={current.logoUrl} alt="" className="w-5 h-5 rounded object-contain bg-white p-0.5" />
        ) : (
          <Building2 size={14} style={{ color: GOLD }} />
        )}
        <span className="flex-1 text-xs font-semibold truncate">{current.companyName ?? "Untitled"}</span>
        <ChevronsUpDown size={12} style={{ color: "rgba(255,255,255,0.5)" }} />
      </button>

      {open && (
        <div
          className="absolute left-4 right-4 mt-1.5 rounded-lg overflow-hidden z-50 shadow-xl"
          style={{
            backgroundColor: "#0a1322",
            border: `1px solid ${BORDER}`,
            boxShadow: `0 10px 32px rgba(0,0,0,0.6), 0 0 0 1px color-mix(in srgb, ${GOLD} 8%, transparent)`,
          }}
        >
          <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>
            Switch tenant
          </div>
          {memberships.map(m => {
            const isCurrent = m.companyBioId === user.companyBioId;
            const isBusy = switching === m.companyBioId;
            return (
              <button
                key={m.companyBioId}
                type="button"
                onClick={() => switchTo(m.companyBioId)}
                disabled={!!switching}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors disabled:opacity-60"
                style={{
                  backgroundColor: isCurrent ? `color-mix(in srgb, ${GOLD} 12%, transparent)` : "transparent",
                  color: "rgba(255,255,255,0.9)",
                }}
                onMouseEnter={(e) => { if (!isCurrent && !isBusy) e.currentTarget.style.backgroundColor = `color-mix(in srgb, ${GOLD} 6%, transparent)`; }}
                onMouseLeave={(e) => { if (!isCurrent && !isBusy) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                {m.logoUrl ? (
                  <img src={m.logoUrl} alt="" className="w-5 h-5 rounded object-contain bg-white p-0.5" />
                ) : (
                  <Building2 size={14} style={{ color: "rgba(255,255,255,0.5)" }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{m.companyName ?? "Untitled"}</div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>{m.tier}</div>
                </div>
                {isCurrent && <Check size={13} style={{ color: GOLD }} />}
                {isBusy && (
                  <span
                    className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"
                    style={{ color: GOLD }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
