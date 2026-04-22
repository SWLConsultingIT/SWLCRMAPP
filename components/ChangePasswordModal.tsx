"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import { X, Shield, Eye, EyeOff, Loader2, CheckCircle, AlertTriangle } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  userEmail: string;
};

export default function ChangePasswordModal({ open, onClose, userEmail }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirm) {
      setError("New password and confirmation don't match");
      return;
    }
    if (currentPassword === newPassword) {
      setError("New password must be different from current");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowser();

    // Verify current password by re-authenticating
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: currentPassword });
    if (signInErr) {
      setError("Current password is incorrect");
      setLoading(false);
      return;
    }

    // Update to new password
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updateErr) {
      setError(updateErr.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
    setTimeout(() => {
      onClose();
      setSuccess(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    }, 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}>
      <div className="rounded-2xl border w-full max-w-md overflow-hidden"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${C.gold}15` }}>
              <Shield size={16} style={{ color: C.gold }} />
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>Change password</h2>
              <p className="text-[11px]" style={{ color: C.textMuted }}>Keep your account secure.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5">
            <X size={16} style={{ color: C.textMuted }} />
          </button>
        </div>

        {success ? (
          <div className="px-6 py-12 text-center">
            <CheckCircle size={36} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>Password updated</p>
            <p className="text-xs mt-1" style={{ color: C.textMuted }}>Your new password is now active.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border px-3 py-2"
                style={{ backgroundColor: C.redLight, borderColor: `${C.red}30` }}>
                <AlertTriangle size={13} style={{ color: C.red }} className="shrink-0 mt-0.5" />
                <p className="text-xs" style={{ color: C.red }}>{error}</p>
              </div>
            )}

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: C.textMuted }}>
                Current password
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                />
                <button type="button" onClick={() => setShowCurrent(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2">
                  {showCurrent ? <EyeOff size={14} style={{ color: C.textDim }} /> : <Eye size={14} style={{ color: C.textDim }} />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: C.textMuted }}>
                New password
              </label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                />
                <button type="button" onClick={() => setShowNew(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2">
                  {showNew ? <EyeOff size={14} style={{ color: C.textDim }} /> : <Eye size={14} style={{ color: C.textDim }} />}
                </button>
              </div>
              <p className="text-[10px] mt-1" style={{ color: C.textDim }}>At least 6 characters.</p>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: C.textMuted }}>
                Confirm new password
              </label>
              <input
                type={showNew ? "text" : "password"}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2 text-sm rounded-lg outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} disabled={loading}
                className="px-4 py-2 text-xs font-semibold rounded-lg transition-opacity hover:opacity-80"
                style={{ color: C.textMuted }}>
                Cancel
              </button>
              <button type="submit" disabled={loading || !currentPassword || !newPassword || !confirm}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${C.gold}, #e8c84a)`, color: "#1A1A2E" }}>
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
                Update password
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
