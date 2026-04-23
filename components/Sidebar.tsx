"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useLocale } from "@/lib/i18n";
import {
  LayoutDashboard, Users, Megaphone,
  Building2, Target, Shield, ChevronDown, Bell, Trophy, UserCircle, Settings,
} from "lucide-react";

const DARK   = "#060c18";
const BORDER = "rgba(201,168,58,0.14)";
const GOLD   = "#c9a83a";
const GOLD_DIM = "rgba(201,168,58,0.75)";
const TEXT_MUTED = "rgba(255,255,255,0.55)";
const TEXT_BODY  = "rgba(255,255,255,0.85)";

type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  brandLabel?: string;
  tag?: string;
  badgeKey?: "calls" | "pending";
  adminOnly?: boolean;
};

const sections: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: "nav.section.main",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { href: "/company-bios", labelKey: "nav.companyBio", icon: Building2 },
    ],
  },
  {
    labelKey: "nav.section.growth",
    items: [
      { href: "/icp", labelKey: "", brandLabel: "Lead Miner™", icon: Target, tag: "AI" },
      { href: "/campaigns", labelKey: "", brandLabel: "Outreach Flow™", icon: Megaphone, tag: "AI" },
    ],
  },
  {
    labelKey: "nav.section.operations",
    items: [
      { href: "/leads", labelKey: "nav.leads", icon: Users },
      { href: "/accounts", labelKey: "nav.accounts", icon: UserCircle },
      { href: "/opportunities", labelKey: "nav.opportunities", icon: Trophy },
      { href: "/queue", labelKey: "nav.queue", icon: Bell, badgeKey: "calls" },
      { href: "/admin", labelKey: "nav.admin", icon: Shield, badgeKey: "pending", adminOnly: true },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLocale();
  const [callCount, setCallCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [role, setRole] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => setRole(d.user?.role ?? "")).catch(() => {});
  }, []);

  useEffect(() => {
    async function fetchBadges() {
      const sb = getSupabaseBrowser();
      const [{ count: calls }, { count: pendingReview }, { count: pendingExec }, { count: pendingCampaigns }] = await Promise.all([
        sb.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "active").eq("channel", "call"),
        sb.from("icp_profiles").select("*", { count: "exact", head: true }).eq("status", "pending"),
        sb.from("icp_profiles").select("*", { count: "exact", head: true }).eq("status", "approved").in("execution_status", ["not_started", "in_progress"]),
        sb.from("campaign_requests").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      ]);
      setCallCount(calls ?? 0);
      setPendingCount((pendingReview ?? 0) + (pendingExec ?? 0) + (pendingCampaigns ?? 0));
    }
    fetchBadges();
    const interval = setInterval(fetchBadges, 60000);
    return () => clearInterval(interval);
  }, []);

  const isAdmin = role === "admin";
  const visibleSections = sections.map(s => ({
    ...s,
    items: s.items.filter(item => !item.adminOnly || isAdmin),
  })).filter(s => s.items.length > 0);

  const badges: Record<string, number> = { calls: callCount, pending: pendingCount };
  const toggleSection = (label: string) => setCollapsed(prev => ({ ...prev, [label]: !prev[label] }));

  return (
    <aside
      className="w-60 flex flex-col shrink-0 border-r relative"
      style={{
        backgroundColor: DARK,
        borderColor: BORDER,
        backgroundImage: `
          linear-gradient(rgba(201,168,58,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(201,168,58,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }}
    >
      {/* Glow top-left */}
      <div className="absolute top-0 left-0 w-48 h-48 pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(201,168,58,0.07) 0%, transparent 70%)" }} />

      {/* Logo */}
      <div className="relative px-5 py-5 border-b" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-3">
          <img
            src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
            alt="SWL Consulting"
            className="h-7 w-auto object-contain"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        </div>
        <p className="text-[9px] font-bold tracking-[0.18em] uppercase mt-1" style={{ color: GOLD_DIM }}>
          Growth Platform
        </p>
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {visibleSections.map((section) => {
          const isCollapsed = collapsed[section.labelKey];
          return (
            <div key={section.labelKey}>
              <button
                onClick={() => toggleSection(section.labelKey)}
                className="flex items-center justify-between w-full px-3 mb-1.5"
              >
                <span className="text-[9px] font-bold tracking-[0.16em] uppercase"
                  style={{ color: section.labelKey === "nav.section.growth" ? GOLD : TEXT_MUTED }}>
                  {t(section.labelKey)}
                </span>
                <ChevronDown size={11} style={{
                  color: TEXT_MUTED,
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                }} />
              </button>

              {!isCollapsed && section.items.map(({ href, labelKey, brandLabel, icon: Icon, tag, badgeKey }) => {
                const isOverviewPage = pathname.includes("/overview");
                const active = href === "/leads"
                  ? (pathname.startsWith("/leads") || (pathname.startsWith("/campaigns/") && isOverviewPage))
                  : href === "/campaigns"
                    ? (pathname.startsWith("/campaigns") && !isOverviewPage)
                    : pathname === href || (href !== "/" && pathname.startsWith(href));
                const badge = badgeKey ? badges[badgeKey] : 0;

                return (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150"
                    style={active ? {
                      background: `linear-gradient(90deg, rgba(201,168,58,0.15) 0%, rgba(201,168,58,0.04) 100%)`,
                      color: GOLD,
                      borderLeft: `2px solid ${GOLD}`,
                      paddingLeft: "10px",
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
                    <Icon size={15} style={{ color: active ? GOLD : TEXT_MUTED, transition: "color 0.15s" }} />
                    <span className="flex-1">{brandLabel ?? t(labelKey)}</span>

                    {tag && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: "rgba(201,168,58,0.15)", color: GOLD }}>
                        {tag}
                      </span>
                    )}

                    {badge > 0 && (
                      <span className="pulse-dot inline-block w-2 h-2 rounded-full" style={{ backgroundColor: GOLD }} />
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* AI Status */}
      <div className="relative mx-4 mb-3 px-3 py-2 rounded-lg"
        style={{ backgroundColor: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)" }}>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: "#22C55E" }} />
          <span className="text-[11px] font-medium" style={{ color: "rgba(34,197,94,0.9)" }}>
            {t("nav.aiActive")}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="relative px-5 py-4 border-t flex items-center gap-2.5" style={{ borderColor: BORDER }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: `linear-gradient(135deg, ${GOLD}, #e8c84a)`, color: "#fff" }}>
          S
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>SWL Consulting</p>
          <p className="text-[10px]" style={{ color: GOLD_DIM }}>Growth Platform</p>
        </div>
        <Link
          href="/settings"
          title={t("nav.settings")}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-all shrink-0"
          style={{
            color: pathname.startsWith("/settings") ? GOLD : TEXT_MUTED,
            backgroundColor: pathname.startsWith("/settings") ? "rgba(201,168,58,0.12)" : "transparent",
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
