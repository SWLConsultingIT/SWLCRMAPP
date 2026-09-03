"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Users, Wand2 } from "lucide-react";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";

type Member = { userId: string; name: string };

const gold = "var(--brand, #c9a83a)";

// Even split of `total` across `n` people: floor each, remainder onto the first
// few so the sum always equals total (300 / 3 = 100/100/100; 301 / 3 = 101/100/100).
function evenSplit(userIds: string[], total: number): Record<string, number> {
  const n = userIds.length;
  const out: Record<string, number> = {};
  if (n === 0) return out;
  const base = Math.floor(total / n);
  let rem = total - base * n;
  for (const uid of userIds) {
    out[uid] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return out;
}

export default function ReassignSellersModal({
  flowCampaignIds,
  tenantBioId,
  onClose,
  onDone,
}: {
  flowCampaignIds: string[];
  tenantBioId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const total = flowCampaignIds.length;

  const [roster, setRoster] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]); // ordered = split order
  const [quotas, setQuotas] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const url = tenantBioId ? `/api/team/roster?bioId=${encodeURIComponent(tenantBioId)}` : "/api/team/roster";
        const res = await fetch(url);
        const json = await res.json();
        if (alive) setRoster(Array.isArray(json.roster) ? json.roster : []);
      } catch {
        if (alive) setRoster([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [tenantBioId]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roster) m.set(r.userId, r.name);
    return m;
  }, [roster]);

  const toggle = (uid: string) => {
    setSelected(prev => {
      const next = prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid];
      setQuotas(evenSplit(next, total)); // re-balance evenly whenever the set changes
      return next;
    });
  };

  const rebalance = () => setQuotas(evenSplit(selected, total));

  const setQuota = (uid: string, v: string) => {
    const n = Math.max(0, Math.min(total, Math.floor(Number(v) || 0)));
    setQuotas(q => ({ ...q, [uid]: n }));
  };

  const assigned = selected.reduce((s, uid) => s + (quotas[uid] ?? 0), 0);
  const remainder = total - assigned;

  const apply = async () => {
    const assignments = selected
      .map(uid => ({ userId: uid, quota: quotas[uid] ?? 0 }))
      .filter(a => a.quota > 0);
    if (assignments.length === 0) {
      toast.show({ kind: "error", title: "Pick at least one person", description: "Give someone a share of the leads." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: flowCampaignIds, assignments }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.show({ kind: "error", title: "Couldn't reassign", description: json.error ?? res.statusText });
        setSaving(false);
        return;
      }
      toast.show({
        kind: "success",
        title: "Flow reassigned",
        description: `${json.count} lead${json.count === 1 ? "" : "s"} split across ${assignments.length} ${assignments.length === 1 ? "person" : "people"}.`,
      });
      onDone();
    } catch (e) {
      toast.show({ kind: "error", title: "Couldn't reassign", description: e instanceof Error ? e.message : "Try again." });
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(4,7,13,0.6)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: C.surface, border: `1px solid ${C.border}` }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `color-mix(in srgb, ${gold} 15%, transparent)` }}>
              <Users className="w-4 h-4" style={{ color: gold }} />
            </div>
            <div>
              <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Assign callers</h3>
              <p className="text-[11px]" style={{ color: C.textMuted }}>Split this flow&apos;s {total} lead{total === 1 ? "" : "s"} across your team — who calls whom.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-black/5" aria-label="Close">
            <X className="w-4 h-4" style={{ color: C.textMuted }} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[52vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: C.textMuted }} />
            </div>
          ) : roster.length === 0 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: C.textMuted }}>No teammates found for this tenant.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {roster.map(m => {
                const on = selected.includes(m.userId);
                return (
                  <div
                    key={m.userId}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl transition-colors"
                    style={{ background: on ? `color-mix(in srgb, ${gold} 8%, transparent)` : "transparent", border: `1px solid ${on ? `color-mix(in srgb, ${gold} 35%, transparent)` : C.border}` }}
                  >
                    <label className="flex items-center gap-2.5 flex-1 cursor-pointer">
                      <input type="checkbox" checked={on} onChange={() => toggle(m.userId)} style={{ accentColor: gold }} />
                      <span className="text-[13px] font-medium" style={{ color: C.textPrimary }}>{m.name}</span>
                    </label>
                    {on && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={total}
                          value={quotas[m.userId] ?? 0}
                          onChange={e => setQuota(m.userId, e.target.value)}
                          className="w-16 px-2 py-1 rounded-lg text-[13px] text-right tabular-nums"
                          style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textPrimary }}
                        />
                        <span className="text-[11px]" style={{ color: C.textMuted }}>leads</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4" style={{ borderTop: `1px solid ${C.border}` }}>
          {selected.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              <button onClick={rebalance} className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: gold }}>
                <Wand2 className="w-3.5 h-3.5" /> Split evenly
              </button>
              <span className="text-[12px] tabular-nums" style={{ color: remainder === 0 ? C.textMuted : "#D97706" }}>
                {assigned} / {total} assigned{remainder !== 0 ? ` · ${remainder > 0 ? `${remainder} to last` : `${-remainder} over`}` : ""}
              </span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors hover:bg-black/5" style={{ color: C.textMuted }}>
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={saving || selected.length === 0}
              className="px-4 py-2 rounded-lg text-[13px] font-bold flex items-center gap-2 transition-opacity disabled:opacity-50"
              style={{ background: gold, color: "#0C0E1B" }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
