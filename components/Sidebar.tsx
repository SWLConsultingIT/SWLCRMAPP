"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { useAuthUser } from "@/lib/auth-context";
import TenantSwitcher from "@/components/TenantSwitcher";
import HelpMenu from "@/components/HelpMenu";
import {
  LayoutDashboard, Users, Megaphone,
  Building2, Target, Shield, ChevronDown, Bell, UserCircle, Settings, Inbox,
  PanelLeftClose, PanelLeftOpen, Trophy,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { loadRecentLeads, type RecentLead } from "@/lib/recent-leads";

const DARK   = "#060c18";
const BORDER = "color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent)";
const GOLD   = "var(--brand, var(--brand, #c9a83a))";
const GOLD_DIM = "color-mix(in srgb, var(--brand, var(--brand, #c9a83a)) 75%, transparent)";
const TEXT_MUTED = "rgba(255,255,255,0.55)";
const TEXT_BODY  = "rgba(255,255,255,0.85)";

type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  brandLabel?: string;
  tag?: string;
  badgeKey?: "calls" | "pending" | "pendingReplies";
  adminOnly?: boolean;
};

// Sidebar — user-confirmed layout (Option A):
//   MAIN: Dashboard / Company Bio / Notifications (the 3 things touched daily)
//   GROWTH ENGINE: Lead Miner / Outreach Flow / Leads
//      (creation tools + the list of what they produced; visually grouped so
//      the seller's "I made it → here it is" flow lives in one place)
//   OPERATIONS: Accounts / Admin (Opportunities folded into /leads → Results)
//   Admin lives inside Operations now since the section needed more weight
//   after Opportunities moved out. Still gated to super_admin/owner/manager.
const sections: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: "nav.section.main",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { href: "/company-bios", labelKey: "nav.companyBio", icon: Building2 },
      { href: "/queue", labelKey: "nav.queue", icon: Bell, badgeKey: "calls" },
    ],
  },
  {
    labelKey: "nav.section.growth",
    items: [
      { href: "/icp", labelKey: "", brandLabel: "Lead Miner™", icon: Target, tag: "AI" },
      { href: "/campaigns", labelKey: "", brandLabel: "Outreach Flow™", icon: Megaphone, tag: "AI" },
      { href: "/leads", labelKey: "nav.leads", icon: Users },
      { href: "/results", labelKey: "nav.results", icon: Trophy },
    ],
  },
  {
    labelKey: "nav.section.operations",
    items: [
      { href: "/accounts", labelKey: "nav.accounts", icon: UserCircle },
      { href: "/admin", labelKey: "nav.admin", icon: Shield, badgeKey: "pending", adminOnly: true },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLocale();
  const router = useRouter();
  // Read from shared AuthContext — was a duplicate /api/auth/me fetch on every
  // sidebar mount before. Saves one round-trip per navigation.
  // Declared early because the recent-leads effect below depends on it.
  const authUser = useAuthUser();
  const tier = authUser?.tier ?? null;
  const authUserId = authUser?.id ?? null;
  const [callCount, setCallCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingRepliesCount, setPendingRepliesCount] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([]);
  // Recent leads collapse — persisted per device so sellers who don't use it
  // can hide it permanently, but defaults to open so the affordance is
  // discoverable on first visit.
  const [recentExpanded, setRecentExpanded] = useState(true);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("sidebar.recent.collapsed");
      if (v === "1") setRecentExpanded(false);
    } catch { /* ignore */ }
  }, []);
  function toggleRecent() {
    setRecentExpanded(prev => {
      const next = !prev;
      try { window.localStorage.setItem("sidebar.recent.collapsed", next ? "0" : "1"); } catch { /* ignore */ }
      return next;
    });
  }
  // Subscribe to the recent-leads list. We update on mount + on the custom
  // event that pushRecentLead dispatches in this tab (the native `storage`
  // event only fires across tabs, so without this the sidebar wouldn't
  // refresh after the user opened a new lead in the same tab).
  // Scope the recent-leads list to the current user. Re-runs whenever the
  // authenticated user changes (logout/login) so the previous account's
  // recent items vanish from view immediately. (authUserId declared above.)
  useEffect(() => {
    const sync = () => setRecentLeads(loadRecentLeads(authUserId));
    sync();
    window.addEventListener("growth:recent-leads-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("growth:recent-leads-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [authUserId]);
  // Sidebar collapse — Linear/Vercel pattern: hide labels and shrink width to
  // icon-only mode. State persists per-device via localStorage so power users
  // who prefer a max content area don't need to re-collapse every nav.
  const [railOnly, setRailOnly] = useState(false);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("sidebar.rail");
      if (v === "1") setRailOnly(true);
    } catch { /* ignore */ }
  }, []);
  function toggleRail() {
    setRailOnly(v => {
      const next = !v;
      try { window.localStorage.setItem("sidebar.rail", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  // Keyboard shortcuts — Linear/GitHub "G then <letter>" pattern. Press G,
  // then within 1.2s press one of: D, B, N, I, O, L, A, S to jump. Ignored
  // while typing in an input/textarea/contenteditable.
  useEffect(() => {
    let gPressedAt = 0;
    const TIMEOUT_MS = 1200;
    const shortcuts: Record<string, string> = {
      d: "/",
      b: "/company-bios",
      n: "/queue",
      i: "/icp",
      o: "/campaigns",
      l: "/leads",
      a: "/accounts",
      s: "/settings",
    };
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "g") { gPressedAt = Date.now(); return; }
      if (Date.now() - gPressedAt > TIMEOUT_MS) return;
      const target = shortcuts[k];
      if (target) {
        e.preventDefault();
        gPressedAt = 0;
        router.push(target);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  // authUser + tier declared at the top of the component so the recent-leads
  // effect (which depends on authUser?.id) can reference them safely. The
  // duplicate declaration that used to live here was removed.

  useEffect(() => {
    let cancelled = false;
    async function fetchBadges() {
      try {
        const res = await fetch("/api/sidebar/badges", { cache: "no-store" });
        if (!res.ok) return;
        const { calls, pending, pendingReplies } = await res.json();
        if (cancelled) return;
        setCallCount(calls ?? 0);
        setPendingCount(pending ?? 0);
        setPendingRepliesCount(pendingReplies ?? 0);
      } catch {
        // Silent — non-critical UI; will retry on next interval.
      }
    }
    fetchBadges();
    // Sidebar badges aren't time-critical. The endpoint batches 4 counts
    // into one round-trip so the cost is ~1 request/5min/user.
    const interval = setInterval(fetchBadges, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Show the Admin sidebar item to anyone who has access to a tier-scoped
  // version of /admin: super_admin (cross-tenant SWL view), owner/manager
  // (their tenant's view). Sellers + viewers don't see the menu at all —
  // /admin/page.tsx redirects them away if they navigate there directly.
  const showAdmin = tier === "super_admin" || tier === "owner" || tier === "manager";
  const visibleSections = sections.map(s => ({
    ...s,
    items: s.items.filter(item => !item.adminOnly || showAdmin),
  })).filter(s => s.items.length > 0);

  const badges: Record<string, number> = { calls: callCount, pending: pendingCount, pendingReplies: pendingRepliesCount };
  const toggleSection = (label: string) => setCollapsed(prev => ({ ...prev, [label]: !prev[label] }));

  return (
    <aside
      className={`${railOnly ? "w-[64px]" : "w-60"} flex flex-col shrink-0 border-r relative transition-[width] duration-200`}
      style={{
        backgroundColor: DARK,
        borderColor: BORDER,
        backgroundImage: `
          linear-gradient(color-mix(in srgb, var(--brand, #c9a83a) 3%, transparent) 1px, transparent 1px),
          linear-gradient(90deg, color-mix(in srgb, var(--brand, #c9a83a) 3%, transparent) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }}
    >
      {/* Collapse toggle — pinned top-right of the rail. Lets power users
          claim ~196px of horizontal space when they want a wider data table. */}
      <button
        type="button"
        onClick={toggleRail}
        aria-label={railOnly ? "Expand sidebar" : "Collapse sidebar"}
        title={railOnly ? "Expand sidebar (press G then any letter to navigate)" : "Collapse sidebar"}
        className="absolute top-3 right-2 z-20 w-6 h-6 rounded-md flex items-center justify-center transition-colors"
        style={{
          backgroundColor: "rgba(255,255,255,0.04)",
          border: `1px solid ${BORDER}`,
          color: TEXT_MUTED,
        }}
      >
        {railOnly ? <PanelLeftOpen size={12} /> : <PanelLeftClose size={12} />}
      </button>

      {/* Glow top-left */}
      <div className="absolute top-0 left-0 w-48 h-48 pointer-events-none"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--brand, #c9a83a) 7%, transparent) 0%, transparent 70%)" }} />

      {/* Logo + brand block — premium framing with halo + app name in display font.
          Switches to a compact icon-only mark in rail mode so the SWL logo
          doesn't overflow the 64px rail. */}
      <div className={`relative ${railOnly ? "px-3 pt-12 pb-3 flex justify-center" : "px-5 pt-6 pb-5"} border-b`} style={{ borderColor: BORDER }}>
        {/* Soft gold halo behind the logo — hidden in rail mode to keep the
            tiny column visually quiet. */}
        {!railOnly && (
          <div
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              top: 8,
              left: 0,
              right: 0,
              height: 80,
              background: `radial-gradient(ellipse 60% 70% at 22% 50%, color-mix(in srgb, ${GOLD} 20%, transparent) 0%, transparent 70%)`,
            }}
          />
        )}

        {/* Logo — compact (32×32, no decorative box) in rail mode, full
            framed version when expanded. */}
        <div className="relative flex items-center gap-3">
          <div
            className="flex items-center justify-center rounded-xl shrink-0"
            style={railOnly ? {
              padding: 4,
              backgroundColor: `color-mix(in srgb, ${GOLD} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${GOLD} 22%, transparent)`,
            } : {
              padding: "6px 10px",
              backgroundColor: `color-mix(in srgb, ${GOLD} 8%, transparent)`,
              border: `1px solid color-mix(in srgb, ${GOLD} 20%, transparent)`,
              boxShadow: `0 0 22px color-mix(in srgb, ${GOLD} 16%, transparent), inset 0 1px 0 color-mix(in srgb, ${GOLD} 18%, transparent)`,
            }}
          >
            <img
              src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
              alt="SWL Consulting"
              className={`${railOnly ? "h-4" : "h-6"} w-auto object-contain`}
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </div>
        </div>

        {/* App name + tagline — hidden when rail-collapsed so the rail stays
            icon-only and ~64px wide. */}
        <div className="relative mt-3" style={{ display: railOnly ? "none" : "block" }}>
          <h1
            className="text-[19px] font-bold leading-none"
            style={{
              color: "#fff",
              letterSpacing: "-0.01em",
              fontFamily: "var(--font-outfit), system-ui, sans-serif",
            }}
          >
            Growth<span style={{ color: GOLD }}>AI</span>
          </h1>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="inline-block w-1 h-1 rounded-full pulse-dot"
              style={{ backgroundColor: GOLD }}
            />
            <span
              className="text-[9px] font-bold tracking-[0.22em] uppercase"
              style={{ color: GOLD_DIM }}
            >
              Sales Engine
            </span>
          </div>
        </div>

        {/* Bottom gold-fade edge — same treatment as PageHero for consistency */}
        <div
          aria-hidden
          className="absolute left-0 right-0 bottom-0 h-px pointer-events-none"
          style={{
            background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${GOLD} 35%, transparent) 30%, color-mix(in srgb, ${GOLD} 35%, transparent) 70%, transparent 100%)`,
          }}
        />
      </div>

      {/* Tenant switcher — only renders for users with ≥2 memberships.
          Hidden in rail mode (re-appears when sidebar is expanded). */}
      {!railOnly && <TenantSwitcher />}

      {/* Navigation — tightened 2026-05-15 (UX pass): nav padding y-4→y-3,
          section gaps space-y-5→space-y-3, item py-2→py-1.5, gap-3→gap-2.5.
          Same items, ~150px less vertical. */}
      <nav className="relative flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        {visibleSections.map((section) => {
          const isCollapsed = collapsed[section.labelKey];
          // Empty translation = section without a visible header (e.g. Admin
          // pinned to the bottom). We still want collapsibility for the named
          // groups so power users can hide what they don't use.
          const headerText = t(section.labelKey);
          const hideHeader = !headerText;
          return (
            <div key={section.labelKey}>
              {!hideHeader && !railOnly && (
                <button
                  onClick={() => toggleSection(section.labelKey)}
                  className="flex items-center justify-between w-full px-3 mb-1"
                >
                  <span className="text-[9px] font-bold tracking-[0.16em] uppercase"
                    style={{ color: section.labelKey === "nav.section.growth" ? GOLD : TEXT_MUTED }}>
                    {headerText}
                  </span>
                  <ChevronDown size={11} style={{
                    color: TEXT_MUTED,
                    transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                  }} />
                </button>
              )}

              {(railOnly || !isCollapsed || hideHeader) && section.items.map(({ href, labelKey, brandLabel, icon: Icon, tag, badgeKey }) => {
                // Active state: straightforward prefix match. The /overview
                // detour was removed 2026-05-28 r11 — that page was
                // redundant with /campaigns/[id] (the editable detail), so
                // there's no longer a campaign-route variant that should
                // light up /leads in the sidebar.
                const active = pathname === href || (href !== "/" && pathname.startsWith(href));
                const badge = badgeKey ? badges[badgeKey] : 0;
                const itemLabel = brandLabel ?? t(labelKey);

                return (
                  <Link
                    key={href}
                    href={href}
                    title={railOnly ? itemLabel : undefined}
                    className={`flex items-center ${railOnly ? "justify-center" : "gap-2.5"} px-3 py-1.5 rounded-lg text-[13px] font-medium transition-[opacity,transform,box-shadow,background-color,border-color] duration-150 relative`}
                    style={active ? {
                      background: `linear-gradient(90deg, color-mix(in srgb, ${GOLD} 18%, transparent) 0%, color-mix(in srgb, ${GOLD} 4%, transparent) 100%)`,
                      color: GOLD,
                      borderLeft: `2px solid ${GOLD}`,
                      paddingLeft: railOnly ? "10px" : "10px",
                      boxShadow: `0 0 24px color-mix(in srgb, ${GOLD} 14%, transparent), inset 0 1px 0 color-mix(in srgb, ${GOLD} 18%, transparent)`,
                    } : { color: TEXT_BODY }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
                        e.currentTarget.style.color = "#ffffff";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.color = TEXT_BODY;
                      }
                    }}
                  >
                    <Icon size={15} style={{ color: active ? GOLD : TEXT_MUTED, transition: "color 0.15s", filter: active ? `drop-shadow(0 0 6px color-mix(in srgb, ${GOLD} 50%, transparent))` : undefined }} />
                    {!railOnly && <span className="flex-1">{itemLabel}</span>}

                    {!railOnly && tag && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `color-mix(in srgb, ${GOLD} 15%, transparent)`, color: GOLD }}>
                        {tag}
                      </span>
                    )}

                    {badge > 0 && (
                      <span
                        className="pulse-dot inline-block w-2 h-2 rounded-full"
                        style={{
                          backgroundColor: GOLD,
                          position: railOnly ? "absolute" : "static",
                          top: railOnly ? 6 : undefined,
                          right: railOnly ? 6 : undefined,
                        }}
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Recent leads — last 5 leads the user opened, persisted to
          localStorage so they survive nav. One-click jump-back without
          re-running search filters. Hidden in rail mode (no room for labels)
          and when the list is empty. Collapsible header so sellers who don't
          use this can permanently hide it. */}
      {!railOnly && recentLeads.length > 0 && (
        <div className="px-3 pt-1 pb-2 border-t" style={{ borderColor: BORDER }}>
          <button
            onClick={toggleRecent}
            className="flex items-center justify-between w-full px-3 pt-2 pb-1 transition-opacity hover:opacity-80"
            aria-expanded={recentExpanded}
          >
            <span className="text-[9px] font-bold tracking-[0.16em] uppercase" style={{ color: TEXT_MUTED }}>
              Recent leads
            </span>
            <ChevronDown
              size={11}
              style={{
                color: TEXT_MUTED,
                transform: recentExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                transition: "transform 0.18s ease",
              }}
            />
          </button>
          {recentExpanded && (
          <div className="space-y-0.5">
            {recentLeads.map((r) => (
              <Link
                key={r.id}
                href={`/leads/${r.id}`}
                className="flex items-center gap-2 px-3 py-1 rounded-md text-[12px] transition-colors"
                style={{ color: TEXT_BODY }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = TEXT_BODY; }}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, color-mix(in srgb, ${GOLD} 70%, white))`, color: "#04070d" }}
                >
                  {(r.company?.[0] ?? r.name[0] ?? "?").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" style={{ color: "inherit" }}>{r.name}</p>
                  {r.company && <p className="truncate text-[10px]" style={{ color: TEXT_MUTED }}>{r.company}</p>}
                </div>
              </Link>
            ))}
          </div>
          )}
        </div>
      )}

      {/* AI Status — hidden in rail-collapsed mode to keep the column tight. */}
      {!railOnly && (
        <div className="relative mx-4 mb-3 px-3 py-2 rounded-lg"
          style={{ backgroundColor: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)" }}>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: "#22C55E" }} />
            <span className="text-[11px] font-medium" style={{ color: "rgba(34,197,94,0.9)" }}>
              {t("nav.aiActive")}
            </span>
          </div>
        </div>
      )}

      {/* Footer — "Powered by" + settings gear. Settings stays visible in
          rail mode so the gear is reachable without expanding. */}
      <div className={`relative ${railOnly ? "px-2 py-3 justify-center" : "px-5 py-4"} border-t flex items-center gap-2.5`} style={{ borderColor: BORDER }}>
        {!railOnly && (
          <>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{
                background: `linear-gradient(135deg, ${GOLD}, color-mix(in srgb, ${GOLD} 65%, white))`,
                color: "#04070d",
                boxShadow: `0 0 16px color-mix(in srgb, ${GOLD} 28%, transparent)`,
              }}
            >
              S
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[8px] font-bold tracking-[0.2em] uppercase" style={{ color: GOLD_DIM }}>
                Powered by
              </p>
              <p className="text-[13px] font-semibold leading-tight" style={{ color: "#fff", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                SWL Consulting
              </p>
            </div>
          </>
        )}
        <HelpMenu variant="sidebar" />
        <Link
          href="/settings"
          title={t("nav.settings")}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-[opacity,transform,box-shadow,background-color,border-color] shrink-0"
          style={{
            color: pathname.startsWith("/settings") ? GOLD : TEXT_MUTED,
            backgroundColor: pathname.startsWith("/settings") ? `color-mix(in srgb, ${GOLD} 12%, transparent)` : "transparent",
          }}
          onMouseEnter={(e) => { if (!pathname.startsWith("/settings")) { e.currentTarget.style.color = "#fff"; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; } }}
          onMouseLeave={(e) => { if (!pathname.startsWith("/settings")) { e.currentTarget.style.color = TEXT_MUTED; e.currentTarget.style.backgroundColor = "transparent"; } }}
        >
          <Settings size={15} />
        </Link>
      </div>
    </aside>
  );
}
