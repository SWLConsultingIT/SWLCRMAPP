"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { C } from "@/lib/design";
import { useAuthUser } from "@/lib/auth-context";
import EmptyState from "@/components/EmptyState";
import {
  Share2, Mail, Phone, AlertTriangle,
  Users, Calendar, X, Plus, Trash2, Loader2, Shield, Pencil, Save,
  Zap, Globe, TrendingUp, Settings, ChevronRight, Link2, CheckCircle, Send,
} from "lucide-react";
import EmailPoolManager from "@/components/EmailPoolManager";
import AircallPoolManager from "@/components/AircallPoolManager";

const gold = "var(--brand, #c9a83a)";

type SellerCard = {
  id: string;
  name: string;
  hasLinkedin: boolean;
  unipileId: string | null;
  linkedin: { sent: number; limit: number; pct: number };
  calls: number;
  isShared: boolean;
  hasTelegram: boolean;
  telegramAccountId: string | null;
  telegram: { sent: number; limit: number; pct: number };
  telegramStatus: string | null;
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
  if (pct >= 80) return { label: "Almost Full", color: "#D97706", bg: "color-mix(in srgb, #D97706 13%, transparent)" };
  return { label: "Available", color: C.green, bg: C.greenLight };
}

const TG_BLUE = "#229ED9";

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
  telegram: { icon: Send,   color: TG_BLUE,   label: "Telegram" },
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
      <div className="h-2 rounded-full" style={{ backgroundColor: C.border }}>
        <div className="h-2 rounded-full transition-[opacity,transform,box-shadow,background-color,border-color]" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-[9px] font-semibold mt-1 text-right tabular-nums" style={{ color }}>{pct}%</p>
    </div>
  );
}

