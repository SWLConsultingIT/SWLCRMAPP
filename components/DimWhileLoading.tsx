"use client";

// Dims its children while a filter transition is in flight, then clears when
// the server commits new data (signalled by the dataKey prop changing).
//
// Flow:
//  1. TabFilterBar dispatches "filter-loading-start" before router.replace()
//  2. This component sets isLoading=true → children fade to 35% opacity
//  3. Server re-renders with new filter params
//  4. dataKey prop (= filterKey) changes → useEffect sets isLoading=false
//  5. Children return to full opacity with the new data already in the DOM
//
// Tab switching does NOT trigger the dim because filterKey excludes ?tab.

import { useEffect, useState } from "react";

export default function DimWhileLoading({
  children,
  dataKey,
}: {
  children: React.ReactNode;
  dataKey: string;
}) {
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const onStart = () => setIsLoading(true);
    window.addEventListener("filter-loading-start", onStart);
    return () => window.removeEventListener("filter-loading-start", onStart);
  }, []);

  // When the server commits new data, dataKey changes → clear the dim.
  useEffect(() => {
    setIsLoading(false);
  }, [dataKey]);

  return (
    <div
      style={{
        opacity: isLoading ? 0.35 : 1,
        pointerEvents: isLoading ? "none" : undefined,
        transition: "opacity 0.18s ease",
      }}
    >
      {children}
    </div>
  );
}
