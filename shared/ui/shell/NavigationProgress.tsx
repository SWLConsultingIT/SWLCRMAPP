"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export default function NavigationProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [pct, setPct] = useState(0);
  const prevPath = useRef(pathname);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const done = useRef(false);

  // Intercept link clicks → start bar
  useEffect(() => {
    function onAnchorClick(e: MouseEvent) {
      const a = (e.target as HTMLElement).closest("a[href]");
      if (!a) return;
      const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
      if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:") || href === pathname) return;
      done.current = false;
      setVisible(true);
      setPct(5);
    }
    document.addEventListener("click", onAnchorClick, true);
    return () => document.removeEventListener("click", onAnchorClick, true);
  }, [pathname]);

  // When route changes → complete bar
  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname;
      done.current = true;
      setPct(100);
      const t = setTimeout(() => { setVisible(false); setPct(0); }, 380);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  // Fake progress while loading
  useEffect(() => {
    clearInterval(tick.current);
    if (visible && !done.current) {
      tick.current = setInterval(() => {
        setPct(p => {
          if (p >= 88) { clearInterval(tick.current); return p; }
          return p + Math.random() * 12;
        });
      }, 160);
    }
    return () => clearInterval(tick.current);
  }, [visible]);

  if (!visible && pct === 0) return null;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, height: 3, pointerEvents: "none" }}>
      <div
        style={{
          height: "100%",
          width: `${Math.min(pct, 100)}%`,
          background: "linear-gradient(90deg, var(--brand, #c9a83a) 0%, color-mix(in srgb, var(--brand, #c9a83a) 72%, white) 50%, #f0d060 100%)",
          boxShadow: "0 0 10px color-mix(in srgb, var(--brand, #c9a83a) 65%, transparent), 0 0 4px color-mix(in srgb, var(--brand, #c9a83a) 40%, transparent)",
          borderRadius: "0 3px 3px 0",
          transition: pct === 100
            ? "width 0.15s ease"
            : "width 0.22s cubic-bezier(0.22,1,0.36,1)",
          opacity: pct === 100 ? 0 : 1,
          transitionProperty: pct === 100 ? "width, opacity" : "width",
          transitionDuration: pct === 100 ? "0.15s, 0.3s" : "0.22s",
          transitionDelay: pct === 100 ? "0s, 0.1s" : "0s",
        }}
      />
    </div>
  );
}
