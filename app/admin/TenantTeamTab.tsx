"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X, Trash2, Check } from "lucide-react";
import { C } from "@/lib/design";

// Client-side Team tab. Fetches team via /api/team, exposes invite +
// role-change + remove actions. Server-side endpoints enforce all the
// access rules (super_admin / owner only, last-owner guard, etc.); the UI
// just optimistic-updates and surfaces errors.

type Props = {
  companyBioId: string;
  canManage: boolean;
};

type TeamRow = {
  userId: string;
  email: string | null;
  displayName: string | null;
  tier: Tier;
  role: string;
  lastSeenAt: string | null;
  createdAt: string;
};

type Tier = "super_admin" | "owner" | "manager" | "seller" | "viewer";

const ASSIGNABLE_TIERS: Tier[] = ["owner", "manager", "seller", "viewer"];

const TIER_LABELS: Record<Tier, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "#9333EA" },
  owner: { label: "Owner", color: "#C9A83A" },
  manager: { label: "Manager", color: "#3B82F6" },
  seller: { label: "Seller", color: "#10B981" },
  viewer: { label: "Viewer", color: "#6B7280" },
};

function formatLastSeen(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function initials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  }
  if (email) return email[0]?.toUpperCase() ?? "?";
  return "?";
}

export default function TenantTeamTab({ companyBioId, canManage }: Props) {
  const [team, setTeam] = useState<TeamRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamRow | null>(null);

  async function loadTeam() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/team?bioId=${encodeURIComponent(companyBioId)}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Failed to load team");
        return;
      }
      setTeam(d.team ?? []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyBioId]);

  const ownerCount = useMemo(() => (team ?? []).filter(m => m.tier === "owner").length, [team]);

  async function changeTier(userId: string, newTier: Tier) {
    const prevTeam = team;
    // Optimistic.
    setTeam(prev => prev?.map(m => m.userId === userId ? { ...m, tier: newTier } : m) ?? prev);
    try {
      const res = await fetch(`/api/team/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: newTier }),
      });
      const d = await res.json();
      if (!res.ok) {
        setTeam(prevTeam);
        alert(d.error ?? "Failed to change tier");
      }
    } catch {
      setTeam(prevTeam);
      alert("Network error");
    }
  }

  async function removeMember(userId: string) {
    const prevTeam = team;
    setTeam(prev => prev?.filter(m => m.userId !== userId) ?? prev);
    setRemoveTarget(null);
    try {
      const res = await fetch(`/api/team/${userId}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTeam(prevTeam);
        alert(d.error ?? "Failed to remove");
      }
    } catch {
      setTeam(prevTeam);
      alert("Network error");
    }
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Team</p>
          <p className="text-sm" style={{ color: C.textPrimary }}>
            {team?.length ?? 0} {team?.length === 1 ? "member" : "members"}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: `linear-gradient(135deg, ${C.gold}, color-mix(in srgb, ${C.gold} 65%, white))`, color: "#1A1A2E" }}
          >
            <Plus size={12} /> Invite user
          </button>
        )}
      </div>

      {error && (
        <div className="px-5 py-3 text-xs" style={{ color: C.red }}>{error}</div>
      )}

      {loading ? (
        <div className="px-5 py-10 flex items-center justify-center gap-2" style={{ color: C.textMuted }}>
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">Loading team…</span>
        </div>
      ) : !team || team.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm" style={{ color: C.textMuted }}>
          No team members yet.
        </div>
      ) : (
        <ul>
          {team.map(m => {
            const t = TIER_LABELS[m.tier] ?? TIER_LABELS.viewer;
            const isLastOwner = m.tier === "owner" && ownerCount <= 1;
            return (
              <li key={m.userId} className="px-5 py-3 flex items-center gap-3 border-t" style={{ borderColor: C.border }}>
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: `linear-gradient(135deg, ${t.color}, color-mix(in srgb, ${t.color} 65%, white))`, color: "#fff" }}
                >
                  {initials(m.displayName, m.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>
                    {m.displayName ?? m.email ?? "(unknown)"}
                  </p>
                  {m.email && m.displayName && (
                    <p className="text-[11px] truncate" style={{ color: C.textMuted }}>{m.email}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {canManage && m.tier !== "super_admin" ? (
                    <select
                      value={m.tier}
                      onChange={(e) => changeTier(m.userId, e.target.value as Tier)}
                      disabled={isLastOwner}
                      title={isLastOwner ? "Cannot demote the last owner" : ""}
                      className="text-[11px] font-semibold uppercase tracking-wider px-2 py-1 rounded border outline-none"
                      style={{ borderColor: C.border, backgroundColor: C.bg, color: t.color }}
                    >
                      {ASSIGNABLE_TIERS.map(tt => (
                        <option key={tt} value={tt}>{TIER_LABELS[tt].label}</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                      style={{ backgroundColor: `${t.color}18`, color: t.color }}
                    >
                      {t.label}
                    </span>
                  )}
                  <span className="text-[11px] tabular-nums" style={{ color: C.textDim }}>
                    {formatLastSeen(m.lastSeenAt)}
                  </span>
                  {canManage && m.tier !== "super_admin" && !isLastOwner && (
                    <button
                      onClick={() => setRemoveTarget(m)}
                      className="p-1 rounded hover:bg-black/[0.04]"
                      title="Remove"
                    >
                      <Trash2 size={12} style={{ color: C.textMuted }} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {inviteOpen && (
        <InviteModal
          companyBioId={companyBioId}
          onClose={() => setInviteOpen(false)}
          onSuccess={() => { setInviteOpen(false); loadTeam(); }}
        />
      )}

      {removeTarget && (
        <RemoveModal
          target={removeTarget}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => removeMember(removeTarget.userId)}
        />
      )}
    </div>
  );
}

type SellerOption = { id: string; name: string; userId: string | null };

function InviteModal({
  companyBioId, onClose, onSuccess,
}: { companyBioId: string; onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<Tier>("seller");
  const [fullName, setFullName] = useState("");
  const [sellerId, setSellerId] = useState<string>("");
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load tenant sellers when role=seller is selected so the user can be
  // linked to a specific seller record. Only unassigned sellers are
  // selectable (otherwise they'd be linked to TWO users).
  useEffect(() => {
    if (tier !== "seller") return;
    if (sellers.length > 0) return;
    fetch(`/api/sellers?bioId=${encodeURIComponent(companyBioId)}`)
      .then(r => r.ok ? r.json() : { sellers: [] })
      .then(d => setSellers(d.sellers ?? []))
      .catch(() => setSellers([]));
  }, [tier, companyBioId, sellers.length]);

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
          companyBioId,
          // Only sent when role=seller AND a record was picked
          sellerId: tier === "seller" && sellerId ? sellerId : undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Invite failed");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Invite team member</h2>
          <button onClick={onClose}><X size={16} style={{ color: C.textMuted }} /></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
              style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Full name (optional)</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Juan Perez"
              className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
              style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Role</label>
            <div className="grid grid-cols-2 gap-2">
              {ASSIGNABLE_TIERS.map(t => {
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
              {tier === "owner" && "Full admin: can manage team + settings."}
              {tier === "manager" && "Tenant-wide read/write. No team management."}
              {tier === "seller" && "Only their own assigned leads + campaigns."}
              {tier === "viewer" && "Read-only across the tenant."}
            </p>
          </div>

          {/* Seller record picker — only visible when role=seller. Without
              this link the new user has no leads to see (server filters
              `seller_id IN (sellers where user_id = me)` → empty set). */}
          {tier === "seller" && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>
                Link to seller record
              </label>
              <select
                value={sellerId}
                onChange={(e) => setSellerId(e.target.value)}
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
              <p className="text-[10px] mt-1.5" style={{ color: C.textDim }}>
                Sellers already linked to another user are disabled. Leave empty to assign later from this user&apos;s row.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: `${C.red}30`, backgroundColor: `${C.red}10`, color: C.red }}>
              {error}
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: C.border }}>
          <button onClick={onClose} className="text-xs font-medium px-3 py-2 rounded-lg border" style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !email.trim()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: C.gold, color: "#04070d" }}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Send invite
          </button>
        </div>
      </div>
    </div>
  );
}

function RemoveModal({
  target, onCancel, onConfirm,
}: { target: TeamRow; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border"
        style={{ backgroundColor: C.card, borderColor: C.border }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4">
          <h2 className="text-sm font-bold mb-2" style={{ color: C.textPrimary }}>Remove team member?</h2>
          <p className="text-xs" style={{ color: C.textMuted }}>
            <b style={{ color: C.textBody }}>{target.displayName ?? target.email ?? "This user"}</b> will lose access immediately. Their leads and campaigns remain in the tenant.
          </p>
        </div>
        <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: C.border }}>
          <button onClick={onCancel} className="text-xs font-medium px-3 py-2 rounded-lg border" style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-xs font-semibold px-4 py-2 rounded-lg"
            style={{ backgroundColor: C.red, color: "#fff" }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
