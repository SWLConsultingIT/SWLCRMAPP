"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import {
  LayoutDashboard, Users, Phone, BarChart3, Building2, Shield,
  Zap, Search, Send, ChevronDown, ChevronRight,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  badgeKey?: string;
};

type NavGroup = {
  label: string;
  icon: React.ElementType;
  children: NavItem[];
};

type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

const nav: NavEntry[] = [
  { href: "/",               label: "Dashboard",    icon: LayoutDashboard },
  { href: "/company-bios",   label: "Company Bio",  icon: Building2 },
  {
    label: "GrowthEngine",
    icon: Zap,
    children: [
      { href: "/icp",        label: "LeadMiner",     icon: Search },
      { href: "/campaigns",  label: "OutreachFlow",  icon: Send },
    ],
  },
  { href: "/leads",          label: "Leads",        icon: Users },
  { href: "/calls",          label: "Call Queue",   icon: Phone, badgeKey: "calls" },
  { href: "/reports",        label: "Reports",      icon: BarChart3 },
  { href: "/admin",          label: "Admin",        icon: Shield, badgeKey: "pending" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [callCount, setCallCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [growthOpen, setGrowthOpen] = useState(true);

  useEffect(() => {
    // Auto-expand GrowthEngine if user is on one of its pages
    if (pathname.startsWith("/icp") || pathname.startsWith("/campaigns")) {
      setGrowthOpen(true);
    }
  }, [pathname]);

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

  function renderLink(item: NavItem) {
    const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
    const badge = item.badgeKey ? badges[item.badgeKey] : 0;
    const Icon = item.icon;

    return (
      <Link key={item.href} href={item.href}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 relative"
        style={active
          ? { background: `linear-gradient(90deg, ${C.goldGlow} 0%, rgba(201,168,58,0.04) 100%)`, color: C.gold, borderLeft: `2px solid ${C.gold}`, paddingLeft: "10px" }
          : { color: "#4e5a72" }
        }
        onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.color = "#9aa3b8"; (e.currentTarget as HTMLElement).style.backgroundColor = "#0d1424"; } }}
        onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.color = "#4e5a72"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; } }}
      >
        <Icon size={15} />
        <span className="flex-1">{item.label}</span>
        {badge > 0 && (
          <span className="flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
            style={{ backgroundColor: C.goldGlow, color: C.gold }}>
            <span className="pulse-dot inline-block w-2 h-2 rounded-full" style={{ backgroundColor: C.gold }} />
          </span>
        )}
      </Link>
    );
  }

  return (
    <aside className="w-56 flex flex-col shrink-0 border-r"
      style={{ backgroundColor: C.sidebarBg, borderColor: C.sidebarBorder }}>

      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: C.sidebarBorder }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black"
            style={{ background: `linear-gradient(135deg, ${C.gold}, #e8c84a)`, color: "#04070d" }}>
            S
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide" style={{ color: C.textOnDark }}>SWL CRM</p>
            <p className="text-xs leading-none mt-0.5" style={{ color: "#4e5a72" }}>Sales Intelligence</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map((entry, idx) => {
          if (isGroup(entry)) {
            const GroupIcon = entry.icon;
            const anyChildActive = entry.children.some(c => pathname === c.href || pathname.startsWith(c.href));

            return (
              <div key={entry.label}>
                <button
                  onClick={() => setGrowthOpen(o => !o)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full transition-all duration-150"
                  style={{ color: anyChildActive ? C.gold : "#4e5a72" }}
                  onMouseEnter={e => { if (!anyChildActive) { (e.currentTarget as HTMLElement).style.color = "#9aa3b8"; (e.currentTarget as HTMLElement).style.backgroundColor = "#0d1424"; } }}
                  onMouseLeave={e => { if (!anyChildActive) { (e.currentTarget as HTMLElement).style.color = "#4e5a72"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; } }}
                >
                  <GroupIcon size={15} />
                  <span className="flex-1 text-left">{entry.label}</span>
                  {growthOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>

                {growthOpen && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-2" style={{ borderColor: "#1a2540" }}>
                    {entry.children.map(child => renderLink(child))}
                  </div>
                )}
              </div>
            );
          }

          return renderLink(entry);
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t" style={{ borderColor: C.sidebarBorder }}>
        <p className="text-xs" style={{ color: "#2a3348" }}>SWL Consulting © 2026</p>
      </div>
    </aside>
  );
}