// ─── Add Account Modal (3-channel picker) ──────────────────────────────────
// Channel picker → LinkedIn flow / hand-off to Email or Calls manager. The
// older client-side PIN gate was removed once the button itself became
// admin-only and the API endpoints validate role server-side — keeping it
// would have been redundant friction.
// onPickEmail / onPickCalls let the parent close this modal and open the
// pool-manager modal that already handles its own claim flow.
function AddAccountModal({
  onClose,
  onSuccess,
  onPickEmail,
  onPickCalls,
  isAdmin,
  currentBioId,
  existingSeller,
}: {
  onClose: () => void;
  onSuccess: () => void;
  onPickEmail: () => void;
  onPickCalls: () => void;
  isAdmin: boolean;
  currentBioId: string | null;
  existingSeller?: SellerCard;
}) {
  // Reconnect flow: skip channel picker, prefill name/limit from the existing
  // seller row, and pass its id back to the API so it reuses the row instead
  // of creating a duplicate.
  const [step, setStep] = useState<"channel" | "form" | "connecting" | "connected" | "share_existing" | "pick_unipile">(
    existingSeller ? "form" : "channel"
  );
  const [name, setName] = useState(existingSeller?.name ?? "");
  const [linkedinLimit, setLinkedinLimit] = useState(existingSeller?.linkedin.limit ?? 15);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sellerId, setSellerId] = useState<string | null>(existingSeller?.id ?? null);
  const [authWindow, setAuthWindow] = useState<Window | null>(null);

  // Stored outside React state so the popup reference is available before the
  // backend round-trip resolves. Using state would re-render and the stale
  // reference inside the async callback can't be relied on.
  const [authUrl, setAuthUrlState] = useState<string | null>(null);

  async function handleStartConnection() {
    if (!name.trim()) { setError("Name is required"); return; }
    // 1. OPEN THE POPUP FIRST, synchronously, while we still have the user's
    //    click as a "trusted gesture". If we wait for fetch() to resolve,
    //    Chrome/Safari/Firefox will silently block window.open() because the
    //    gesture has been lost. We open it on about:blank now and navigate
    //    once the backend hands us the real Unipile URL.
    const w = window.open("about:blank", "unipile-auth", "width=720,height=800");
    setAuthWindow(w);

    setSaving(true); setError(null);
    const res = await fetch("/api/unipile/hosted-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        linkedin_daily_limit: linkedinLimit,
        ...(existingSeller ? { sellerId: existingSeller.id } : {}),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      try { w?.close(); } catch { /* ignore */ }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to start LinkedIn connection");
      return;
    }
    const { sellerId: sid, authUrl: url } = await res.json();
    setSellerId(sid);
    setStep("connecting");
    setAuthUrlState(url);

    // 2. Navigate the pre-opened window to the Unipile auth URL.
    //    If w is null, the browser blocked it — surface a manual link instead.
    if (w && !w.closed) {
      try { w.location.href = url; } catch { /* ignore — user may have closed it */ }
    }
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
            {step === "channel" ? "Add Account"
              : step === "connecting" ? "Connecting LinkedIn"
              : step === "connected" ? "Connected"
              : step === "share_existing" ? "Share existing seller"
              : step === "pick_unipile" ? "Link existing Unipile account"
              : existingSeller ? "Reconnect LinkedIn" : "Add LinkedIn Seller"}
          </h2>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>

        {step === "channel" && (
          <div className="space-y-2 py-2">
            <p className="text-xs mb-3" style={{ color: C.textMuted }}>
              Pick the channel you want to add to your tenant.
            </p>
            {[
              {
                key: "linkedin" as const,
                label: "LinkedIn seller",
                desc: "Add a new seller and connect their LinkedIn via Unipile.",
                icon: Share2,
                color: "#0A66C2",
                onClick: () => setStep("form"),
              },
              // Super-admin shortcut: share a seller already connected in another
              // tenant into the current one. Skips the Unipile re-auth entirely
              // by toggling sellers.shared_with_company_bio_ids[]. Only shown when
              // there's a tenant scope (currentBioId is null when super_admin is
              // browsing the global SWL pool — no tenant to share into).
              ...(isAdmin && currentBioId ? [
                {
                  key: "share_existing" as const,
                  label: "Share existing seller",
                  desc: "Reuse a seller already connected in another tenant — no LinkedIn re-auth.",
                  icon: Link2,
                  color: "#16A34A",
                  onClick: () => setStep("share_existing"),
                },
                {
                  key: "pick_unipile" as const,
                  label: "Link existing Unipile account",
                  desc: "Attach a LinkedIn account that's already connected on Unipile but not yet wired to any seller.",
                  icon: Share2,
                  color: "#0A66C2",
                  onClick: () => setStep("pick_unipile"),
                },
              ] : []),
              // Email + Calls require admin: Instantly account and Aircall
              // workspace are SWL-managed today. Hidden for clients to avoid
              // sending them into a flow they'll be 403'd out of.
              ...(isAdmin ? [
                {
                  key: "email" as const,
                  label: "Email inbox",
                  desc: "Claim Instantly inboxes into your tenant's email pool.",
                  icon: Mail,
                  color: "#7C3AED",
                  onClick: () => { onClose(); onPickEmail(); },
                },
                {
                  key: "calls" as const,
                  label: "Aircall number",
                  desc: "Claim an Aircall line into your tenant's calls pool.",
                  icon: Phone,
                  color: "#F97316",
                  onClick: () => { onClose(); onPickCalls(); },
                },
              ] : []),
            ].map(opt => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.key}
                  onClick={opt.onClick}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors hover:bg-black/[0.02]"
                  style={{ borderColor: C.border, backgroundColor: C.bg }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${opt.color} 12%, transparent)` }}
                  >
                    <Icon size={16} style={{ color: opt.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{opt.label}</p>
                    <p className="text-[11px] leading-snug" style={{ color: C.textMuted }}>{opt.desc}</p>
                  </div>
                  <ChevronRight size={14} style={{ color: C.textDim }} />
                </button>
              );
            })}
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
              <div className="rounded-2xl border p-4" style={{ borderColor: "#0A66C230", background: "linear-gradient(135deg, #0A66C204 0%, #0A66C20D 100%)", boxShadow: "0 4px 14px rgba(10,102,194,0.06)" }}>
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
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: C.surface, color: C.textBody }}>Cancel</button>
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
            <p className="text-xs" style={{ color: C.textMuted }}>
              Complete the login in the Unipile window. This modal will update automatically.
            </p>

            {/* If the popup is closed/blocked, expose a real link the user can click directly.
                The click is a fresh user gesture so popup blockers won't intervene. */}
            {authUrl && (
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-4 text-xs font-semibold underline"
                style={{ color: "#0A66C2" }}
              >
                Don&apos;t see the Unipile window? Open it manually →
              </a>
            )}

            <p className="text-[10px] mt-6" style={{ color: C.textDim }}>
              If you closed the window, <button onClick={() => { setStep("form"); setAuthUrlState(null); }} className="underline" style={{ color: "#0A66C2" }}>try again</button>.
            </p>
          </div>
        )}

        {step === "connected" && (
          <div className="py-10 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "color-mix(in srgb, #16A34A 16%, transparent)" }}>
              <Shield size={24} style={{ color: "#16A34A" }} />
            </div>
            <p className="text-sm font-bold mb-1" style={{ color: "#16A34A" }}>LinkedIn connected ✓</p>
            <p className="text-xs" style={{ color: C.textMuted }}>{name} is ready to start campaigns.</p>
          </div>
        )}

        {step === "share_existing" && currentBioId && (
          <ShareExistingSellerPicker
            currentBioId={currentBioId}
            onBack={() => setStep("channel")}
            onShared={onSuccess}
          />
        )}

        {step === "pick_unipile" && currentBioId && (
          <PickUnipileAccount
            currentBioId={currentBioId}
            onBack={() => setStep("channel")}
            onLinked={onSuccess}
          />
        )}
      </div>
    </div>
  );
}

// ─── Share Existing Seller (super_admin only) ───────────────────────────────
// Lists every seller across tenants and lets the super_admin toggle the current
// tenant into `sellers.shared_with_company_bio_ids[]` — the same mechanism the
// /admin/[id] page uses. Skips Unipile re-auth entirely.
type SharableSeller = {
  id: string;
  name: string;
  active: boolean;
  company_bio_id: string | null;
  shared_with_company_bio_ids: string[] | null;
  linkedin_status: string | null;
};

function ShareExistingSellerPicker({
  currentBioId,
  onBack,
  onShared,
}: {
  currentBioId: string;
  onBack: () => void;
  onShared: () => void;
}) {
  const [sellers, setSellers] = useState<SharableSeller[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/sellers-access", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/admin/aircall-access", { cache: "no-store" }).then(r => r.json()).catch(() => ({ companies: [] })),
    ]).then(([sellersData, aircallData]) => {
      setSellers((sellersData.sellers ?? []) as SharableSeller[]);
      const map: Record<string, string> = {};
      for (const c of (aircallData.companies ?? []) as { id: string; company_name: string }[]) {
        map[c.id] = c.company_name;
      }
      setCompanies(map);
    }).catch(e => setError(e instanceof Error ? e.message : "Failed to load sellers"))
      .finally(() => setLoading(false));
  }, []);

  async function share(seller: SharableSeller) {
    setBusyId(seller.id); setError(null);
    const res = await fetch("/api/admin/sellers-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sellerId: seller.id, companyBioId: currentBioId, shared: true }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to share seller");
      return;
    }
    onShared();
  }

  // Sellers owned by another tenant that aren't already shared into the current one.
  const candidates = sellers.filter(s =>
    s.company_bio_id !== currentBioId &&
    !(s.shared_with_company_bio_ids ?? []).includes(currentBioId)
  );

  return (
    <>
      <p className="text-xs mb-3" style={{ color: C.textMuted }}>
        Pick a seller already connected in another tenant. It will become available in this tenant without a second LinkedIn login.
      </p>

      {loading && (
        <div className="py-10 text-center">
          <Loader2 size={20} className="animate-spin mx-auto mb-2" style={{ color: C.textMuted }} />
          <p className="text-xs" style={{ color: C.textMuted }}>Loading sellers…</p>
        </div>
      )}

      {!loading && candidates.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-sm font-medium mb-1" style={{ color: C.textPrimary }}>No sellers to share</p>
          <p className="text-xs" style={{ color: C.textMuted }}>Every existing seller is already in this tenant.</p>
        </div>
      )}

      {!loading && candidates.length > 0 && (
        <div className="max-h-[420px] overflow-y-auto -mx-2 px-2 divide-y" style={{ borderColor: C.border }}>
          {candidates.map(s => {
            const owner = s.company_bio_id ? (companies[s.company_bio_id] ?? "Other tenant") : "Unassigned";
            const busy = busyId === s.id;
            return (
              <div key={s.id} className="flex items-center gap-3 py-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: s.active ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` : C.border, color: s.active ? "#fff" : "#9CA3AF" }}>
                  {s.name[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>{s.name}</p>
                  <p className="text-[11px]" style={{ color: C.textDim }}>
                    Owned by {owner}{s.active ? "" : " · inactive"}
                  </p>
                </div>
                <button onClick={() => share(s)} disabled={busy}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md border inline-flex items-center gap-1.5 disabled:opacity-60"
                  style={{ borderColor: "#16A34A", color: "#16A34A", backgroundColor: "transparent" }}>
                  {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                  {busy ? "Sharing…" : "Share"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: C.redLight }}><p className="text-xs font-medium" style={{ color: C.red }}>{error}</p></div>}

      <div className="flex items-center justify-between mt-5 pt-4 border-t" style={{ borderColor: C.border }}>
        <button onClick={onBack} className="text-xs font-semibold" style={{ color: C.textMuted }}>← Back</button>
      </div>
    </>
  );
}

// ─── Pick Unipile Account (super_admin only) ────────────────────────────────
// Lists Unipile LinkedIn accounts that are connected but not yet linked to any
// seller. Useful when the LinkedIn auth was done directly in the Unipile
// dashboard. Creates a new seller in the current tenant pointing at that
// account — no second OAuth round-trip.
type OrphanUnipile = { id: string; name: string; created_at: string; status: string };

function PickUnipileAccount({
  currentBioId,
  onBack,
  onLinked,
}: {
  currentBioId: string;
  onBack: () => void;
  onLinked: () => void;
}) {
  const [accounts, setAccounts] = useState<OrphanUnipile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/unipile/unlinked-accounts", { cache: "no-store" })
      .then(r => r.json())
      .then(d => setAccounts((d.accounts ?? []) as OrphanUnipile[]))
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load Unipile accounts"))
      .finally(() => setLoading(false));
  }, []);

  async function linkOne(acc: OrphanUnipile) {
    setBusyId(acc.id); setError(null);
    const name = (nameOverride[acc.id] ?? acc.name).trim();
    if (!name) { setError("Seller name can't be empty"); setBusyId(null); return; }
    const res = await fetch("/api/admin/sellers/from-unipile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unipile_account_id: acc.id,
        name,
        companyBioId: currentBioId,
      }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to link Unipile account");
      return;
    }
    onLinked();
  }

  return (
    <>
      <p className="text-xs mb-3" style={{ color: C.textMuted }}>
        Pick a LinkedIn account already connected on Unipile but not yet attached to a seller. A new seller will be created in this tenant.
      </p>

      {loading && (
        <div className="py-10 text-center">
          <Loader2 size={20} className="animate-spin mx-auto mb-2" style={{ color: C.textMuted }} />
          <p className="text-xs" style={{ color: C.textMuted }}>Loading Unipile accounts…</p>
        </div>
      )}

      {!loading && accounts.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-sm font-medium mb-1" style={{ color: C.textPrimary }}>No orphan Unipile accounts</p>
          <p className="text-xs" style={{ color: C.textMuted }}>Every connected LinkedIn account already belongs to a seller. Connect a new one in Unipile first, or use the LinkedIn seller flow.</p>
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <div className="max-h-[420px] overflow-y-auto -mx-2 px-2 divide-y" style={{ borderColor: C.border }}>
          {accounts.map(acc => {
            const busy = busyId === acc.id;
            const statusOk = acc.status === "OK" || acc.status === "RUNNING" || acc.status === "CONNECTED";
            return (
              <div key={acc.id} className="flex items-center gap-3 py-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: "#0A66C2", color: "#fff" }}>
                  {acc.name[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={nameOverride[acc.id] ?? acc.name}
                    onChange={e => setNameOverride(prev => ({ ...prev, [acc.id]: e.target.value }))}
                    className="w-full text-sm font-semibold bg-transparent outline-none truncate"
                    style={{ color: C.textPrimary }}
                  />
                  <p className="text-[10px] font-mono mt-0.5 truncate" style={{ color: C.textDim }}>
                    {acc.id.slice(0, 16)}… · {acc.status}
                    {!statusOk && <span style={{ color: C.red }}> · check status</span>}
                  </p>
                </div>
                <button onClick={() => linkOne(acc)} disabled={busy}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md border inline-flex items-center gap-1.5 disabled:opacity-60"
                  style={{ borderColor: "#0A66C2", color: "#0A66C2", backgroundColor: "transparent" }}>
                  {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                  {busy ? "Linking…" : "Link"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: C.redLight }}><p className="text-xs font-medium" style={{ color: C.red }}>{error}</p></div>}

      <div className="flex items-center justify-between mt-5 pt-4 border-t" style={{ borderColor: C.border }}>
        <button onClick={onBack} className="text-xs font-semibold" style={{ color: C.textMuted }}>← Back</button>
      </div>
    </>
  );
}

// ─── Connect Telegram Modal ─────────────────────────────────────────────────
function ConnectTelegramModal({ seller, onClose, onSuccess }: { seller: SellerCard; onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<"form" | "connecting" | "connected">("form");
  const [dailyLimit, setDailyLimit] = useState(20);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authUrl, setAuthUrlState] = useState<string | null>(null);
  const [authWindow, setAuthWindow] = useState<Window | null>(null);

  async function handleConnect() {
    const w = window.open("about:blank", "unipile-tg-auth", "width=720,height=800");
    setAuthWindow(w);
    setSaving(true); setError(null);

    const res = await fetch("/api/unipile/telegram-hosted-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sellerId: seller.id, telegramDailyLimit: dailyLimit }),
    });
    setSaving(false);

    if (!res.ok) {
      try { w?.close(); } catch { /* ignore */ }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to start Telegram connection");
      return;
    }

    const { authUrl: url } = await res.json();
    setStep("connecting");
    setAuthUrlState(url);
    if (w && !w.closed) {
      try { w.location.href = url; } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    if (step !== "connecting") return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/sellers/${seller.id}/telegram-connection-status`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (data.connected) {
        clearInterval(interval);
        try { authWindow?.close(); } catch { /* ignore */ }
        setStep("connected");
        setTimeout(onSuccess, 1200);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [step, authWindow, onSuccess, seller.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-2xl border p-6 w-full max-w-md shadow-2xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>
            {step === "form" ? "Connect Telegram" : step === "connecting" ? "Connecting Telegram" : "Connected"}
          </h2>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>

        {step === "form" && (
          <>
            <div className="rounded-2xl border p-4 mb-5" style={{ borderColor: `${TG_BLUE}30`, background: `linear-gradient(135deg, ${TG_BLUE}04 0%, ${TG_BLUE}0D 100%)` }}>
              <div className="flex items-center gap-2 mb-2">
                <Send size={14} style={{ color: TG_BLUE }} />
                <span className="text-xs font-semibold" style={{ color: TG_BLUE }}>Telegram — {seller.name}</span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: C.textMuted }}>
                Unipile will open a QR code or phone prompt. Scan with your Telegram app to link the account.
                SWL never sees your Telegram credentials.
              </p>
              <div className="flex items-center justify-between mt-3">
                <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>Daily send limit</label>
                <input type="number" value={dailyLimit} min={1} max={50} onChange={e => setDailyLimit(Number(e.target.value))}
                  className="w-16 rounded px-2 py-1 text-xs text-center focus:outline-none"
                  style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }} />
              </div>
            </div>

            {error && <div className="mb-4 rounded-lg px-3 py-2" style={{ backgroundColor: C.redLight }}><p className="text-xs font-medium" style={{ color: C.red }}>{error}</p></div>}

            <div className="flex items-center justify-end gap-3">
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: C.surface, color: C.textBody }}>Cancel</button>
              <button onClick={handleConnect} disabled={saving}
                className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: TG_BLUE, color: "#fff" }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {saving ? "Preparing…" : "Connect Telegram"}
              </button>
            </div>
          </>
        )}

        {step === "connecting" && (
          <div className="py-10 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${TG_BLUE}15` }}>
              <Loader2 size={24} className="animate-spin" style={{ color: TG_BLUE }} />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: C.textPrimary }}>Waiting for Telegram authentication…</p>
            <p className="text-xs" style={{ color: C.textMuted }}>Complete the flow in the Unipile window. This modal updates automatically.</p>
            {authUrl && (
              <a href={authUrl} target="_blank" rel="noopener noreferrer"
                className="inline-block mt-4 text-xs font-semibold underline" style={{ color: TG_BLUE }}>
                Don&apos;t see the window? Open it manually →
              </a>
            )}
          </div>
        )}

        {step === "connected" && (
          <div className="py-10 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "color-mix(in srgb, #16A34A 16%, transparent)" }}>
              <Shield size={24} style={{ color: "#16A34A" }} />
            </div>
            <p className="text-sm font-bold mb-1" style={{ color: "#16A34A" }}>Telegram connected ✓</p>
            <p className="text-xs" style={{ color: C.textMuted }}>{seller.name} is ready to send Telegram campaigns.</p>
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
          <div className="rounded-2xl border p-4" style={{ borderColor: "#0A66C230", background: "linear-gradient(135deg, #0A66C204 0%, #0A66C20D 100%)", boxShadow: "0 4px 14px rgba(10,102,194,0.06)" }}>
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
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: C.surface, color: C.textBody }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: C.blue, color: "#fff" }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving…" : "Save Changes"}
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
                  className="w-full text-left rounded-lg p-3 border transition-[opacity,transform,box-shadow,background-color,border-color] flex items-center gap-3"
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
                    style={{ backgroundColor: a.status === "OK" ? "color-mix(in srgb, #16A34A 16%, transparent)" : "color-mix(in srgb, #D97706 16%, transparent)", color: a.status === "OK" ? "#16A34A" : "#D97706" }}>
                    {a.status}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {error && <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: C.redLight }}><p className="text-xs font-medium" style={{ color: C.red }}>{error}</p></div>}

        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t" style={{ borderColor: C.border }}>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: C.surface, color: C.textBody }}>Cancel</button>
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
        <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: `${C.red}30`, background: `linear-gradient(135deg, ${C.red}05 0%, ${C.red}0D 100%)`, boxShadow: `0 4px 14px ${C.red}10` }}>
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
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: C.surface, color: C.textBody }}>Cancel</button>
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
  const [reconnectTarget, setReconnectTarget] = useState<SellerCard | null>(null);
  const [editTarget, setEditTarget] = useState<SellerCard | null>(null);
  const [linkTarget, setLinkTarget] = useState<SellerCard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [connectTelegramTarget, setConnectTelegramTarget] = useState<SellerCard | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showPoolManager, setShowPoolManager] = useState(false);
  const [showAircallManager, setShowAircallManager] = useState(false);
  // Was a duplicate /api/auth/me fetch — now reads from shared AuthContext.
  const authUser = useAuthUser();
  const isAdmin = authUser?.role === "admin";

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

  // Unshare a seller that was previously shared into this tenant (super_admin
  // only). Mirror of the Share flow — toggles the current tenant out of
  // sellers.shared_with_company_bio_ids[] without touching the primary owner.
  const [unsharingId, setUnsharingId] = useState<string | null>(null);
  async function handleUnshare(sellerId: string) {
    const bio = authUser?.companyBioId;
    if (!bio) return;
    setUnsharingId(sellerId);
    await fetch("/api/admin/sellers-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sellerId, companyBioId: bio, shared: false }),
    });
    setUnsharingId(null);
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
    { label: "Last 24h", count: `${sellers.length}`, color: gold },
    { label: "History", count: `${dates.length}d`, color: C.blue },
  ];

  return (
    <div>
      {/* ═══ KPI CARDS ═══ */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-2xl border p-4 card-lift" style={{ background: `linear-gradient(135deg, var(--c-card) 0%, color-mix(in srgb, ${gold} 5%, transparent) 100%)`, borderColor: C.border, borderTop: `3px solid ${gold}`, boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Team Members</span>
            <Users size={14} style={{ color: gold }} />
          </div>
          <p className="text-2xl font-bold" style={{ color: C.textBody }}>{sellers.length}</p>
        </div>

        <div className="rounded-2xl border p-4 card-lift" style={{ background: "linear-gradient(135deg, var(--c-card) 0%, #0A66C20D 100%)", borderColor: C.border, borderTop: "3px solid #0A66C2", boxShadow: "0 4px 16px rgba(10,102,194,0.06)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>LinkedIn · Last 24h</span>
            <Share2 size={14} style={{ color: "#0A66C2" }} />
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: usageColor(liPct) }}>
            {totals.linkedinSent} <span className="text-sm font-medium" style={{ color: C.textMuted }}>/ {totals.linkedinLimit}</span>
          </p>
        </div>

        <div className="rounded-2xl border p-4 card-lift" style={{ background: "linear-gradient(135deg, var(--c-card) 0%, #7C3AED0D 100%)", borderColor: C.border, borderTop: `3px solid ${usageColor(instantlyPct)}`, boxShadow: "0 4px 16px rgba(124,58,237,0.06)" }}>
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

        <div className="rounded-2xl border p-4 card-lift" style={{ background: "linear-gradient(135deg, var(--c-card) 0%, #F973160D 100%)", borderColor: C.border, borderTop: "3px solid #F97316", boxShadow: "0 4px 16px rgba(249,115,22,0.06)" }}>
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
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-[opacity,transform,box-shadow,background-color,border-color] relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              {t.label}
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: isActive ? `${t.color}15` : C.surface, color: isActive ? t.color : C.textDim }}>
                {t.count}
              </span>
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
        <div className="flex-1" />
        {/* Visible to every authenticated user — clients self-serve their own
            LinkedIn sellers. The modal hides Email/Calls for non-admins since
            those resources (Instantly inboxes, Aircall numbers) are admin-managed today. */}
        <button onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold mb-1 transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-md"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
          <Plus size={14} /> Add Account
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
                  <div key={seller.id} className="rounded-2xl border overflow-hidden card-lift" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                    <div className="px-5 py-4 flex items-center gap-3 border-b" style={{ borderColor: C.border }}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>{seller.name[0]}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>{seller.name}</p>
                          {seller.isShared && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ backgroundColor: "#7C3AED15", color: "#7C3AED", border: "1px solid #7C3AED30" }}
                              title="Shared from another tenant via admin">
                              Shared
                            </span>
                          )}
                        </div>
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
                        : <p className="text-xs text-center py-2" style={{ color: C.textDim }}>No LinkedIn configured</p>}
                      {seller.hasTelegram && (
                        <UsageBar sent={seller.telegram.sent} limit={seller.telegram.limit} channel="telegram" />
                      )}
                      {seller.calls > 0 && (
                        <div className="flex items-center gap-2 text-xs" style={{ color: C.textMuted }}>
                          <Phone size={11} style={{ color: "#F97316" }} /> {seller.calls} calls today
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-3 border-t flex flex-wrap items-center gap-1.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      {!seller.hasLinkedin && !seller.isShared && (
                        <button onClick={() => setReconnectTarget(seller)}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-80 shrink-0 whitespace-nowrap"
                          style={{ backgroundColor: "#0A66C2", color: "#fff" }}><Share2 size={10} /> Connect LinkedIn</button>
                      )}
                      {!seller.hasLinkedin && !seller.isShared && isAdmin && (
                        <button onClick={() => setLinkTarget(seller)}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-80 shrink-0 whitespace-nowrap"
                          style={{ backgroundColor: "#0A66C215", color: "#0A66C2", border: "1px solid #0A66C230" }}><Share2 size={10} /> Link existing</button>
                      )}
                      {!seller.hasTelegram && !seller.isShared && (
                        <button onClick={() => setConnectTelegramTarget(seller)}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-80 shrink-0 whitespace-nowrap"
                          style={{ backgroundColor: `${TG_BLUE}20`, color: TG_BLUE, border: `1px solid ${TG_BLUE}30` }}>
                          <Send size={10} /> Connect Telegram
                        </button>
                      )}
                      {seller.hasTelegram && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-md shrink-0 whitespace-nowrap"
                          style={{ backgroundColor: `${TG_BLUE}15`, color: TG_BLUE }}>
                          <Send size={10} /> Telegram ✓
                        </span>
                      )}
                      <Link href={`/accounts/linkedin/${seller.id}`}
                        title="Per-campaign messages sent, replies & positives for this seller"
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-80 shrink-0 whitespace-nowrap"
                        style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}><TrendingUp size={10} /> Per-campaign</Link>
                      <span className="flex-1" />
                      {!seller.isShared && (
                        <button onClick={() => setEditTarget(seller)}
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-80 shrink-0 whitespace-nowrap"
                          style={{ backgroundColor: C.blueLight, color: C.blue }}><Pencil size={10} /> Edit</button>
                      )}
                      {!seller.isShared && (
                        <button onClick={() => setDeleteTarget({ id: seller.id, name: seller.name })}
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-80 shrink-0 whitespace-nowrap"
                          style={{ backgroundColor: C.redLight, color: C.red }}><Trash2 size={10} /> Remove</button>
                      )}
                      {seller.isShared && isAdmin && authUser?.companyBioId && (
                        <button onClick={() => handleUnshare(seller.id)} disabled={unsharingId === seller.id}
                          title="Remove this shared seller from the current tenant (the primary owner is not touched)"
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-80 disabled:opacity-50 shrink-0 whitespace-nowrap"
                          style={{ backgroundColor: C.redLight, color: C.red }}>
                          {unsharingId === seller.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                          {unsharingId === seller.id ? "Unsharing…" : "Unshare"}
                        </button>
                      )}
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
              <div className="rounded-2xl border px-4 py-3 mb-4 flex items-center gap-3"
                style={{ background: instantlyPct >= 100 ? `linear-gradient(135deg, ${C.redLight} 0%, ${C.red}15 100%)` : "linear-gradient(135deg, color-mix(in srgb, #D97706 13%, transparent) 0%, color-mix(in srgb, #D97706 16%, transparent) 100%)", borderColor: instantlyPct >= 100 ? `${C.red}40` : "color-mix(in srgb, #D97706 34%, transparent)", boxShadow: instantlyPct >= 100 ? `0 4px 14px ${C.red}15` : "0 4px 14px rgba(217,119,6,0.08)" }}>
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
              <div className="rounded-2xl border p-8 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <p className="text-sm" style={{ color: C.textDim }}>Instantly API unavailable</p>
              </div>
            ) : (
              <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `3px solid ${usageColor(instantlyPct)}`, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
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
                  {isAdmin && (
                    <>
                      <button onClick={() => setShowPoolManager(true)}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors hover:bg-black/[0.02]"
                        style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
                        <Settings size={12} /> Manage pool
                      </button>
                      <a href="https://app.instantly.ai/app/accounts" target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-opacity hover:opacity-80"
                        style={{ backgroundColor: "#7C3AED15", color: "#7C3AED" }}>
                        <Zap size={12} /> Manage in Instantly
                      </a>
                    </>
                  )}
                </div>
                {/* Per-domain rollup (boss 2026-06-08, items 9 + 11): the
                    emails/day budget grouped by sending domain, so you can see
                    how many mailboxes + how much daily volume each domain
                    carries. Per-mailbox SENT attribution isn't shown — Instantly
                    rotates inboxes and campaign_messages never records the
                    from-address, so real per-mailbox counts need the Instantly
                    analytics API (deferred). */}
                {(() => {
                  const byDomain = new Map<string, { count: number; limit: number; warmup: number }>();
                  for (const a of instantly.accounts) {
                    const dom = (a.email.split("@")[1] ?? "—").toLowerCase();
                    const d = byDomain.get(dom) ?? { count: 0, limit: 0, warmup: 0 };
                    d.count++; d.limit += a.dailyLimit ?? 0;
                    if (a.setupPending) d.warmup++;
                    byDomain.set(dom, d);
                  }
                  const rows = Array.from(byDomain.entries()).sort((a, b) => b[1].limit - a[1].limit || a[0].localeCompare(b[0]));
                  if (rows.length === 0) return null;
                  return (
                    <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: C.textMuted }}>By domain · emails/day budget</p>
                      <div className="space-y-1.5">
                        {rows.map(([dom, d]) => (
                          <div key={dom} className="flex items-center justify-between gap-3 text-xs">
                            <span className="flex items-center gap-2 min-w-0">
                              <Mail size={11} className="shrink-0" style={{ color: "#7C3AED" }} />
                              <span className="font-medium truncate" style={{ color: C.textBody }}>{dom}</span>
                              <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{d.count} mailbox{d.count === 1 ? "" : "es"}</span>
                              {d.warmup > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: "color-mix(in srgb, #D97706 13%, transparent)", color: "#D97706" }}>{d.warmup} warming</span>}
                            </span>
                            <span className="font-mono tabular-nums shrink-0" style={{ color: C.textBody }}>{d.limit}/d</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
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
                                backgroundColor: a.setupPending ? "color-mix(in srgb, #D97706 13%, transparent)" : C.greenLight,
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
              <div className="rounded-2xl border p-8 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <p className="text-sm" style={{ color: C.textDim }}>No Aircall numbers configured</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {aircall.numbers.map(n => (
                  <Link key={n.id} href={`/accounts/aircall/${n.id}`} className="rounded-2xl border overflow-hidden card-lift block hover:shadow-md transition-shadow" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: "3px solid #F97316", boxShadow: "0 4px 16px rgba(249,115,22,0.06)" }}>
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
                          backgroundColor: n.is_active ? C.greenLight : "color-mix(in srgb, #D97706 13%, transparent)",
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
          <div className="rounded-2xl border mb-5 px-4 py-3 flex items-center gap-4 flex-wrap" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
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
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
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
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
                style={{ backgroundColor: historySeller === "all" ? C.card : "transparent", color: historySeller === "all" ? gold : C.textMuted }}>
                All Sellers
              </button>
              {sellers.map(s => (
                <button key={s.id} onClick={() => setHistorySeller(s.id)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
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
            <EmptyState
              icon={Calendar}
              title="No usage data for this period"
              description="Adjust the date, channel, or seller filter — or wait for the next dispatch tick to populate today's usage."
            />
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
                  <div key={date} className="rounded-2xl border overflow-hidden card-shadow" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                    <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{displayDate}</span>
                        {isToday && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>Today</span>}
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
                              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
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
                                <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
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

      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); router.refresh(); }}
          onPickEmail={() => setShowPoolManager(true)}
          onPickCalls={() => setShowAircallManager(true)}
          isAdmin={isAdmin}
          currentBioId={authUser?.companyBioId ?? null}
        />
      )}
      {reconnectTarget && (
        <AddAccountModal
          existingSeller={reconnectTarget}
          onClose={() => setReconnectTarget(null)}
          onSuccess={() => { setReconnectTarget(null); router.refresh(); }}
          onPickEmail={() => { /* no-op in reconnect */ }}
          onPickCalls={() => { /* no-op in reconnect */ }}
          isAdmin={isAdmin}
          currentBioId={authUser?.companyBioId ?? null}
        />
      )}
      {editTarget && <EditAccountModal seller={editTarget} onClose={() => setEditTarget(null)} onSuccess={() => { setEditTarget(null); router.refresh(); }} />}
      {linkTarget && <LinkUnipileModal seller={linkTarget} onClose={() => setLinkTarget(null)} onSuccess={() => { setLinkTarget(null); router.refresh(); }} />}
      {deleteTarget && <DeleteModal name={deleteTarget.name} onConfirm={handleDelete} onClose={() => setDeleteTarget(null)} loading={deleting} />}
      {connectTelegramTarget && (
        <ConnectTelegramModal
          seller={connectTelegramTarget}
          onClose={() => setConnectTelegramTarget(null)}
          onSuccess={() => { setConnectTelegramTarget(null); router.refresh(); }}
        />
      )}
      <EmailPoolManager open={showPoolManager} onClose={() => setShowPoolManager(false)} />
      <AircallPoolManager open={showAircallManager} onClose={() => setShowAircallManager(false)} />
    </div>
  );
}
