"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { TrendingUp, X } from "lucide-react";
import Link from "next/link";

type NewReply = { id: string; lead_id: string; name: string; company: string };

export default function PositiveReplyBanner() {
  const [toasts, setToasts] = useState<NewReply[]>([]);

  useEffect(() => {
    // Poll every 30s for positive replies in the last 5 minutes
    async function check() {
      const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("lead_replies")
        .select("id, lead_id, leads(first_name, last_name, company)")
        .eq("classification", "positive")
        .gte("received_at", since)
        .limit(5);

      if (!data?.length) return;

      setToasts(prev => {
        const existingIds = new Set(prev.map(t => t.id));
        const newItems = (data as any[])
          .filter(r => !existingIds.has(r.id))
          .map(r => ({
            id: r.id,
            lead_id: r.lead_id,
            name: `${r.leads?.first_name ?? ""} ${r.leads?.last_name ?? ""}`.trim(),
            company: r.leads?.company ?? "",
          }));
        return [...prev, ...newItems].slice(-3); // max 3
      });
    }

    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  function dismiss(id: string) {
    setToasts(t => t.filter(x => x.id !== id));
  }

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-6 right-6 space-y-2 z-50">
      {toasts.map(t => (
        <div key={t.id} className="toast-in flex items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl max-w-72"
          style={{ backgroundColor: C.card, borderColor: `${C.green}30`, boxShadow: `0 0 24px ${C.greenGlow}` }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: C.greenGlow }}>
            <TrendingUp size={15} style={{ color: C.green }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: C.green }}>¡Respuesta positiva!</p>
            <Link href={`/leads/${t.lead_id}`} onClick={() => dismiss(t.id)}
              className="text-sm font-medium mt-0.5 block hover:underline" style={{ color: C.textPrimary }}>
              {t.name || "Lead"}
            </Link>
            {t.company && <p className="text-xs" style={{ color: C.textMuted }}>{t.company}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 mt-0.5" style={{ color: C.textMuted }}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
