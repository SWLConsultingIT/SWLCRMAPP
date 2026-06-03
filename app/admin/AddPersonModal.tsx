"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Check, Building2 } from "lucide-react";
import { C } from "@/lib/design";

// Reusable "add a person to one or more companies" modal. Talks to
// /api/team/invite with companyBioIds[]. Works for brand-new users (sends a
// Supabase invite email) and existing ones (just attaches memberships).
//
// A single role applies to every selected company. Per-company roles are a
// deliberate non-goal for now — covers the common case without a matrix UI.

type Tier = "super_admin" | "owner" | "manager" | "seller" | "viewer";
type Company = { id: string; company_name: string };
type SellerOption = { id: string; name: string; userId: string | null };

const ASSIGNABLE_TIERS: Tier[] = ["owner", "manager", "seller", "viewer"];
const SUPER_ADMIN_ASSIGNABLE_TIERS: Tier[] = ["super_admin", "owner", "manager", "seller", "viewer"];

const TIER_LABELS: Record<Tier, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "#9333EA" },
  owner: { label: "Owner", color: "#C9A83A" },
  manager: { label: "Manager", color: "#3B82F6" },
  seller: { label: "Seller", color: "#10B981" },
  viewer: { label: "Viewer", color: "#6B7280" },
};

export type AddPersonResult = {
  mode: "invited" | "added" | "already_member";
  email: string;
  count: number;
};

