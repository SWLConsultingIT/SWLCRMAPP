"use client";

// ─── Admin "View as Seller" — persistent banner ────────────────────────────
// Rendered above TopHeader whenever an admin is previewing the app as a seller
// (cookie-driven, mirrored into the auth payload's `viewAs`). Gold/neutral —
// deliberately NOT an error color: this is a sanctioned inspection mode, not a
// fault. Announces the read-only nature (writes are blocked server-side by
// proxy.ts) and offers a one-click return to Admin view.
//
// Sibling to DemoBanner; both can't be active at once (view-as is disabled in
// demo mode server-side). Reads from the shared AuthContext.

import { useState } from "react";
import { useLocale } from "@/shared/i18n/i18n";
import { Eye, Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "@/shared/auth/auth-context";

export default function ViewAsBanner() {
  const { t } = useLocale();
  const { viewAs } = useAuth();
  const [returning, setReturning] = useState(false);

  if (!viewAs.active) return null;

  async function returnToAdmin() {
    setReturning(true);
    try {
      await fetch("/api/auth/view-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId: null }),
      });
      // Hard nav — clears the effective-seller scope across SSR + Sidebar +
      // every server component, same as enter/exit demo.
      window.location.assign("/");
    } catch {
      setReturning(false);
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
          <Eye size={12} style={{ color: "var(--brand, #c9a83a)" }} />
        </div>
        <p className="text-[12px] font-semibold truncate">
          <span className="text-[10px] font-bold uppercase tracking-wider mr-2 px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--brand, #c9a83a)", color: "#04070d", letterSpacing: "0.08em" }}>
            {t("viewAs.badge")}
          </span>
          {t("viewAs.viewingAs")} <span className="font-bold" style={{ color: "var(--brand, #c9a83a)" }}>{viewAs.sellerName}</span>
          <span className="hidden sm:inline-flex items-center gap-1 ml-2 opacity-70">
            <Lock size={10} /> {t("viewAs.readOnly")}
          </span>
        </p>
      </div>
      <button
        onClick={returnToAdmin}
        disabled={returning}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold border transition-opacity hover:opacity-80 disabled:opacity-50 shrink-0"
        style={{
          borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 40%, transparent)",
          color: "var(--brand, #c9a83a)",
          backgroundColor: "transparent",
        }}
      >
        <ShieldCheck size={12} /> {returning ? t("viewAs.returning") : t("viewAs.returnToAdmin")}
      </button>
    </div>
  );
}
