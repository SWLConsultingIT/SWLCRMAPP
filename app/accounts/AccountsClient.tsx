"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import {
  Share2, Mail, Phone, AlertTriangle, CheckCircle,
  Users, Calendar, Search, X, Plus, Trash2, Loader2, Shield,
} from "lucide-react";

const gold = "#C9A83A";

type SellerCard = {
  id: string;
  name: string;
  hasLinkedin: boolean;
  hasEmail: boolean;
  emailAccount: string | null;
  unipileId: string | null;
  linkedin: { sent: number; limit: number; pct: number };
  email: { sent: number; limit: number; pct: number };
  calls: number;
};

type HistoryEntry = {
  date: string;
  sellerId: string;
  sellerName: string;
  channel: string;
  count: number;
};

type Props = {
  sellers: SellerCard[];
  history: HistoryEntry[];
  totals: { linkedinSent: number; linkedinLimit: number; emailSent: number; emailLimit: number };
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

// ─── Add Account Modal (with PIN verification) ──────────────────────────────
function AddAccountModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<"pin" | "form">("pin");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [pinError, setPinError] = useState(false);
  const [name, setName] = useState("");
  const [unipileId, setUnipileId] = useState("");
  const [emailAccount, setEmailAccount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePinChange(idx: number, val: string) {
    if (val.length > 1) return;
    const next = [...pin];
    next[idx] = val;
    setPin(next);
    setPinError(false);
    // Auto-focus next input
    if (val && idx < 3) {
      const el = document.getElementById(`pin-${idx + 1}`);
      el?.focus();
    }
    // Auto-verify when all digits entered
    if (idx === 3 && val) {
      const full = next.join("");
      if (full === SECURITY_PIN) {
        setStep("form");
      } else {
        setPinError(true);
        setTimeout(() => setPin(["", "", "", ""]), 500);
        document.getElementById("pin-0")?.focus();
      }
    }
  }

  function handlePinKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !pin[idx] && idx > 0) {
      const el = document.getElementById(`pin-${idx - 1}`);
      el?.focus();
    }
  }

  async function handleSave() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        unipile_account_id: unipileId.trim() || null,
        email_account: emailAccount.trim() || null,
        linkedin_daily_limit: 15,
        email_daily_limit: 50,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to create account");
      setSaving(false);
      return;
    }
    setSaving(false);
    onSuccess();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-2xl border p-6 w-full max-w-lg shadow-2xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>{step === "pin" ? "Security Verification" : "Add New Account"}</h2>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>

        {/* PIN step */}
        {step === "pin" && (
          <div className="py-8 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: `${gold}15` }}>
              <Shield size={24} style={{ color: gold }} />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: C.textPrimary }}>Enter your security PIN</p>
            <p className="text-xs mb-6" style={{ color: C.textMuted }}>A 4-digit PIN is required to manage accounts</p>
            <div className="flex items-center justify-center gap-3 mb-4">
              {pin.map((d, i) => (
                <input
                  key={i}
                  id={`pin-${i}`}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={e => handlePinChange(i, e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => handlePinKeyDown(i, e)}
                  className="w-12 h-14 text-center text-2xl font-bold rounded-xl focus:outline-none transition-all"
                  style={{
                    backgroundColor: C.bg,
                    border: `2px solid ${pinError ? C.red : d ? gold : C.border}`,
                    color: C.textPrimary,
                    boxShadow: d ? `0 0 0 1px ${pinError ? C.red : gold}40` : "none",
                  }}
                  autoFocus={i === 0}
                />
              ))}
            </div>
            {pinError && (
              <p className="text-xs font-medium" style={{ color: C.red }}>Incorrect PIN. Try again.</p>
            )}
          </div>
        )}

        {/* Form step */}
        {step === "form" && (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: C.textMuted }}>Seller Name *</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Juan Perez"
                  className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none" style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }} />
              </div>

              <div className="rounded-xl border p-4" style={{ borderColor: "#0A66C220", backgroundColor: "#0A66C204" }}>
                <div className="flex items-center gap-2 mb-3">
                  <Share2 size={14} style={{ color: "#0A66C2" }} />
                  <span className="text-xs font-semibold" style={{ color: "#0A66C2" }}>LinkedIn (Unipile)</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textDim }}>Unipile Account ID</label>
                    <input type="text" value={unipileId} onChange={e => setUnipileId(e.target.value)} placeholder="Leave empty if not configured"
                      className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none" style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }} />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border p-4" style={{ borderColor: "#7C3AED20", backgroundColor: "#7C3AED04" }}>
                <div className="flex items-center gap-2 mb-3">
                  <Mail size={14} style={{ color: "#7C3AED" }} />
                  <span className="text-xs font-semibold" style={{ color: "#7C3AED" }}>Email (Instantly)</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textDim }}>Email Account</label>
                    <input type="text" value={emailAccount} onChange={e => setEmailAccount(e.target.value)} placeholder="e.g. juan@outreach.company.com"
                      className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none" style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }} />
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: C.redLight }}>
                <p className="text-xs font-medium" style={{ color: C.red }}>{error}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t" style={{ borderColor: C.border }}>
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: gold, color: "#1A1A2E" }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {saving ? "Creating..." : "Create Account"}
              </button>
            </div>
          </>
        )}
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
          <h2 className="text-lg font-bold" style={{ color: C.red }}>Remove Account</h2>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>

        <div className="rounded-xl border p-4 mb-4" style={{ borderColor: `${C.red}30`, backgroundColor: `${C.red}04` }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} style={{ color: C.red }} />
            <span className="text-sm font-semibold" style={{ color: C.red }}>This action cannot be undone</span>
          </div>
          <p className="text-xs" style={{ color: C.textBody }}>
            This will deactivate <strong>{name}</strong>. Active campaigns will continue but no new flows will be assigned to this account.
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold block mb-2" style={{ color: C.textMuted }}>
            Type <strong style={{ color: C.textPrimary }}>{name}</strong> to confirm:
          </label>
          <input type="text" value={typedName} onChange={e => setTypedName(e.target.value)}
            placeholder={name}
            className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none"
            style={{ color: C.textPrimary, backgroundColor: C.bg, border: `2px solid ${matches ? C.red : C.border}` }}
            autoFocus />
        </div>

        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t" style={{ borderColor: C.border }}>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>Cancel</button>
          <button onClick={onConfirm} disabled={!matches || loading}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-30 transition-opacity"
            style={{ backgroundColor: C.red, color: "#fff" }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {loading ? "Removing..." : "Remove Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function AccountsClient({ sellers, history, totals }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // History filters
  const [historyDate, setHistoryDate] = useState("");
  const [historyChannel, setHistoryChannel] = useState("all");
  const [historySeller, setHistorySeller] = useState("all");

  const liPct = totals.linkedinLimit > 0 ? Math.round((totals.linkedinSent / totals.linkedinLimit) * 100) : 0;
  const emPct = totals.emailLimit > 0 ? Math.round((totals.emailSent / totals.emailLimit) * 100) : 0;

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    await fetch("/api/accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id }) });
    setDeleting(false);
    setDeleteTarget(null);
    router.refresh();
  }

  // Group history by date for a card-based view
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
    { label: "Today's Usage", count: sellers.length, color: gold },
    { label: "History", count: dates.length + "d", color: C.blue },
  ];

  return (
    <div>
      {/* Team overview stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border p-4 card-lift" style={{ background: `linear-gradient(135deg, #FFFFFF 0%, ${gold}09 100%)`, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Team Members</span>
            <Users size={14} style={{ color: gold }} />
          </div>
          <p className="text-2xl font-bold" style={{ color: C.textBody }}>{sellers.length}</p>
        </div>
        <div className="rounded-xl border p-4 card-lift" style={{ background: "linear-gradient(135deg, #FFFFFF 0%, #0A66C209 100%)", borderColor: C.border, borderTop: "2px solid #0A66C2" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>LinkedIn Today</span>
            <Share2 size={14} style={{ color: "#0A66C2" }} />
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: usageColor(liPct) }}>
            {totals.linkedinSent} <span className="text-sm font-medium" style={{ color: C.textMuted }}>/ {totals.linkedinLimit}</span>
          </p>
        </div>
        <div className="rounded-xl border p-4 card-lift" style={{ background: "linear-gradient(135deg, #FFFFFF 0%, #7C3AED09 100%)", borderColor: C.border, borderTop: "2px solid #7C3AED" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Email Today</span>
            <Mail size={14} style={{ color: "#7C3AED" }} />
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: usageColor(emPct) }}>
            {totals.emailSent} <span className="text-sm font-medium" style={{ color: C.textMuted }}>/ {totals.emailLimit}</span>
          </p>
        </div>
        <div className="rounded-xl border p-4 card-lift" style={{ background: `linear-gradient(135deg, #FFFFFF 0%, ${sellers.some(s => s.linkedin.pct >= 100 || s.email.pct >= 100) ? C.red : C.green}09 100%)`, borderColor: C.border, borderTop: `2px solid ${sellers.some(s => s.linkedin.pct >= 100 || s.email.pct >= 100) ? C.red : C.green}` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Status</span>
            {sellers.some(s => s.linkedin.pct >= 100 || s.email.pct >= 100)
              ? <AlertTriangle size={14} style={{ color: C.red }} />
              : <CheckCircle size={14} style={{ color: C.green }} />}
          </div>
          <p className="text-2xl font-bold" style={{ color: sellers.some(s => s.linkedin.pct >= 100 || s.email.pct >= 100) ? C.red : C.green }}>
            {sellers.some(s => s.linkedin.pct >= 100 || s.email.pct >= 100)
              ? `${sellers.filter(s => s.linkedin.pct >= 100 || s.email.pct >= 100).length} Limited`
              : "All Clear"}
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
          <Plus size={14} /> Add Account
        </button>
      </div>

      {/* ═══ TAB 0: TODAY'S USAGE ═══ */}
      {tab === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sellers.map(seller => {
            const overallPct = Math.max(seller.linkedin.pct, seller.email.pct);
            const status = usageStatus(overallPct);
            return (
              <div key={seller.id} className="rounded-xl border overflow-hidden card-lift" style={{ backgroundColor: C.card, borderColor: C.border }}>
                <div className="px-5 py-4 flex items-center gap-3 border-b" style={{ borderColor: C.border }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
                    {seller.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{seller.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {seller.hasLinkedin && <span className="text-[9px] flex items-center gap-0.5" style={{ color: "#0A66C2" }}><Share2 size={8} /> LinkedIn</span>}
                      {seller.hasEmail && <span className="text-[9px] flex items-center gap-0.5" style={{ color: "#7C3AED" }}><Mail size={8} /> {seller.emailAccount}</span>}
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: status.bg, color: status.color }}>
                    {status.label}
                  </span>
                </div>
                <div className="px-5 py-4 space-y-4">
                  {seller.hasLinkedin && <UsageBar sent={seller.linkedin.sent} limit={seller.linkedin.limit} channel="linkedin" />}
                  {seller.hasEmail && <UsageBar sent={seller.email.sent} limit={seller.email.limit} channel="email" />}
                  {seller.calls > 0 && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: C.textMuted }}>
                      <Phone size={11} style={{ color: "#F97316" }} /> {seller.calls} calls today
                    </div>
                  )}
                  {!seller.hasLinkedin && !seller.hasEmail && (
                    <p className="text-xs text-center py-2" style={{ color: C.textDim }}>No channels configured</p>
                  )}
                </div>
                {/* Delete button */}
                <div className="px-5 py-3 border-t flex justify-end" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <button onClick={() => setDeleteTarget({ id: seller.id, name: seller.name })}
                    className="flex items-center gap-1.5 text-[10px] font-medium px-3 py-1.5 rounded-md transition-opacity hover:opacity-80"
                    style={{ backgroundColor: C.redLight, color: C.red }}>
                    <Trash2 size={10} /> Remove Account
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ TAB 1: HISTORY (card-by-date) ═══ */}
      {tab === 1 && (
        <div>
          {/* Filters */}
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
              ].map(opt => (
                <button key={opt.key} onClick={() => setHistoryChannel(opt.key)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                  style={{
                    backgroundColor: historyChannel === opt.key ? C.card : "transparent",
                    color: historyChannel === opt.key ? (opt.color ?? gold) : C.textMuted,
                    boxShadow: historyChannel === opt.key ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: C.bg }}>
              <button onClick={() => setHistorySeller("all")}
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                style={{
                  backgroundColor: historySeller === "all" ? C.card : "transparent",
                  color: historySeller === "all" ? gold : C.textMuted,
                  boxShadow: historySeller === "all" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                }}>
                All Sellers
              </button>
              {sellers.map(s => (
                <button key={s.id} onClick={() => setHistorySeller(s.id)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                  style={{
                    backgroundColor: historySeller === s.id ? C.card : "transparent",
                    color: historySeller === s.id ? gold : C.textMuted,
                    boxShadow: historySeller === s.id ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                  }}>
                  {s.name}
                </button>
              ))}
            </div>

            {(historyDate || historyChannel !== "all" || historySeller !== "all") && (
              <button onClick={() => { setHistoryDate(""); setHistoryChannel("all"); setHistorySeller("all"); }}
                className="text-[10px] font-medium px-2 py-0.5 rounded-md" style={{ color: C.red }}>
                Clear all
              </button>
            )}
          </div>

          {/* Date cards */}
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
                    {/* Date header */}
                    <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{displayDate}</span>
                        {isToday && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${gold}15`, color: gold }}>Today</span>}
                      </div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: C.textMuted }}>{dayTotal} messages</span>
                    </div>

                    {/* Entries per seller+channel */}
                    <div className="divide-y" style={{ borderColor: C.border }}>
                      {entries.map((h, i) => {
                        const meta = channelMeta[h.channel];
                        const Icon = meta?.icon ?? Mail;
                        const sellerObj = sellers.find(s => s.id === h.sellerId);
                        const limit = h.channel === "linkedin" ? (sellerObj?.linkedin.limit ?? 15) : (sellerObj?.email.limit ?? 50);
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
                              <span className="text-[10px]" style={{ color: C.textDim }}>/ {limit}</span>
                              <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                                <div className="h-1.5 rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: usageColor(pct) }} />
                              </div>
                              <span className="text-[10px] tabular-nums font-semibold w-8 text-right" style={{ color: usageColor(pct) }}>{pct}%</span>
                            </div>
                            {pct >= 100 && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: C.redLight, color: C.red }}>Limited</span>}
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

      {/* Add Account Modal */}
      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); router.refresh(); }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteModal
          name={deleteTarget.name}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
          loading={deleting}
        />
      )}
    </div>
  );
}
