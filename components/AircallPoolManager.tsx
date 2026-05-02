"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Phone, X, Loader2, Check } from "lucide-react";
import { C } from "@/lib/design";

// Modal that lets a tenant claim Aircall numbers into their pool.
// Same shape as EmailPoolManager but for `company_bios.aircall_number_ids`.
// Numbers claimed by other tenants are hidden so we never leak their phone
// lines through the picker.

type PoolNumber = {
  id: number;
  name: string;
  digits: string;
  country: string;
  availability: string;
  isActive: boolean;
  isMine: boolean;
  claimedByOther: boolean;
  claimedByName: string | null;
};

export default function AircallPoolManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [numbers, setNumbers] = useState<PoolNumber[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetch("/api/settings/aircall-pool", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        if (d.error) { setError(d.error); return; }
        const list = (d.numbers ?? []) as PoolNumber[];
        setNumbers(list);
        setSelected(new Set(list.filter(n => n.isMine).map(n => n.id)));
      })
      .catch(() => alive && setError("Failed to load Aircall numbers"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [open]);

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/aircall-pool", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numberIds: Array.from(selected) }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Save failed");
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const visibleNumbers = numbers.filter(n => !n.claimedByOther);
  const myCount = visibleNumbers.filter(n => n.isMine).length;
  const availableCount = visibleNumbers.filter(n => !n.isMine).length;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border max-h-[85vh] flex flex-col"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#F97316" + "15" }}>
              <Phone size={16} style={{ color: "#F97316" }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Manage Aircall Numbers</h2>
              <p className="text-[11px]" style={{ color: C.textMuted }}>
                Pick which Aircall lines belong to your tenant
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5" aria-label="Close">
            <X size={16} style={{ color: C.textMuted }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2" style={{ color: C.textMuted }}>
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading Aircall numbers…</span>
            </div>
          ) : visibleNumbers.length === 0 ? (
            <p className="text-sm text-center py-10" style={{ color: C.textDim }}>
              No Aircall numbers available. Provision numbers in the Aircall dashboard first.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-3 text-[11px]" style={{ color: C.textMuted }}>
                <span><b style={{ color: C.textBody }}>{myCount}</b> yours</span>
                <span><b style={{ color: C.textBody }}>{availableCount}</b> available to claim</span>
              </div>
              <div className="space-y-1.5">
                {visibleNumbers.map(n => {
                  const isChecked = selected.has(n.id);
                  return (
                    <label
                      key={n.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer hover:bg-black/[0.02]"
                      style={{ borderColor: isChecked ? `color-mix(in srgb, ${C.gold} 35%, transparent)` : C.border, backgroundColor: isChecked ? `color-mix(in srgb, ${C.gold} 4%, transparent)` : "transparent" }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(n.id)}
                        style={{ accentColor: C.gold }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>
                          {n.name} <span style={{ color: C.textMuted }}>· {n.digits}</span>
                        </p>
                        <p className="text-[10px]" style={{ color: C.textMuted }}>
                          {n.country} · {n.availability}
                          {!n.isActive && " · inactive"}
                        </p>
                      </div>
                      {n.isMine && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ backgroundColor: `${C.green}15`, color: C.green }}>
                          <Check size={10} /> yours
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {error && (
            <div className="mt-4 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: `${C.red}30`, backgroundColor: `${C.red}10`, color: C.red }}>
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: C.border }}>
          <button
            onClick={onClose}
            className="text-xs font-medium px-3 py-2 rounded-lg border"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: C.gold, color: "#04070d" }}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
