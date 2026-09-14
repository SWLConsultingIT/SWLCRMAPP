"use client";

import { useState } from "react";
import { useLocale } from "@/shared/i18n/i18n";
import { useRouter } from "next/navigation";
import { RefreshCw, Check } from "lucide-react";
import { C } from "@/shared/design/tokens";
import { useViewAsReadOnly } from "@/shared/auth/use-view-as";

export default function SyncAircallButton() {
  const { t } = useLocale();
  const { readOnly, label: viewAsOff } = useViewAsReadOnly();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function sync() {
    if (readOnly) return;
    setLoading(true);
    setDone(false);
    try {
      await fetch("/api/aircall/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      });
      setDone(true);
      router.refresh();
      setTimeout(() => setDone(false), 2000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={sync}
      disabled={loading || readOnly}
      title={readOnly ? viewAsOff : undefined}
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
      style={{
        borderColor: C.border,
        backgroundColor: done ? "color-mix(in srgb, #16A34A 16%, transparent)" : C.card,
        color: done ? "#16A34A" : C.textMuted,
      }}
    >
      {done ? (
        <><Check size={12} /> {t("sab.synced")}</>
      ) : (
        <><RefreshCw size={12} className={loading ? "animate-spin" : ""} /> {loading ? "Syncing…" : "Sync from Aircall"}</>
      )}
    </button>
  );
}
