"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RealtimeRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flash, setFlash] = useState(false);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      router.refresh();
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    }, 600);
  }, [router]);

  useEffect(() => {
    const channel = supabase
      .channel("crm-global")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaigns" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_replies" }, refresh)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  if (!flash) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full text-xs font-medium pointer-events-none fade-in"
      style={{ backgroundColor: "rgba(14,21,32,0.95)", color: "var(--brand, #c9a83a)", border: "1px solid color-mix(in srgb, var(--brand, #c9a83a) 25%, transparent)" }}
    >
      ● Datos actualizados
    </div>
  );
}
