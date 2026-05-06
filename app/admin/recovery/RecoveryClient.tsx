"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, RotateCcw, Trash2, Loader2, AlertTriangle, Clock } from "lucide-react";
import { C } from "@/lib/design";

type ArchivedBio = {
  id: string;
  company_name: string;
  archived_at: string;
  logo_url: string | null;
  industry: string | null;
  leads_count: number;
};

const RECOVERY_WINDOW_DAYS = 30;

function daysUntilHardDelete(archivedAt: string): number {
  const ms = new Date(archivedAt).getTime() + RECOVERY_WINDOW_DAYS * 86_400_000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export default function RecoveryClient({ bios }: { bios: ArchivedBio[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(id: string) {
    setBusyId(id); setError(null);
    try {
      const r = await fetch(`/api/company-bios/${id}/archive`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to restore");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3 max-w-4xl">
      {error && (
        <div className="rounded-lg px-4 py-3 flex items-start gap-2.5" style={{ backgroundColor: C.redLight, border: `1px solid ${C.red}40` }}>
          <AlertTriangle size={14} style={{ color: C.red, flexShrink: 0, marginTop: 2 }} />
          <p className="text-xs font-medium" style={{ color: C.red }}>{error}</p>
        </div>
      )}

      {bios.map(b => {
        const daysLeft = daysUntilHardDelete(b.archived_at);
        const urgent = daysLeft <= 3;
        return (
          <div key={b.id}
            className="rounded-2xl border p-4 flex items-center gap-4"
            style={{ borderColor: C.border, backgroundColor: C.card }}>

            {/* Logo */}
            <div className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0"
              style={{ borderColor: C.border, backgroundColor: "#fff" }}>
              {b.logo_url
                ? <img src={b.logo_url} alt="" className="w-full h-full object-contain p-1.5 rounded-xl" />
                : <Building2 size={18} style={{ color: C.textDim }} />}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{b.company_name}</p>
              <p className="text-[11px]" style={{ color: C.textMuted }}>
                {b.industry ?? "—"} · {b.leads_count.toLocaleString()} leads
              </p>
            </div>

            {/* Time left */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{
              backgroundColor: urgent ? C.redLight : C.surface,
              color: urgent ? C.red : C.textMuted,
            }}>
              <Clock size={11} />
              <span className="text-[11px] font-semibold tabular-nums">
                {daysLeft === 0 ? "expires today" : `${daysLeft}d left`}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button onClick={() => restore(b.id)} disabled={busyId === b.id}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: C.green, color: "#fff" }}>
                {busyId === b.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                Restore
              </button>
            </div>
          </div>
        );
      })}

      <p className="text-[10px] mt-4 px-2" style={{ color: C.textDim }}>
        <Trash2 size={10} className="inline mr-1 opacity-50" />
        After {RECOVERY_WINDOW_DAYS} days the tenant and all its data are permanently deleted by the daily cleanup. There is no recovery beyond this window.
      </p>
    </div>
  );
}
