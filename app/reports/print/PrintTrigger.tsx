"use client";

import { useEffect } from "react";

export default function PrintTrigger() {
  useEffect(() => {
    // When embedded in a hidden print iframe (e.g. the ICP "Download" button),
    // the parent triggers printing — skip the auto-print here to avoid a double
    // dialog. Standalone /print tabs are top-level and still auto-print.
    if (typeof window !== "undefined" && window.top !== window.self) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return null;
}
