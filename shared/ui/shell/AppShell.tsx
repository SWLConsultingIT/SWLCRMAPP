"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/shared/ui/shell/Sidebar";
import TopHeader from "@/shared/ui/shell/TopHeader";
import PositiveReplyBanner from "@/components/PositiveReplyBanner";
import RealtimeRefresh from "@/shared/ui/shell/RealtimeRefresh";
import CommandPalette from "@/shared/ui/shell/CommandPalette";
import NavigationProgress from "@/shared/ui/shell/NavigationProgress";
import NavigationLoader from "@/shared/ui/shell/NavigationLoader";
import DemoBanner from "@/components/DemoBanner";
import ViewAsBanner from "@/components/ViewAsBanner";
import ViewAsEndedToast from "@/components/ViewAsEndedToast";
import KeyboardCheatsheet from "@/shared/ui/shell/KeyboardCheatsheet";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { ToastProvider } from "@/shared/ui/toast";
import { MobileMenuProvider } from "@/shared/ui/shell/mobile-menu";

// LogoLoader is the global route-transition loader (gold SWL mark). It
// dismisses immediately when the next pathname renders so it doesn't stack
// on top of per-page spinners — previous double-loader complaints came from
// a MIN_DURATION delay that's been removed. NavigationProgress (top bar) and
// NavigationLoader (full-screen mark) run together: bar appears while the
// route is in flight, full-screen mark covers the gap between click and the
// next page's first paint.

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = ["/login", "/signup", "/forgot-password", "/onboarding"].includes(pathname);
  // Any /print route renders chrome-less (no sidebar/header) so the exported
  // PDF is just the document. Covers /reports/print and /icp/[id]/print.
  const isPrint = pathname.endsWith("/print");

  if (isPublic || isPrint) {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <MobileMenuProvider>
      <NavigationProgress />
      <div className="flex h-full">
        <Sidebar />
        {/* min-w-0 is the load-bearing fix: without it, flex children with
            wide content (data tables, KPI grids) inflate the flex-1 column
            to fit their intrinsic width and overflow the viewport. When the
            sidebar collapses to 64px the extra space DOES get released, but
            the content was already locked to the wider intrinsic min-width
            from before. Forcing min-width:0 lets the column actually shrink
            back to whatever the parent flex allocates. */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <DemoBanner />
          <ViewAsBanner />
          <TopHeader />
          <main className="flex-1 overflow-y-auto main-bg">
            <NavigationLoader>{children}</NavigationLoader>
          </main>
        </div>
        <OnboardingChecklist />
        <ViewAsEndedToast />
        <PositiveReplyBanner />
        <RealtimeRefresh />
        <CommandPalette />
        <KeyboardCheatsheet />
      </div>
      </MobileMenuProvider>
    </ToastProvider>
  );
}
