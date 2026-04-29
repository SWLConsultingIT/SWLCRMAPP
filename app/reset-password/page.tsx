"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ChevronRight, CheckCircle2 } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [sessionOk, setSessionOk] = useState<boolean | null>(null);

  useEffect(() => {
    // When the user clicks the reset link, Supabase puts the session in the URL hash.
    // getSupabaseBrowser().auth.getSession() picks it up automatically.
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      setSessionOk(!!data.session);
    });
  }, []);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("Passwords don't match"); return; }
    setLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) setError(authError.message);
      else {
        setDone(true);
        setTimeout(() => { router.push("/login"); router.refresh(); }, 2000);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ backgroundColor: "#04070d", fontFamily: "var(--font-inter)" }}>
      <div className="absolute top-0 left-0 w-full h-full" style={{
        backgroundImage: `linear-gradient(color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px),
                          linear-gradient(90deg, color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px)`,
        backgroundSize: "56px 56px",
      }} />

      <div className="w-full max-w-md relative z-10">
        {done ? (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
              <CheckCircle2 size={32} style={{ color: "#22C55E" }} />
            </div>
            <h2 className="text-2xl font-bold mb-2" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)" }}>Password updated</h2>
            <p className="text-sm" style={{ color: "rgba(217,222,226,0.6)" }}>Redirecting to login…</p>
          </div>
        ) : sessionOk === false ? (
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)" }}>Invalid or expired link</h2>
            <p className="text-sm mb-6" style={{ color: "rgba(217,222,236,0.6)" }}>
              Request a new link from &quot;Forgot password&quot;.
            </p>
            <a href="/forgot-password" className="text-xs font-semibold hover:underline" style={{ color: "var(--brand-dark, #b79832)" }}>
              Request new link →
            </a>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-1" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)", letterSpacing: "-0.01em" }}>
                New password
              </h2>
              <p className="text-sm" style={{ color: "rgba(217,222,226,0.5)" }}>
                Choose a strong password for your account.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>New password</p>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full px-4 py-3 pr-11 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                    style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#f8fafc" }}
                    autoComplete="new-password"
                    minLength={6}
                    autoFocus
                    onFocus={e => {
                      e.currentTarget.style.borderColor = "color-mix(in srgb, var(--brand-dark, #b79832) 50%, transparent)";
                      e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent)";
                      e.currentTarget.style.boxShadow = "0 0 0 4px color-mix(in srgb, var(--brand-dark, #b79832) 12%, transparent)";
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                      e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-100" style={{ color: "var(--brand-dark, #b79832)", zIndex: 10 }}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>Confirm</p>
                <input
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                  style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#f8fafc" }}
                  autoComplete="new-password"
                  minLength={6}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--brand-dark, #b79832) 50%, transparent)";
                    e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent)";
                    e.currentTarget.style.boxShadow = "0 0 0 4px color-mix(in srgb, var(--brand-dark, #b79832) 12%, transparent)";
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ backgroundColor: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)" }}>
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "#DC2626" }} />
                  <p className="text-xs" style={{ color: "#FCA5A5" }}>{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading || !password || !confirm}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-40"
                style={{ backgroundColor: "var(--brand-dark, #b79832)", color: "#04070d" }}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    Saving…
                  </span>
                ) : (
                  <>Update password<ChevronRight size={15} /></>
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
