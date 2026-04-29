"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import PositiveReplyBanner from "@/components/PositiveReplyBanner";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import CommandPalette from "@/components/CommandPalette";
import NavigationProgress from "@/components/NavigationProgress";
import DemoBanner from "@/components/DemoBanner";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = ["/login", "/signup", "/forgot-password", "/onboarding"].includes(pathname);
  const isPrint = pathname === "/reports/print";

  if (isPublic || isPrint) {
    return <>{children}</>;
  }

  return (
    <>
      <NavigationProgress />
      <div className="flex h-full">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <DemoBanner />
          <TopHeader />
          <main className="flex-1 overflow-y-auto main-bg">
            {children}
          </main>
        </div>
        <PositiveReplyBanner />
        <RealtimeRefresh />
        <CommandPalette />
      </div>
    </>
  );
}
