"use client";

// ─── Admin "View as Seller" — header control ───────────────────────────────
// Lets a real admin (super_admin / owner / manager) preview the app as one of
// THEIR OWN tenant's sellers. Selecting a seller POSTs to /api/auth/view-as
// (server-validated, tenant-isolated, fail-closed) and hard-navigates so the
// whole tree re-mounts under the new effective scope.
//
// Gated on `user.realTier` — the REAL tier, which survives the effective
// downgrade to "seller" while a preview is active. A real seller never sees
// this control (their realTier is "seller") and can't forge the cookie into an
// escalation: the server only ever narrows scope, never widens it.

import { useState, useRef, useEffect } from "react";
import { Eye, ChevronDown, Check, ShieldCheck, User } from "lucide-react";
import { C } from "@/shared/design/tokens";
import { useLocale } from "@/shared/i18n/i18n";
import { useAuth } from "@/shared/auth/auth-context";

const ADMIN_TIERS = new Set(["super_admin", "owner", "manager"]);

export default function ViewAsControl() {
  const { t } = useLocale();
  const { user, viewAs, sellers } = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Only real admins with at least one previewable seller see the control.
  const realTier = user?.realTier ?? null;
  if (!realTier || !ADMIN_TIERS.has(realTier) || sellers.length === 0) return null;

  const active = viewAs.active;

  async function select(sellerId: string | null) {
    setPendingId(sellerId ?? "__admin__");
    try {
      const res = await fetch("/api/auth/view-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId }),
      });
      if (!res.ok) { setPendingId(null); return; }
      // Hard nav — same rationale as enter/exit demo: the effective scope, the
      // Sidebar's admin nav and every server component must re-render under the
      // flipped cookie. A soft refetch would leave stale SSR in place.
      window.location.assign("/");
    } catch {
      setPendingId(null);
    }
  }

  const label = active ? (viewAs as { sellerName: string }).sellerName : t("viewAs.control");

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12px] font-semibold border transition-colors"
        style={{
          borderColor: active ? "color-mix(in srgb, var(--brand, #c9a83a) 45%, transparent)" : C.border,
          backgroundColor: active ? "color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)" : C.bg,
          color: active ? "var(--brand, #c9a83a)" : C.textMuted,
        }}
        title={active ? t("viewAs.viewingAs") + " " + label : t("viewAs.chooseSeller")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Eye size={13} />
        <span className="hidden sm:inline max-w-[120px] truncate">
          {active ? `${t("viewAs.viewingAs")}: ${label}` : label}
        </span>
        <ChevronDown size={12} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 w-60 rounded-xl border shadow-lg py-1.5 z-50"
          style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 8px 28px rgba(0,0,0,0.16)" }}
        >
          <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>
            {t("viewAs.chooseSeller")}
          </p>

          {/* Admin view (return / stay) */}
          <button
            role="menuitemradio"
            aria-checked={!active}
            onClick={() => { if (active) select(null); else setOpen(false); }}
            disabled={pendingId !== null}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors hover:bg-[color:var(--c-bg)] disabled:opacity-50"
            style={{ color: C.textPrimary }}
          >
            <ShieldCheck size={15} style={{ color: "var(--brand, #c9a83a)" }} />
            <span className="flex-1 font-medium">{t("viewAs.adminView")}</span>
            {!active && <Check size={14} style={{ color: "var(--brand, #c9a83a)" }} />}
          </button>

          <div className="my-1 border-t" style={{ borderColor: C.border }} />

          {/* Scrolls once the roster is long (7+ sellers) so the menu never
              runs off-screen; "Admin view" above stays pinned. */}
          <div className="max-h-64 overflow-y-auto">
            {sellers.map(s => {
              const isCurrent = active && (viewAs as { sellerId: string }).sellerId === s.sellerId;
              return (
                <button
                  key={s.sellerId}
                  role="menuitemradio"
                  aria-checked={isCurrent}
                  onClick={() => { if (!isCurrent) select(s.sellerId); else setOpen(false); }}
                  disabled={pendingId !== null}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors hover:bg-[color:var(--c-bg)] disabled:opacity-50"
                  style={{ color: C.textPrimary }}
                >
                  <User size={15} style={{ color: C.textDim }} />
                  <span className="flex-1 truncate">{s.name}</span>
                  {isCurrent && <Check size={14} style={{ color: "var(--brand, #c9a83a)" }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