export default function AddPersonModal({
  companies,
  onClose,
  onSuccess,
  presetEmail,
  lockedCompanyId,
}: {
  companies: Company[];
  onClose: () => void;
  onSuccess: (result: AddPersonResult) => void;
  // Pre-fill the email (e.g. assigning a pending signup) — field is locked.
  presetEmail?: string;
  // Force a single company (e.g. opened from a client's Users tab).
  lockedCompanyId?: string;
}) {
  const [email, setEmail] = useState(presetEmail ?? "");
  const [fullName, setFullName] = useState("");
  const [tier, setTier] = useState<Tier>("owner");
  const [selectedIds, setSelectedIds] = useState<string[]>(lockedCompanyId ? [lockedCompanyId] : []);
  const [sellerId, setSellerId] = useState<string>("");
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [companyQuery, setCompanyQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callerTier, setCallerTier] = useState<Tier | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active) setCallerTier((d?.tier as Tier | undefined) ?? null); })
      .catch(() => { /* defaults to non-super tier list */ });
    return () => { active = false; };
  }, []);

  const assignableTiers = callerTier === "super_admin" ? SUPER_ADMIN_ASSIGNABLE_TIERS : ASSIGNABLE_TIERS;
  const singleCompany = selectedIds.length === 1;

  // Seller record picker — only when exactly one company is selected + role=seller.
  useEffect(() => {
    if (tier !== "seller" || !singleCompany) { setSellers([]); setSellerId(""); return; }
    fetch(`/api/sellers?bioId=${encodeURIComponent(selectedIds[0])}`)
      .then(r => (r.ok ? r.json() : { sellers: [] }))
      .then(d => setSellers(d.sellers ?? []))
      .catch(() => setSellers([]));
  }, [tier, singleCompany, selectedIds]);

  function toggleCompany(id: string) {
    if (lockedCompanyId) return;
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }

  const filteredCompanies = companyQuery.trim()
    ? companies.filter(c => c.company_name.toLowerCase().includes(companyQuery.trim().toLowerCase()))
    : companies;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          tier,
          fullName: fullName.trim() || undefined,
          companyBioIds: selectedIds,
          sellerId: tier === "seller" && singleCompany && sellerId ? sellerId : undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Failed"); return; }
      onSuccess({
        mode: (d.mode as AddPersonResult["mode"] | undefined) ?? "added",
        email: email.trim(),
        count: selectedIds.length,
      });
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = !!email.trim() && selectedIds.length > 0 && !saving;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border max-h-[90vh] flex flex-col"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0" style={{ borderColor: C.border }}>
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Add person to companies</h2>
          <button onClick={onClose}><X size={16} style={{ color: C.textMuted }} /></button>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              autoFocus={!presetEmail}
              disabled={!!presetEmail}
              className="w-full px-3 py-2 text-sm rounded-lg border outline-none disabled:opacity-70"
              style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Full name (optional)</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Juan Perez"
              className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
              style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
            />
          </div>

          {/* Multi-select companies */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>
              Companies {selectedIds.length > 0 && <span style={{ color: C.gold }}>· {selectedIds.length} selected</span>}
            </label>
            {!lockedCompanyId && companies.length > 6 && (
              <input
                type="text"
                value={companyQuery}
                onChange={e => setCompanyQuery(e.target.value)}
                placeholder="Search companies…"
                className="w-full px-3 py-2 mb-2 text-xs rounded-lg border outline-none"
                style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
              />
            )}
            <div className="rounded-lg border max-h-44 overflow-y-auto" style={{ borderColor: C.border }}>
              {filteredCompanies.length === 0 ? (
                <p className="px-3 py-3 text-xs" style={{ color: C.textDim }}>No companies.</p>
              ) : filteredCompanies.map(c => {
                const checked = selectedIds.includes(c.id);
                const locked = !!lockedCompanyId;
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCompany(c.id)}
                    disabled={locked}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm border-b last:border-b-0 disabled:cursor-not-allowed"
                    style={{ borderColor: C.border, color: C.textBody, backgroundColor: checked ? `${C.gold}10` : "transparent" }}
                  >
                    <span
                      className="w-4 h-4 rounded flex items-center justify-center shrink-0 border"
                      style={{ borderColor: checked ? C.gold : C.border, backgroundColor: checked ? C.gold : "transparent" }}
                    >
                      {checked && <Check size={11} style={{ color: "#04070d" }} />}
                    </span>
                    <Building2 size={13} style={{ color: C.textDim }} />
                    <span className="truncate">{c.company_name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Role — applies to all selected companies */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>
              Role {selectedIds.length > 1 && <span style={{ color: C.textDim }}>(applies to all selected)</span>}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {assignableTiers.map(t => {
                const meta = TIER_LABELS[t];
                const selected = tier === t;
                return (
                  <button
                    key={t}
                    onClick={() => setTier(t)}
                    className="text-xs font-semibold px-3 py-2 rounded-lg border text-left flex items-center justify-between"
                    style={{
                      borderColor: selected ? meta.color : C.border,
                      backgroundColor: selected ? `${meta.color}10` : C.bg,
                      color: selected ? meta.color : C.textBody,
                    }}
                  >
                    <span>{meta.label}</span>
                    {selected && <Check size={12} />}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: C.textDim }}>
              {tier === "super_admin" && "Cross-tenant SWL ops. Lands as owner + can switch into any tenant. Use sparingly."}
              {tier === "owner" && "Full admin: can manage team + settings in each company."}
              {tier === "manager" && "Tenant-wide read/write. No team management."}
              {tier === "seller" && "Only their own assigned leads + campaigns."}
              {tier === "viewer" && "Read-only across the tenant."}
            </p>
          </div>

          {/* Seller link — only single company + role=seller */}
          {tier === "seller" && singleCompany && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>
                Link to seller record
              </label>
              <select
                value={sellerId}
                onChange={e => setSellerId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
                style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
              >
                <option value="">— pick a seller —</option>
                {sellers.map(s => (
                  <option key={s.id} value={s.id} disabled={!!s.userId}>
                    {s.name}{s.userId ? " (already linked)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {tier === "seller" && !singleCompany && (
            <p className="text-[10px]" style={{ color: C.textDim }}>
              Seller record linking is only available when one company is selected.
            </p>
          )}

          {error && (
            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: `${C.red}30`, backgroundColor: `${C.red}10`, color: C.red }}>
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t flex items-center justify-end gap-2 shrink-0" style={{ borderColor: C.border }}>
          <button onClick={onClose} className="text-xs font-medium px-3 py-2 rounded-lg border" style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: C.gold, color: "#04070d" }}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {selectedIds.length > 1 ? `Add to ${selectedIds.length} companies` : "Add person"}
          </button>
        </div>
      </div>
    </div>
  );
}
