"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mail, X, Loader2, Check } from "lucide-react";
import { C } from "@/lib/design";

// Modal that lets a tenant claim Instantly email accounts into their pool.
// Lists every account in the connected Instantly org with one of three states:
//   - Mine        → already in this tenant's email_accounts (checkbox on)
//   - Available   → unowned by any tenant (checkbox togglable)
//   - Other       → claimed by another tenant (checkbox disabled, label shown)
//
// Save calls PATCH /api/settings/email-pool which validates server-side that
// nothing in the new list belongs to another tenant before writing the row.

type PoolAccount = {
  email: string;
  dailyLimit: number;
  warmupScore: number;
  setupPending: boolean;
  isMine: boolean;
  claimedByOther: boolean;
  claimedByName: string | null;
};

export default function EmailPoolManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<PoolAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetch("/api/settings/email-pool", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        if (d.error) { setError(d.error); return; }
        const list = (d.accounts ?? []) as PoolAccount[];
        setAccounts(list);
        setSelected(new Set(list.filter(a => a.isMine).map(a => a.email)));
      })
      .catch(() => alive && setError("Failed to load Instantly pool"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [open]);

  function toggle(email: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/email-pool", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: Array.from(selected) }),
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

  // Per spec: a tenant should only see emails relevant to them — either
  // already claimed by their tenant or unowned and therefore claimable.
  // Emails owned by another tenant are hidden entirely (no leaking other
  // tenants' inbox names through the picker).
  const visibleAccounts = accounts.filter(a => !a.claimedByOther);
  const myCount = visibleAccounts.filter(a => a.isMine).length;
  const availableCount = visibleAccounts.filter(a => !a.isMine).length;

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
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#7C3AED15" }}>
              <Mail size={16} style={{ color: "#7C3AED" }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Manage Email Pool</h2>
              <p className="text-[11px]" style={{ color: C.textMuted }}>
                Pick which Instantly inboxes belong to your tenant
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5" aria-label="Close">
            <X size={16} style={{ color: C.textMuted }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2" style={{ color: C.textMuted }}>
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading Instantly accounts…</span>
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-center py-10" style={{ color: C.textDim }}>
              No Instantly accounts available. Connect accounts in the Instantly dashboard first.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-3 text-[11px]" style={{ color: C.textMuted }}>
                <span><b style={{ color: C.textBody }}>{myCount}</b> yours</span>
                <span><b style={{ color: C.textBody }}>{availableCount}</b> available to claim</span>
              </div>
              <div className="space-y-1.5">
                {visibleAccounts.map(a => {
                  const isChecked = selected.has(a.email);
                  return (
                    <label
                      key={a.email}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer hover:bg-black/[0.02]"
                      style={{ borderColor: isChecked ? `color-mix(in srgb, ${C.gold} 35%, transparent)` : C.border, backgroundColor: isChecked ? `color-mix(in srgb, ${C.gold} 4%, transparent)` : "transparent" }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(a.email)}
                        style={{ accentColor: C.gold }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{a.email}</p>
                        <p className="text-[10px]" style={{ color: C.textMuted }}>
                          Daily limit {a.dailyLimit} · Warmup score {a.warmupScore}
                          {a.setupPending && " · setup pending"}
                        </p>
                      </div>
                      {a.isMine && (
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

        {/* Footer */}
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
