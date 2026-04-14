"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import {
  LayoutDashboard, Users, Megaphone,
  Building2, Target, Shield, ChevronDown, Zap, Bell, Trophy,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  tag?: string;
  badgeKey?: "calls" | "pending";
};

const sections: { label: string; items: NavItem[] }[] = [
  {
    label: "MAIN",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/company-bios", label: "Company Bio", icon: Building2 },
    ],
  },
  {
    label: "GROWTH ENGINE",
    items: [
      { href: "/icp", label: "Lead Miner\u2122", icon: Target, tag: "AI" },
      { href: "/campaigns", label: "Outreach Flow\u2122", icon: Megaphone, tag: "AI" },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { href: "/leads", label: "Leads & Campaigns", icon: Users },
      { href: "/opportunities", label: "Opportunities", icon: Trophy },
      { href: "/queue", label: "Queue", icon: Bell, badgeKey: "calls" },
      { href: "/admin", label: "Admin", icon: Shield, badgeKey: "pending" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [callCount, setCallCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function fetchBadges() {
      const [{ count: calls }, { count: pendingReview }, { count: pendingExec }, { count: pendingCampaigns }] = await Promise.all([
        supabase.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "active").eq("channel", "call"),
        supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("icp_profiles").select("*", { count: "exact", head: true }).eq("status", "approved").in("execution_status", ["not_started", "in_progress"]),
        supabase.from("campaign_requests").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      ]);
      setCallCount(calls ?? 0);
      setPendingCount((pendingReview ?? 0) + (pendingExec ?? 0) + (pendingCampaigns ?? 0));
    }
    fetchBadges();
    const interval = setInterval(fetchBadges, 60000);
    return () => clearInterval(interval);
  }, []);

  const badges: Record<string, number> = { calls: callCount, pending: pendingCount };

  const toggleSection = (label: string) => {
    setCollapsed(prev => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <aside
      className="w-60 flex flex-col shrink-0 border-r"
      style={{
        backgroundColor: C.sidebarBg,
        borderColor: C.sidebarBorder,
        boxShadow: "1px 0 8px rgba(0,0,0,0.03)",
      }}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: C.sidebarBorder }}>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${C.gold}, #e8c84a)`,
              boxShadow: `0 2px 8px rgba(201,168,58,0.3)`,
            }}
          >
            <Zap size={18} color="#FFFFFF" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide" style={{ color: C.sidebarTextActive }}>
              GrowthAI
            </p>
            <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: C.gold }}>
              Sales Engine
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {sections.map((section) => {
          const isCollapsed = collapsed[section.label];
          return (
            <div key={section.label}>
              {/* Section header */}
              <button
                onClick={() => toggleSection(section.label)}
                className="flex items-center justify-between w-full px-3 mb-1.5"
              >
                <span
                  className="text-[10px] font-bold tracking-[0.12em] uppercase"
                  style={{
                    color: section.label === "GROWTH ENGINE" ? C.gold : C.sidebarSection,
                    ...(section.label === "GROWTH ENGINE"
                      ? {
                          backgroundColor: C.goldGlow,
                          padding: "3px 8px",
                          borderRadius: "4px",
                        }
                      : {}),
                  }}
                >
                  {section.label}
                </span>
                <ChevronDown
                  size={12}
                  style={{
                    color: C.sidebarSection,
                    transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                  }}
                />
              </button>

              {/* Items */}
              {!isCollapsed &&
                section.items.map(({ href, label, icon: Icon, tag, badgeKey }) => {
                  const active = pathname === href || (href !== "/" && pathname.startsWith(href));
                  const badge = badgeKey ? badges[badgeKey] : 0;

                  return (
                    <Link
                      key={href}
                      href={href}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 group"
                      style={
                        active
                          ? {
                              backgroundColor: C.goldGlow,
                              color: C.gold,
                              borderLeft: `2.5px solid ${C.gold}`,
                              paddingLeft: "10px",
                            }
                          : { color: C.sidebarText }
                      }
                      onMouseEnter={(e) => {
                        if (!active) {
                          e.currentTarget.style.backgroundColor = "#F9FAFB";
                          e.currentTarget.style.color = C.sidebarTextActive;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!active) {
                          e.currentTarget.style.backgroundColor = "transparent";
                          e.currentTarget.style.color = C.sidebarText;
                        }
                      }}
                    >
                      <Icon
                        size={16}
                        style={{
                          color: active ? C.gold : C.sidebarSection,
                          transition: "color 0.15s ease",
                        }}
                      />
                      <span className="flex-1">{label}</span>

                      {/* AI tag */}
                      {tag && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: C.goldGlow,
                            color: C.gold,
                          }}
                        >
                          {tag}
                        </span>
                      )}

                      {/* Badge count */}
                      {badge > 0 && (
                        <span className="flex items-center justify-center">
                          <span
                            className="pulse-dot inline-block w-2 h-2 rounded-full"
                            style={{ backgroundColor: C.gold }}
                          />
                        </span>
                      )}
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </nav>

      {/* AI Status */}
      <div className="mx-4 mb-3 px-3 py-2 rounded-lg" style={{ backgroundColor: "#F0FDF4" }}>
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full pulse-dot"
            style={{ backgroundColor: "#22C55E" }}
          />
          <span className="text-[11px] font-medium" style={{ color: "#15803D" }}>
            AI Models Active
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t" style={{ borderColor: C.sidebarBorder }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ backgroundColor: C.goldGlow, color: C.gold }}
          >
            GE
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: C.sidebarTextActive }}>Growth Engine</p>
            <p className="text-[10px]" style={{ color: C.sidebarSection }}>SWL Consulting</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
