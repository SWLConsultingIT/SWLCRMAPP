"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import PositiveReplyBanner from "@/components/PositiveReplyBanner";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import CommandPalette from "@/components/CommandPalette";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopHeader />
        <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "#F7F8FB" }}>
          {children}
        </main>
      </div>
      <PositiveReplyBanner />
      <RealtimeRefresh />
      <CommandPalette />
    </div>
  );
}
