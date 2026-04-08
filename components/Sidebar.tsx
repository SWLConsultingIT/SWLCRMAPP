"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { LayoutDashboard, Users, Megaphone, Phone, BarChart3 } from "lucide-react";

const nav = [
  { href: "/",          label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads",     label: "Leads",     icon: Users },
  { href: "/campaigns", label: "Campañas",  icon: Megaphone },
  { href: "/calls",     label: "Llamadas",  icon: Phone,     badgeKey: "calls" },
  { href: "/reports",   label: "Reportes",  icon: BarChart3 },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [callCount, setCallCount] = useState(0);

  useEffect(() => {
    async function fetchCalls() {
      const { count } = await supabase
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .eq("status", "active")
        .eq("channel", "call");
      setCallCount(count ?? 0);
    }
    fetchCalls();
    const interval = setInterval(fetchCalls, 60000);
    return () => clearInterval(interval);
  }, []);

  const badges: Record<string, number> = { calls: callCount };

  return (
    <aside className="w-56 flex flex-col shrink-0 border-r"
      style={{ backgroundColor: "#050810", borderColor: "#253043" }}>

      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black"
            style={{ background: `linear-gradient(135deg, ${C.gold}, #e8c84a)`, color: "#04070d" }}>
            S
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide" style={{ color: C.textPrimary }}>SWL CRM</p>
            <p className="text-xs leading-none mt-0.5" style={{ color: C.textMuted }}>Consulting</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon, badgeKey }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          const badge = badgeKey ? badges[badgeKey] : 0;
          return (
            <Link key={href} href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 relative"
              style={active
                ? { background: `linear-gradient(90deg, ${C.goldGlow} 0%, rgba(201,168,58,0.04) 100%)`, color: C.gold, borderLeft: `2px solid ${C.gold}`, paddingLeft: "10px" }
                : { color: C.textMuted }
              }
              onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.color = C.textBody; (e.currentTarget as HTMLElement).style.backgroundColor = C.card; } }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.color = C.textMuted; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; } }}
            >
              <Icon size={15} />
              <span className="flex-1">{label}</span>
              {badge > 0 && (
                <span className="flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
                  style={{ backgroundColor: C.goldGlow, color: C.gold }}>
                  <span className="pulse-dot inline-block w-2 h-2 rounded-full" style={{ backgroundColor: C.gold }} />
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t" style={{ borderColor: C.border }}>
        <p className="text-xs" style={{ color: C.textDim }}>SWL Consulting © 2026</p>
      </div>
    </aside>
  );
}
