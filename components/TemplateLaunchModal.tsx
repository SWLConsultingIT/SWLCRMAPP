"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X, Plus, Trash2, Loader2, Search, Users, Rocket, AlertCircle,
} from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";
const ACCENT = gold;

// One distinct color per seller slot (up to 6 sellers).
const SELLER_COLORS = [
  { bg: "#DBEAFE", text: "#1D4ED8" }, // blue
  { bg: "#EDE9FE", text: "#6D28D9" }, // purple
  { bg: "#FEF3C7", text: "#92400E" }, // amber
  { bg: "#DCFCE7", text: "#166534" }, // green
  { bg: "#FCE7F3", text: "#9D174D" }, // pink
  { bg: "#FFE4E6", text: "#9F1239" }, // rose
];

type Lead = {
  id: string;
  primary_first_name: string | null;
  primary_last_name: string | null;
  primary_title_role: string | null;
  company_name: string | null;
  status: string | null;
};

type Seller = { id: string; name: string; linkedin_daily_limit: number | null };

type SellerQuota = { sellerId: string; quota: number };

export default function TemplateLaunchModal({
  templateId, templateName, icpProfileId,
  onClose,
}: {
  templateId: string;
  templateName: string;
  icpProfileId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();

  // Data
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"new" | "all">("new");

  // Selection state
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [sellerQuotas, setSellerQuotas] = useState<SellerQuota[]>([]);

  // Launch state
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load leads scoped to the template's ICP, plus sellers.
  useEffect(() => {
    setLoading(true);
    const leadsParams = new URLSearchParams();
    if (icpProfileId) leadsParams.set("icp_profile_id", icpProfileId);
    if (statusFilter === "new") leadsParams.set("status", "new");
    Promise.all([
      fetch(`/api/leads/search?${leadsParams.toString()}&limit=1000`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : { leads: [] })
        .catch(() => ({ leads: [] })),
      fetch("/api/sellers?active=1", { cache: "no-store" })
        .then(r => r.ok ? r.json() : { sellers: [] })
        .catch(() => ({ sellers: [] })),
    ]).then(([lRes, sRes]) => {
      setLeads(lRes.leads ?? []);
      setSellers((sRes.sellers ?? []).map((s: any) => ({
        id: s.id, name: s.name, linkedin_daily_limit: s.linkedin_daily_limit ?? null,
      })));
    }).finally(() => setLoading(false));
  }, [icpProfileId, statusFilter]);

  // Default: one seller quota pre-filled so the user sees the shape.
  useEffect(() => {
    if (sellerQuotas.length === 0 && sellers.length > 0) {
      setSellerQuotas([{ sellerId: sellers[0].id, quota: 20 }]);
    }
  }, [sellers, sellerQuotas.length]);

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(l => {
      const n = `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.toLowerCase();
      const c = (l.company_name ?? "").toLowerCase();
      const t = (l.primary_title_role ?? "").toLowerCase();
      return n.includes(q) || c.includes(q) || t.includes(q);
    });
  }, [leads, search]);

  function toggleLead(id: string) {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllVisible() {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      for (const l of filteredLeads) next.add(l.id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedLeads(new Set());
  }
  function selectFirstN(n: number) {
    const next = new Set<string>();
    for (const l of filteredLeads.slice(0, n)) next.add(l.id);
    setSelectedLeads(next);
  }

  function addSellerQuota() {
    const used = new Set(sellerQuotas.map(q => q.sellerId));
    const next = sellers.find(s => !used.has(s.id));
    if (!next) return;
    setSellerQuotas(prev => [...prev, { sellerId: next.id, quota: 20 }]);
  }
  function updateSellerQuota(idx: number, patch: Partial<SellerQuota>) {
    setSellerQuotas(prev => prev.map((q, i) => i === idx ? { ...q, ...patch } : q));
  }
  function removeSellerQuota(idx: number) {
    setSellerQuotas(prev => prev.filter((_, i) => i !== idx));
  }

  const totalQuota = sellerQuotas.reduce((s, q) => s + (q.quota || 0), 0);
  const selectedCount = selectedLeads.size;

  // Distribute selected leads to sellers honoring per-seller quotas. Round-
  // robin within quotas keeps everyone topped up evenly. If selectedCount >
  // totalQuota, the extras get distributed by extending each seller's quota
  // in round-robin (i.e. the user's quotas become "soft floors").
  function computeAssignments(): { lead_id: string; seller_id: string }[] {
    if (sellerQuotas.length === 0 || selectedCount === 0) return [];
    const leadIds = Array.from(selectedLeads);
    const remaining = sellerQuotas.map(q => ({ sellerId: q.sellerId, left: q.quota }));
    const out: { lead_id: string; seller_id: string }[] = [];
    let i = 0;
    for (const lid of leadIds) {
      // Find next seller with remaining quota. If none, cycle by extending
      // every seller's quota uniformly (give the overflow to whoever's turn).
      let assigned = false;
      for (let tries = 0; tries < remaining.length; tries++) {
        const idx = (i + tries) % remaining.length;
        if (remaining[idx].left > 0) {
          out.push({ lead_id: lid, seller_id: remaining[idx].sellerId });
          remaining[idx].left -= 1;
          i = (idx + 1) % remaining.length;
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        // All quotas exhausted — fall back to round-robin extension.
        out.push({ lead_id: lid, seller_id: remaining[i].sellerId });
        i = (i + 1) % remaining.length;
      }
    }
    return out;
  }

  // Per-seller projected count + lead→seller preview map for inline badges.
  const { perSellerProjection, previewMap } = useMemo(() => {
    const assignments = computeAssignments();
    const projection = new Map<string, number>();
    const preview = new Map<string, string>(); // lead_id → seller_id
    for (const a of assignments) {
      projection.set(a.seller_id, (projection.get(a.seller_id) ?? 0) + 1);
      preview.set(a.lead_id, a.seller_id);
    }
    return { perSellerProjection: projection, previewMap: preview };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeads, sellerQuotas]);

  async function launch() {
    if (launching) return;
    if (selectedCount === 0) { setError("Pick at least one lead"); return; }
    if (sellerQuotas.length === 0) { setError("Add at least one seller"); return; }
    setLaunching(true);
    setError(null);
    try {
      const assignments = computeAssignments();
      const res = await fetch(`/api/templates/${templateId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      // Land on the campaigns page with a banner-friendly query param.
      router.push(`/campaigns?launched_template=${encodeURIComponent(templateId)}&n=${body.campaigns_created ?? assignments.length}`);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLaunching(false);
    }
  }

  // Close on Esc.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border w-full sm:w-[760px] max-h-[92vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.textDim }}>
              Launch campaign
            </p>
            <h2 className="text-base font-bold mt-0.5" style={{ color: C.textPrimary }}>{templateName}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded" style={{ color: C.textMuted }}>
            <X size={16} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Seller quotas section */}
          <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ color: C.textPrimary }}>
                  <Users size={13} /> Assign to sellers
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
                  Pick who sends + how many. Total quota: <span className="font-semibold tabular-nums" style={{ color: C.textBody }}>{totalQuota}</span>.
                </p>
              </div>
              {sellerQuotas.length < sellers.length && (
                <button onClick={addSellerQuota}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-md border inline-flex items-center gap-1"
                  style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
                  <Plus size={11} /> Add seller
                </button>
              )}
            </div>
            <div className="space-y-2">
              {sellerQuotas.length === 0 && (
                <p className="text-xs text-center py-3" style={{ color: C.textDim }}>
                  Click <b>Add seller</b> to start.
                </p>
              )}
              {sellerQuotas.map((q, idx) => {
                const projected = perSellerProjection.get(q.sellerId) ?? 0;
                const sellerObj = sellers.find(s => s.id === q.sellerId);
                const usedIds = new Set(sellerQuotas.filter((_, i) => i !== idx).map(x => x.sellerId));
                const clr = SELLER_COLORS[idx % SELLER_COLORS.length];
                return (
                  <div key={idx} className="flex items-center gap-2 rounded-lg border px-3 py-2"
                    style={{ borderColor: clr.text + "40", backgroundColor: clr.bg + "60" }}>
                    {/* Color swatch */}
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: clr.text }} />
                    <select value={q.sellerId}
                      onChange={e => updateSellerQuota(idx, { sellerId: e.target.value })}
                      className="text-xs rounded border px-2 py-1 outline-none flex-1"
                      style={{ borderColor: clr.text + "30", backgroundColor: "white", color: C.textBody }}>
                      {sellers.filter(s => s.id === q.sellerId || !usedIds.has(s.id)).map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <input type="number" min={0} value={q.quota}
                      onChange={e => updateSellerQuota(idx, { quota: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                      className="w-16 text-xs rounded border px-2 py-1 outline-none tabular-nums text-center"
                      style={{ borderColor: clr.text + "30", backgroundColor: "white", color: C.textBody }} />
                    <span className="text-[10px]" style={{ color: C.textMuted }}>leads max</span>
                    {sellerObj?.linkedin_daily_limit && (
                      <span className="text-[10px]" style={{ color: C.textDim }} title="Seller's LinkedIn daily cap">
                        · cap {sellerObj.linkedin_daily_limit}/d
                      </span>
                    )}
                    <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: projected > 0 ? clr.bg : C.surface, color: projected > 0 ? clr.text : C.textDim }}>
                      {projected} leads
                    </span>
                    {sellerQuotas.length > 1 && (
                      <button onClick={() => removeSellerQuota(idx)}
                        className="p-1 rounded" style={{ color: C.textMuted }}
                        onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
                        onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lead picker section */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Pick leads</h3>
                <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
                  Scoped to this template's ICP. {leads ? `${leads.length} available.` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setStatusFilter("new")}
                  className="text-[10px] font-semibold px-2 py-1 rounded-md border"
                  style={{
                    backgroundColor: statusFilter === "new" ? accentSoft(15) : C.bg,
                    borderColor: statusFilter === "new" ? accentSoft(40) : C.border,
                    color: statusFilter === "new" ? ACCENT : C.textBody,
                  }}>New only</button>
                <button onClick={() => setStatusFilter("all")}
                  className="text-[10px] font-semibold px-2 py-1 rounded-md border"
                  style={{
                    backgroundColor: statusFilter === "all" ? accentSoft(15) : C.bg,
                    borderColor: statusFilter === "all" ? accentSoft(40) : C.border,
                    color: statusFilter === "all" ? ACCENT : C.textBody,
                  }}>All</button>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 mb-2"
              style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <Search size={12} style={{ color: C.textDim }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, company, title…"
                className="bg-transparent text-sm outline-none flex-1"
                style={{ color: C.textPrimary }} />
              {search && <button onClick={() => setSearch("")}><X size={11} style={{ color: C.textDim }} /></button>}
            </div>

            {/* Bulk select shortcuts */}
            <div className="flex items-center gap-2 mb-2 text-[11px]">
              <button onClick={() => selectFirstN(totalQuota || 10)}
                className="font-semibold underline" style={{ color: ACCENT }}>
                Select first {totalQuota || 10}
              </button>
              <span style={{ color: C.textDim }}>·</span>
              <button onClick={selectAllVisible} className="font-semibold underline" style={{ color: ACCENT }}>
                Select all visible ({filteredLeads.length})
              </button>
              {selectedCount > 0 && (
                <>
                  <span style={{ color: C.textDim }}>·</span>
                  <button onClick={clearSelection} className="font-semibold underline" style={{ color: C.red }}>
                    Clear ({selectedCount})
                  </button>
                </>
              )}
            </div>

            {loading ? (
              <div className="py-10 text-center" style={{ color: C.textMuted }}>
                <Loader2 size={16} className="animate-spin mx-auto mb-2" />
                <p className="text-xs">Loading leads…</p>
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="py-10 text-center" style={{ color: C.textDim }}>
                <p className="text-sm">No leads match.</p>
                {statusFilter === "new" && (
                  <p className="text-[11px] mt-1">Try toggling to <b>All</b> if you want to include contacted leads too.</p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: C.border }}>
                <div className="max-h-[280px] overflow-y-auto">
                  {filteredLeads.map(l => {
                    const checked = selectedLeads.has(l.id);
                    const name = `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || "(unnamed)";
                    const assignedSellerId = checked ? previewMap.get(l.id) : undefined;
                    const sellerIdx = assignedSellerId
                      ? sellerQuotas.findIndex(q => q.sellerId === assignedSellerId)
                      : -1;
                    const sellerName = assignedSellerId
                      ? sellers.find(s => s.id === assignedSellerId)?.name ?? "?"
                      : null;
                    const clr = sellerIdx >= 0 ? SELLER_COLORS[sellerIdx % SELLER_COLORS.length] : null;
                    return (
                      <label key={l.id}
                        className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 cursor-pointer transition-colors hover:bg-black/[0.02]"
                        style={{ borderColor: C.border, backgroundColor: checked && clr ? clr.bg + "50" : "transparent" }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleLead(l.id)}
                          style={{ accentColor: ACCENT }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>
                            {name}
                            {l.primary_title_role && <span className="font-normal" style={{ color: C.textMuted }}> · {l.primary_title_role}</span>}
                          </p>
                          <p className="text-[10px] truncate" style={{ color: C.textDim }}>
                            {l.company_name ?? "—"}
                            {l.status && l.status !== "new" && <span> · status: {l.status}</span>}
                          </p>
                        </div>
                        {clr && sellerName && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1"
                            style={{ backgroundColor: clr.bg, color: clr.text, border: `1px solid ${clr.text}30` }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: clr.text }} />
                            {sellerName}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer — sticky launch bar */}
        <div className="px-5 py-3 border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          {error && (
            <div className="mb-2 rounded-lg border p-2 flex items-start gap-2"
              style={{ backgroundColor: C.redLight, borderColor: `${C.red}40` }}>
              <AlertCircle size={11} className="mt-0.5 shrink-0" style={{ color: C.red }} />
              <p className="text-xs flex-1" style={{ color: C.red }}>{error}</p>
              <button onClick={() => setError(null)}><X size={11} style={{ color: C.red }} /></button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tabular-nums" style={{ color: C.textPrimary }}>
                {selectedCount} {selectedCount === 1 ? "lead" : "leads"} selected
              </p>
              <p className="text-[10px]" style={{ color: C.textMuted }}>
                {sellerQuotas.length} {sellerQuotas.length === 1 ? "seller" : "sellers"} · {totalQuota} quota
                {selectedCount > totalQuota && totalQuota > 0 && (
                  <span style={{ color: "#D97706" }}> · overflow round-robins past quotas</span>
                )}
              </p>
            </div>
            <button onClick={launch}
              disabled={launching || selectedCount === 0 || sellerQuotas.length === 0}
              className="text-sm font-semibold px-5 py-2.5 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
              {launching ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
              {launching ? "Launching…" : `Launch ${selectedCount || ""}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function accentSoft(pct: number) {
  return `color-mix(in srgb, ${ACCENT} ${pct}%, transparent)`;
}
