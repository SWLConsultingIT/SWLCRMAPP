"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import LogoLoader from "@/components/LogoLoader";

// Forces the gold LogoLoader to appear on every internal navigation,
// regardless of whether the destination is a server or client component.
// Next.js' app/loading.tsx Suspense only fires for server components
// without prefetched data — that left /icp, /company-bios and other
// client-component pages with no transition state at all.

export default function NavigationLoader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const prevPath = useRef(pathname);

  useEffect(() => {
    function onAnchorClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (a.target === "_blank") return;
      const target = href.split("?")[0].split("#")[0];
      const current = pathname.split("?")[0];
      if (target === current) return;
      setLoading(true);
    }
    document.addEventListener("click", onAnchorClick, true);
    return () => document.removeEventListener("click", onAnchorClick, true);
  }, [pathname]);

  useEffect(() => {
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    setLoading(false);
  }, [pathname]);

  if (loading) return <LogoLoader />;
  return <>{children}</>;
}
