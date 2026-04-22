"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Share2, Mail, Phone, AlertTriangle,
  Users, Calendar, X, Plus, Trash2, Loader2, Shield, Pencil, Save,
  Zap, Globe, TrendingUp,
} from "lucide-react";

const gold = "#C9A83A";

type SellerCard = {
  id: string;
  name: string;
  hasLinkedin: boolean;
  unipileId: string | null;
  linkedin: { sent: number; limit: number; pct: number };
  calls: number;
};

type HistoryEntry = {
  date: string;
  sellerId: string;
  sellerName: string;
  channel: string;
  count: number;
};

type InstantlyPool = {
  accounts: { email: string; dailyLimit: number; warmupStatus: number; setupPending: boolean; warmupScore: number }[];
  total: number;
  ready: number;
  warmupPending: number;
  totalDailyLimit: number;
} | null;

type AircallData = {
  numbers: { id: number; name: string; digits: string; country: string; availability: string; is_active: boolean; minutes: number; calls: number }[];
  totalMinutes: number;
  totalCalls: number;
} | null;

type Props = {
  sellers: SellerCard[];
  history: HistoryEntry[];
  instantly: InstantlyPool;
  aircall: AircallData;
  totals: { linkedinSent: number; linkedinLimit: number; emailSent: number };
};

function usageColor(pct: number): string {
  if (pct >= 100) return C.red;
  if (pct >= 80) return "#D97706";
  if (pct >= 50) return gold;
  return C.green;
}

function usageStatus(pct: number): { label: string; color: string; bg: string } {
  if (pct >= 100) return { label: "Limited", color: C.red, bg: C.redLight };
  if (pct >= 80) return { label: "Almost Full", color: "#D97706", bg: "#FFFBEB" };
  return { label: "Available", color: C.green, bg: C.greenLight };
}

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

function UsageBar({ sent, limit, channel }: { sent: number; limit: number; channel: string }) {
  const pct = limit > 0 ? Math.min(Math.round((sent / limit) * 100), 100) : 0;
  const color = usageColor(pct);
  const meta = channelMeta[channel];
  const Icon = meta?.icon ?? Mail;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon size={12} style={{ color: meta?.color ?? C.textMuted }} />
          <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{meta?.label ?? channel}</span>
        </div>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>{sent} / {limit}</span>
      </div>
      <div className="h-2 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-[9px] font-semibold mt-1 text-right tabular-nums" style={{ color }}>{pct}%</p>
    </div>
  );
}

const SECURITY_PIN = "2026";

// ─── Add Seller Modal (PIN-gated) ───────────────────────────────────────────
function AddAccountModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<"pin" | "form" | "connecting" | "connected">("pin");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [pinError, setPinError] = useState(false);
  const [name, setName] = useState("");
  const [linkedinLimit, setLinkedinLimit] = useState(15);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [authWindow, setAuthWindow] = useState<Window | null>(null);

  function handlePinChange(idx: number, val: string) {
    if (val.length > 1) return;
    const next = [...pin]; next[idx] = val; setPin(next); setPinError(false);
    if (val && idx < 3) document.getElementById(`pin-${idx + 1}`)?.focus();
    if (idx === 3 && val) {
      const full = next.join("");
      if (full === SECURITY_PIN) setStep("form");
      else { setPinError(true); setTimeout(() => setPin(["", "", "", ""]), 500); document.getElementById("pin-0")?.focus(); }
    }
  }

  async function handleStartConnection() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError(null);
    const res = await fetch("/api/unipile/hosted-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), linkedin_daily_limit: linkedinLimit }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to start LinkedIn connection");
      return;
    }
    const { sellerId: sid, authUrl } = await res.json();
    setSellerId(sid);
    setStep("connecting");
    const w = window.open(authUrl, "unipile-auth", "width=720,height=800");
    setAuthWindow(w);
  }

  // Poll connection status while the popup is open
  useEffect(() => {
    if (step !== "connecting" || !sellerId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/sellers/${sellerId}/connection-status`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (data.connected) {
        clearInterval(interval);
        try { authWindow?.close(); } catch { /* ignore */ }
        setStep("connected");
        setTimeout(onSuccess, 1200);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [step, sellerId, authWindow, onSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-2xl border p-6 w-full max-w-lg shadow-2xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>
            {step === "pin" ? "Security Verification"
              : step === "connecting" ? "Connecting LinkedIn"
              : step === "connected" ? "Connected"
              : "Add Seller"}
          </h2>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>

        {step === "pin" && (
          <div className="py-8 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${gold}15` }}>
              <Shield size={24} style={{ color: gold }} />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: C.textPrimary }}>Enter security PIN</p>
            <p className="text-xs mb-6" style={{ color: C.textMuted }}>4-digit PIN required to manage accounts</p>
            <div className="flex items-center justify-center gap-3 mb-4">
              {pin.map((d, i) => (
                <input key={i} id={`pin-${i}`} type="password" inputMode="numeric" maxLength={1}
                  value={d} onChange={e => handlePinChange(i, e.target.value.replace(/\D/g, ""))}
                  className="w-12 h-14 text-center text-2xl font-bold rounded-xl focus:outline-none transition-all"
                  style={{ backgroundColor: C.bg, border: `2px solid ${pinError ? C.red : d ? gold : C.border}`, color: C.textPrimary }}
                  autoFocus={i === 0} />
              ))}
            </div>
            {pinError && <p className="text-xs font-medium" style={{ color: C.red }}>Incorrect PIN. Try again.</p>}
          </div>
        )}

        {step === "form" && (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: C.textMuted }}>Seller Name *</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Juan Perez"
                  className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none" style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }} />
              </div>
              <div className="rounded-xl border p-4" style={{ borderColor: "#0A66C220", backgroundColor: "#0A66C204" }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Share2 size={14} style={{ color: "#0A66C2" }} />
                    <span className="text-xs font-semibold" style={{ color: "#0A66C2" }}>LinkedIn Connection</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>Daily limit:</label>
                    <input type="number" value={linkedinLimit} onChange={e => setLinkedinLimit(Number(e.target.value))}
                      className="w-14 rounded px-2 py-1 text-xs text-center focus:outline-none" style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }} />
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: C.textMuted }}>
                  Your LinkedIn credentials go directly to Unipile (our secure connection partner). SWL never sees your password.
                </p>
              </div>
              <p className="text-[10px]" style={{ color: C.textDim }}>
                <b>Note:</b> Email sending uses a shared Instantly pool, not per-seller accounts. Calls use Aircall numbers.
              </p>
            </div>

            {error && <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: C.redLight }}><p className="text-xs font-medium" style={{ color: C.red }}>{error}</p></div>}

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t" style={{ borderColor: C.border }}>
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>Cancel</button>
              <button onClick={handleStartConnection} disabled={saving || !name.trim()}
                className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#0A66C2", color: "#fff" }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
                {saving ? "Preparing..." : "Connect LinkedIn"}
              </button>
            </div>
          </>
        )}

        {step === "connecting" && (
          <div className="py-10 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "#0A66C215" }}>
              <Loader2 size={24} className="animate-spin" style={{ color: "#0A66C2" }} />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: C.textPrimary }}>Waiting for LinkedIn authentication…</p>
            <p className="text-xs" style={{ color: C.textMuted }}>Complete the login in the Unipile window. This modal will update automatically.</p>
            <p className="text-[10px] mt-6" style={{ color: C.textDim }}>
              If you closed the window, <button onClick={() => setStep("form")} className="underline" style={{ color: "#0A66C2" }}>try again</button>.
            </p>
          </div>
        )}

        {step === "connected" && (
          <div className="py-10 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "#DCFCE7" }}>
              <Shield size={24} style={{ color: "#16A34A" }} />
            </div>
            <p className="text-sm font-bold mb-1" style={{ color: "#16A34A" }}>LinkedIn connected ✓</p>
            <p className="text-xs" style={{ color: C.textMuted }}>{name} is ready to start campaigns.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit Seller Modal ──────────────────────────────────────────────────────
function EditAccountModal({ seller, onClose, onSuccess }: { seller: SellerCard; onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState(seller.name);
  const [unipileId, setUnipileId] = useState(seller.unipileId ?? "");
  const [linkedinLimit, setLinkedinLimit] = useState(seller.linkedin.limit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError(null);
    const res = await fetch(`/api/sellers/${seller.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        unipile_account_id: unipileId.trim() || null,
        linkedin_daily_limit: linkedinLimit,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to update seller");
      setSaving(false); return;
    }
    setSaving(false); onSuccess();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-2xl border p-6 w-full max-w-lg shadow-2xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>Edit Seller</h2>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: C.textMuted }}>Seller Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none" style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }} />
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: "#0A66C220", backgroundColor: "#0A66C204" }}>
            <div className="flex items-center gap-2 mb-3">
              <Share2 size={14} style={{ color: "#0A66C2" }} />
              <span className="text-xs font-semibold" style={{ color: "#0A66C2" }}>LinkedIn (Unipile)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textDim }}>Unipile Account ID</label>
                <input type="text" value={unipileId} onChange={e => setUnipileId(e.target.value)} placeholder="Empty if not configured"
                  className="w-full rounded-lg px-3 py-2 text-xs font-mono focus:outline-none" style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }} />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textDim }}>Daily Limit</label>
                <input type="number" value={linkedinLimit} onChange={e => setLinkedinLimit(Number(e.target.value))}
                  className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none" style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }} />
              </div>
            </div>
          </div>
        </div>

        {error && <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: C.redLight }}><p className="text-xs font-medium" style={{ color: C.red }}>{error}</p></div>}

        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t" style={{ borderColor: C.border }}>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: C.blue, color: "#fff" }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Link Existing Unipile Account Modal ────────────────────────────────────
function LinkUnipileModal({ seller, onClose, onSuccess }: { seller: SellerCard; onClose: () => void; onSuccess: () => void }) {
  type UnlinkedAccount = { id: string; name: string; created_at: string; status: string };
  const [accounts, setAccounts] = useState<UnlinkedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/unipile/unlinked-accounts", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { setAccounts(d.accounts ?? []); setLoading(false); })
      .catch(() => { setError("Couldn't load Unipile accounts"); setLoading(false); });
  }, []);

  async function handleLink() {
    if (!selectedId) return;
    setSaving(true); setError(null);
    const res = await fetch(`/api/sellers/${seller.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unipile_account_id: selectedId }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to link");
      return;
    }
    onSuccess();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-2xl border p-6 w-full max-w-lg shadow-2xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>Link LinkedIn to {seller.name}</h2>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>

        <p className="text-xs mb-4 leading-relaxed" style={{ color: C.textMuted }}>
          Pick a Unipile account that&apos;s already connected but not linked to any seller yet.
        </p>

        {loading ? (
          <div className="py-10 text-center">
            <Loader2 size={20} className="animate-spin mx-auto mb-2" style={{ color: "#0A66C2" }} />
            <p className="text-xs" style={{ color: C.textMuted }}>Loading accounts…</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="py-10 text-center rounded-xl border border-dashed" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <Share2 size={20} className="mx-auto mb-2" style={{ color: C.textDim }} />
            <p className="text-xs font-medium" style={{ color: C.textBody }}>No unlinked LinkedIn accounts in Unipile</p>
            <p className="text-[10px] mt-1" style={{ color: C.textMuted }}>
              Connect a LinkedIn account first via &quot;Add Seller → Connect LinkedIn&quot;.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {accounts.map(a => {
              const isSel = selectedId === a.id;
              return (
                <button key={a.id} onClick={() => setSelectedId(a.id)}
                  className="w-full text-left rounded-lg p-3 border transition-all flex items-center gap-3"
                  style={{
                    backgroundColor: isSel ? "#0A66C20D" : C.bg,
                    borderColor: isSel ? "#0A66C2" : C.border,
                    borderWidth: isSel ? "2px" : "1px",
                  }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "#0A66C215" }}>
                    <Share2 size={14} style={{ color: "#0A66C2" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{a.name}</p>
                    <p className="text-[10px] font-mono" style={{ color: C.textDim }}>{a.id}</p>
                  </div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded"
                    style={{ backgroundColor: a.status === "OK" ? "#DCFCE7" : "#FEF3C7", color: a.status === "OK" ? "#16A34A" : "#D97706" }}>
                    {a.status}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {error && <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: C.redLight }}><p className="text-xs font-medium" style={{ color: C.red }}>{error}</p></div>}

        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t" style={{ borderColor: C.border }}>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>Cancel</button>
          <button onClick={handleLink} disabled={!selectedId || saving}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: "#0A66C2", color: "#fff" }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
            {saving ? "Linking…" : "Link Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Modal ───────────────────────────────────────────────
function DeleteModal({ name, onConfirm, onClose, loading }: { name: string; onConfirm: () => void; onClose: () => void; loading: boolean }) {
  const [typedName, setTypedName] = useState("");
  const matches = typedName.trim().toLowerCase() === name.toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-2xl border p-6 w-full max-w-md shadow-2xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold" style={{ color: C.red }}>Remove Seller</h2>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>
        <div className="rounded-xl border p-4 mb-4" style={{ borderColor: `${C.red}30`, backgroundColor: `${C.red}04` }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} style={{ color: C.red }} />
            <span className="text-sm font-semibold" style={{ color: C.red }}>This action cannot be undone</span>
          </div>
          <p className="text-xs" style={{ color: C.textBody }}>Deactivates <strong>{name}</strong>. Active campaigns continue but no new flows will be assigned.</p>
        </div>
        <div>
          <label className="text-xs font-semibold block mb-2" style={{ color: C.textMuted }}>Type <strong style={{ color: C.textPrimary }}>{name}</strong> to confirm:</label>
          <input type="text" value={typedName} onChange={e => setTypedName(e.target.value)} placeholder={name}
            className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none"
            style={{ color: C.textPrimary, backgroundColor: C.bg, border: `2px solid ${matches ? C.red : C.border}` }} autoFocus />
        </div>
        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t" style={{ borderColor: C.border }}>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>Cancel</button>
          <button onClick={onConfirm} disabled={!matches || loading}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-30 transition-opacity"
            style={{ backgroundColor: C.red, color: "#fff" }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {loading ? "Removing..." : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
export default function AccountsClient({ sellers, history, instantly, aircall, totals }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<SellerCard | null>(null);
  const [linkTarget, setLinkTarget] = useState<SellerCard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [historyDate, setHistoryDate] = useState("");
  const [historyChannel, setHistoryChannel] = useState("all");
  const [historySeller, setHistorySeller] = useState("all");

  const liPct = totals.linkedinLimit > 0 ? Math.round((totals.linkedinSent / totals.linkedinLimit) * 100) : 0;
  const instantlyPoolLimit = instantly?.totalDailyLimit ?? 0;
  const instantlyUsed = totals.emailSent;
  const instantlyPct = instantlyPoolLimit > 0 ? Math.round((instantlyUsed / instantlyPoolLimit) * 100) : 0;

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    await fetch(`/api/sellers/${deleteTarget.id}`, { method: "DELETE" });
    setDeleting(false);
    setDeleteTarget(null);
    router.refresh();
  }

  const historyByDate: Record<string, HistoryEntry[]> = {};
  for (const h of history) {
    if (!historyByDate[h.date]) historyByDate[h.date] = [];
    historyByDate[h.date].push(h);
  }
  const dates = Object.keys(historyByDate).sort((a, b) => b.localeCompare(a));
  const filteredDates = dates.filter(d => {
    if (historyDate && d !== historyDate) return false;
    const entries = historyByDate[d];
    return entries.some(h => {
      if (historyChannel !== "all" && h.channel !== historyChannel) return false;
      if (historySeller !== "all" && h.sellerId !== historySeller) return false;
      return true;
    });
  });

  const tabs = [
    { label: "Today's Usage", count: `${sellers.length}`, color: gold },
    { label: "History", count: `${dates.length}d`, color: C.blue },
  ];

  return (
    <div>
      {/* ═══ KPI CARDS ═══ */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border p-4 card-lift" style={{ background: `linear-gradient(135deg, var(--c-card) 0%, ${gold}09 100%)`, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Team Members</span>
            <Users size={14} style={{ color: gold }} />
          </div>
          <p className="text-2xl font-bold" style={{ color: C.textBody }}>{sellers.length}</p>
        </div>

        <div className="rounded-xl border p-4 card-lift" style={{ background: "linear-gradient(135deg, var(--c-card) 0%, #0A66C209 100%)", borderColor: C.border, borderTop: "2px solid #0A66C2" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>LinkedIn Today</span>
            <Share2 size={14} style={{ color: "#0A66C2" }} />
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: usageColor(liPct) }}>
            {totals.linkedinSent} <span className="text-sm font-medium" style={{ color: C.textMuted }}>/ {totals.linkedinLimit}</span>
          </p>
        </div>

        <div className="rounded-xl border p-4 card-lift" style={{ background: "linear-gradient(135deg, var(--c-card) 0%, #7C3AED09 100%)", borderColor: C.border, borderTop: `2px solid ${usageColor(instantlyPct)}` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Instantly Pool</span>
            <Mail size={14} style={{ color: usageColor(instantlyPct) }} />
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: usageColor(instantlyPct) }}>
            {instantlyUsed} <span className="text-sm font-medium" style={{ color: C.textMuted }}>/ {instantlyPoolLimit}</span>
          </p>
          <p className="text-[9px] mt-0.5" style={{ color: C.textDim }}>
            {instantly?.total ?? 0} accounts · {instantly?.warmupPending ?? 0} warming up
          </p>
        </div>

        <div className="rounded-xl border p-4 card-lift" style={{ background: "linear-gradient(135deg, var(--c-card) 0%, #F9731609 100%)", borderColor: C.border, borderTop: "2px solid #F97316" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Aircall This Month</span>
            <Phone size={14} style={{ color: "#F97316" }} />
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: "#F97316" }}>
            {aircall?.totalMinutes ?? 0}<span className="text-sm font-medium" style={{ color: C.textMuted }}> min</span>
          </p>
          <p className="text-[9px] mt-0.5" style={{ color: C.textDim }}>
            {aircall?.totalCalls ?? 0} calls · {aircall?.numbers.length ?? 0} number{(aircall?.numbers.length ?? 0) !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Tabs + Add button */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const isActive = tab === i;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              {t.label}
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: isActive ? `${t.color}15` : "#F3F4F6", color: isActive ? t.color : C.textDim }}>
                {t.count}
              </span>
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
        <div className="flex-1" />
        <button onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold mb-1 transition-all hover:shadow-md"
          style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#1A1A2E" }}>
          <Plus size={14} /> Add Seller
        </button>
      </div>

      {/* ═══ TAB 0: TODAY'S USAGE — 3 sections ═══ */}
      {tab === 0 && (
        <div className="space-y-8">

          {/* ─── LinkedIn per seller ─── */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Share2 size={16} style={{ color: "#0A66C2" }} />
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>LinkedIn Accounts</h2>
              <span className="text-[10px]" style={{ color: C.textMuted }}>Per-seller Unipile accounts</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sellers.map(seller => {
                const status = usageStatus(seller.linkedin.pct);
                return (
                  <div key={seller.id} className="rounded-xl border overflow-hidden card-lift" style={{ backgroundColor: C.card, borderColor: C.border }}>
                    <div className="px-5 py-4 flex items-center gap-3 border-b" style={{ borderColor: C.border }}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>{seller.name[0]}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{seller.name}</p>
                        {seller.hasLinkedin
                          ? <p className="text-[10px] font-mono mt-0.5" style={{ color: C.textDim }}>{seller.unipileId?.slice(0, 14)}…</p>
                          : <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>No Unipile configured</p>}
                      </div>
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: status.bg, color: status.color }}>
                        {status.label}
                      </span>
                    </div>
                    <div className="px-5 py-4 space-y-4">
                      {seller.hasLinkedin
                        ? <UsageBar sent={seller.linkedin.sent} limit={seller.linkedin.limit} channel="linkedin" />
                        : <p className="text-xs text-center py-2" style={{ color: C.textDim }}>No channel configured</p>}
                      {seller.calls > 0 && (
                        <div className="flex items-center gap-2 text-xs" style={{ color: C.textMuted }}>
                          <Phone size={11} style={{ color: "#F97316" }} /> {seller.calls} calls today
                        </div>
                      )}
                    </div>
                    <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      {!seller.hasLinkedin && (
                        <button onClick={() => setLinkTarget(seller)}
                          className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-md transition-opacity hover:opacity-80 mr-auto"
                          style={{ backgroundColor: "#0A66C215", color: "#0A66C2", border: "1px solid #0A66C230" }}><Share2 size={10} /> Link LinkedIn</button>
                      )}
                      <Link href={`/accounts/linkedin/${seller.id}`}
                        className="flex items-center gap-1.5 text-[10px] font-medium px-3 py-1.5 rounded-md transition-opacity hover:opacity-80"
                        style={{ backgroundColor: `${gold}15`, color: gold, border: `1px solid ${gold}30` }}><TrendingUp size={10} /> Details</Link>
                      <button onClick={() => setEditTarget(seller)}
                        className="flex items-center gap-1.5 text-[10px] font-medium px-3 py-1.5 rounded-md transition-opacity hover:opacity-80"
                        style={{ backgroundColor: C.blueLight, color: C.blue }}><Pencil size={10} /> Edit</button>
                      <button onClick={() => setDeleteTarget({ id: seller.id, name: seller.name })}
                        className="flex items-center gap-1.5 text-[10px] font-medium px-3 py-1.5 rounded-md transition-opacity hover:opacity-80"
                        style={{ backgroundColor: C.redLight, color: C.red }}><Trash2 size={10} /> Remove</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ─── Instantly Pool ─── */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Mail size={16} style={{ color: "#7C3AED" }} />
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Instantly Email Pool</h2>
              <span className="text-[10px]" style={{ color: C.textMuted }}>Shared pool across all campaigns</span>
            </div>
            {instantlyPct >= 80 && instantlyPoolLimit > 0 && (
              <div className="rounded-xl border px-4 py-3 mb-4 flex items-center gap-3"
                style={{ backgroundColor: instantlyPct >= 100 ? C.redLight : "#FFFBEB", borderColor: instantlyPct >= 100 ? `${C.red}40` : "#FCD34D" }}>
                <AlertTriangle size={15} style={{ color: instantlyPct >= 100 ? C.red : "#D97706", flexShrink: 0 }} />
                <div>
                  <p className="text-xs font-bold" style={{ color: instantlyPct >= 100 ? C.red : "#92400E" }}>
                    {instantlyPct >= 100 ? "Pool at capacity — no more emails today" : `Pool at ${instantlyPct}% — approaching daily limit`}
                  </p>
                  <p className="text-[10px]" style={{ color: instantlyPct >= 100 ? C.red : "#B45309" }}>
                    {instantlyUsed} / {instantlyPoolLimit} emails sent today
                    {instantlyPct < 100 && ` · ${instantlyPoolLimit - instantlyUsed} remaining`}
                  </p>
                </div>
              </div>
            )}
            {!instantly ? (
              <div className="rounded-xl border p-8 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
                <p className="text-sm" style={{ color: C.textDim }}>Instantly API unavailable</p>
              </div>
            ) : (
              <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${usageColor(instantlyPct)}` }}>
                <div className="px-5 py-4 flex items-center gap-6 border-b" style={{ borderColor: C.border }}>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Sent Today</p>
                    <p className="text-2xl font-bold tabular-nums" style={{ color: usageColor(instantlyPct) }}>
                      {instantlyUsed} <span className="text-sm" style={{ color: C.textMuted }}>/ {instantly.totalDailyLimit}</span>
                    </p>
                  </div>
                  <div className="h-12 w-px" style={{ backgroundColor: C.border }} />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Accounts</p>
                    <p className="text-2xl font-bold tabular-nums" style={{ color: C.textBody }}>{instantly.total}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Ready</p>
                    <p className="text-2xl font-bold tabular-nums" style={{ color: C.green }}>{instantly.ready}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Warming Up</p>
                    <p className="text-2xl font-bold tabular-nums" style={{ color: "#D97706" }}>{instantly.warmupPending}</p>
                  </div>
                  <div className="flex-1" />
                  <a href="https://app.instantly.ai/app/accounts" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-opacity hover:opacity-80"
                    style={{ backgroundColor: "#7C3AED15", color: "#7C3AED" }}>
                    <Zap size={12} /> Manage in Instantly
                  </a>
                </div>
                <div className="px-5 py-4">
                  <details className="group">
                    <summary className="text-xs font-semibold cursor-pointer list-none flex items-center gap-2" style={{ color: C.textMuted }}>
                      <span className="group-open:rotate-90 transition-transform">▸</span>
                      View {instantly.total} accounts
                    </summary>
                    <div className="grid grid-cols-2 gap-2 mt-3 max-h-60 overflow-y-auto">
                      {instantly.accounts.map(a => (
                        <div key={a.email} className="flex items-center justify-between rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
                          <span className="truncate" style={{ color: C.textBody }}>{a.email}</span>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <span className="font-mono text-[10px]" style={{ color: C.textDim }}>{a.dailyLimit}/d</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: a.setupPending ? "#FFFBEB" : C.greenLight,
                                color: a.setupPending ? "#D97706" : C.green,
                              }}>
                              {a.setupPending ? "WARMUP" : "READY"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </div>
            )}
          </section>

          {/* ─── Aircall Numbers ─── */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Phone size={16} style={{ color: "#F97316" }} />
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Aircall Numbers</h2>
              <span className="text-[10px]" style={{ color: C.textMuted }}>Minutes per month · No daily limit</span>
            </div>
            {!aircall || aircall.numbers.length === 0 ? (
              <div className="rounded-xl border p-8 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
                <p className="text-sm" style={{ color: C.textDim }}>No Aircall numbers configured</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {aircall.numbers.map(n => (
                  <Link key={n.id} href={`/accounts/aircall/${n.id}`} className="rounded-xl border overflow-hidden card-lift block hover:shadow-md transition-shadow" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: "2px solid #F97316" }}>
                    <div className="px-5 py-4 flex items-center gap-3 border-b" style={{ borderColor: C.border }}>
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#F9731615" }}>
                        <Phone size={16} style={{ color: "#F97316" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{n.name}</p>
                        <p className="text-[10px] font-mono" style={{ color: C.textDim }}>{n.digits}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0"
                        style={{
                          backgroundColor: n.is_active ? C.greenLight : "#FFFBEB",
                          color: n.is_active ? C.green : "#D97706",
                        }}>
                        {n.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="px-5 py-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Globe size={12} style={{ color: C.textDim }} />
                        <span className="text-xs" style={{ color: C.textMuted }}>{n.country}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>Minutes</p>
                          <p className="text-xl font-bold tabular-nums" style={{ color: "#F97316" }}>{n.minutes}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>Calls</p>
                          <p className="text-xl font-bold tabular-nums" style={{ color: C.textBody }}>{n.calls}</p>
                        </div>
                      </div>
                      <p className="text-[10px]" style={{ color: C.textDim }}>This month</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

        </div>
      )}

      {/* ═══ TAB 1: HISTORY ═══ */}
      {tab === 1 && (
        <div>
          <div className="rounded-xl border mb-5 px-4 py-3 flex items-center gap-4 flex-wrap" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="flex items-center gap-2">
              <Calendar size={13} style={{ color: C.textDim }} />
              <input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)}
                className="rounded-lg border px-3 py-1.5 text-xs focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }} />
              {historyDate && <button onClick={() => setHistoryDate("")}><X size={12} style={{ color: C.textDim }} /></button>}
            </div>

            <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: C.bg }}>
              {[
                { key: "all", label: "All Channels" },
                { key: "linkedin", label: "LinkedIn", color: "#0A66C2" },
                { key: "email", label: "Email", color: "#7C3AED" },
                { key: "call", label: "Call", color: "#F97316" },
              ].map(opt => (
                <button key={opt.key} onClick={() => setHistoryChannel(opt.key)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                  style={{
                    backgroundColor: historyChannel === opt.key ? C.card : "transparent",
                    color: historyChannel === opt.key ? (opt.color ?? gold) : C.textMuted,
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: C.bg }}>
              <button onClick={() => setHistorySeller("all")}
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                style={{ backgroundColor: historySeller === "all" ? C.card : "transparent", color: historySeller === "all" ? gold : C.textMuted }}>
                All Sellers
              </button>
              {sellers.map(s => (
                <button key={s.id} onClick={() => setHistorySeller(s.id)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                  style={{ backgroundColor: historySeller === s.id ? C.card : "transparent", color: historySeller === s.id ? gold : C.textMuted }}>
                  {s.name}
                </button>
              ))}
            </div>

            {(historyDate || historyChannel !== "all" || historySeller !== "all") && (
              <button onClick={() => { setHistoryDate(""); setHistoryChannel("all"); setHistorySeller("all"); }}
                className="text-[10px] font-medium px-2 py-0.5 rounded-md" style={{ color: C.red }}>Clear all</button>
            )}
          </div>

          {filteredDates.length === 0 ? (
            <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <Calendar size={24} className="mx-auto mb-3" style={{ color: C.textDim }} />
              <p className="text-sm" style={{ color: C.textDim }}>No usage data for this period</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDates.map(date => {
                const entries = historyByDate[date].filter(h => {
                  if (historyChannel !== "all" && h.channel !== historyChannel) return false;
                  if (historySeller !== "all" && h.sellerId !== historySeller) return false;
                  return true;
                });
                const isToday = date === new Date().toISOString().slice(0, 10);
                const dayTotal = entries.reduce((s, e) => s + e.count, 0);
                const displayDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

                return (
                  <div key={date} className="rounded-xl border overflow-hidden card-shadow" style={{ backgroundColor: C.card, borderColor: C.border }}>
                    <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{displayDate}</span>
                        {isToday && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${gold}15`, color: gold }}>Today</span>}
                      </div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: C.textMuted }}>{dayTotal} messages</span>
                    </div>
                    <div className="divide-y" style={{ borderColor: C.border }}>
                      {entries.map((h, i) => {
                        const meta = channelMeta[h.channel];
                        const Icon = meta?.icon ?? Mail;
                        const sellerObj = sellers.find(s => s.id === h.sellerId);
                        const limit = h.channel === "linkedin" ? (sellerObj?.linkedin.limit ?? 15) : 0;
                        const pct = limit > 0 ? Math.round((h.count / limit) * 100) : 0;

                        return (
                          <div key={i} className="px-5 py-3 flex items-center gap-4">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                              style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
                              {h.sellerName[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{h.sellerName}</span>
                            </div>
                            <span className="text-xs font-semibold flex items-center gap-1 px-2 py-0.5 rounded-md shrink-0"
                              style={{ backgroundColor: `${meta?.color ?? C.textMuted}12`, color: meta?.color ?? C.textMuted }}>
                              <Icon size={10} /> {meta?.label ?? h.channel}
                            </span>
                            <div className="flex items-center gap-2 shrink-0 w-48">
                              <span className="text-sm font-bold tabular-nums" style={{ color: usageColor(pct) }}>{h.count}</span>
                              {limit > 0 && <>
                                <span className="text-[10px]" style={{ color: C.textDim }}>/ {limit}</span>
                                <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                                  <div className="h-1.5 rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: usageColor(pct) }} />
                                </div>
                                <span className="text-[10px] tabular-nums font-semibold w-8 text-right" style={{ color: usageColor(pct) }}>{pct}%</span>
                              </>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showAddModal && <AddAccountModal onClose={() => setShowAddModal(false)} onSuccess={() => { setShowAddModal(false); router.refresh(); }} />}
      {editTarget && <EditAccountModal seller={editTarget} onClose={() => setEditTarget(null)} onSuccess={() => { setEditTarget(null); router.refresh(); }} />}
      {linkTarget && <LinkUnipileModal seller={linkTarget} onClose={() => setLinkTarget(null)} onSuccess={() => { setLinkTarget(null); router.refresh(); }} />}
      {deleteTarget && <DeleteModal name={deleteTarget.name} onConfirm={handleDelete} onClose={() => setDeleteTarget(null)} loading={deleting} />}
    </div>
  );
}
