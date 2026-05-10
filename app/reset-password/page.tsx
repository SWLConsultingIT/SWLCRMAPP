"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, ChevronRight, CheckCircle2, ArrowLeft } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Two flows live on this page:
  //   "code"     — primary post-2026-05-10. User came from /forgot-password,
  //                types the 6-digit OTP that arrived in their email,
  //                then sets the new password.
  //   "session"  — fallback. User clicked a legacy magic-link in an invite
  //                or admin-issued recovery email and arrived already
  //                authenticated. Just collect the new password.
  const [mode, setMode] = useState<"code" | "session" | "loading">("loading");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // If Supabase placed a recovery session in the URL hash (legacy link flow),
    // use it. Otherwise fall back to the code-entry UI.
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then((res: { data: { session: unknown } }) => {
      setMode(res.data.session ? "session" : "code");
    });
  }, []);

  useEffect(() => {
    if (mode === "code") codeInputRef.current?.focus();
  }, [mode]);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (mode === "code") {
      if (!email.trim()) { setError("Enter your email"); return; }
      if (code.replace(/\s/g, "").length < 6) { setError("Enter the 6-digit code from your email"); return; }
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowser();

      if (mode === "code") {
        const { error: otpError } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code.replace(/\s/g, ""),
          type: "recovery",
        });
        if (otpError) {
          setError(otpError.message.toLowerCase().includes("expired")
            ? "Code expired. Request a new one from Forgot password."
            : "Invalid code. Double-check the 6 digits we emailed you.");
          return;
        }
      }

      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) { setError(authError.message); return; }

      setDone(true);
      setTimeout(() => { router.push("/login"); router.refresh(); }, 1500);
    } finally {
      setLoading(false);
    }
  }

  const inputBaseStyle = {
    backgroundColor: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#f8fafc",
  } as const;

  const focusFx = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "color-mix(in srgb, #b79832 50%, transparent)";
    e.currentTarget.style.backgroundColor = "color-mix(in srgb, #b79832 4%, transparent)";
    e.currentTarget.style.boxShadow = "0 0 0 4px color-mix(in srgb, #b79832 12%, transparent)";
  };
  const blurFx = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
    e.currentTarget.style.boxShadow = "none";
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ backgroundColor: "#04070d", fontFamily: "var(--font-inter)" }}>
      <div className="absolute top-0 left-0 w-full h-full" style={{
        backgroundImage: `linear-gradient(color-mix(in srgb, #b79832 4%, transparent) 1px, transparent 1px),
                          linear-gradient(90deg, color-mix(in srgb, #b79832 4%, transparent) 1px, transparent 1px)`,
        backgroundSize: "56px 56px",
      }} />

      <div className="w-full max-w-md relative z-10">
        <a href="/login" className="flex items-center gap-1.5 text-xs mb-8 hover:opacity-80 transition-opacity" style={{ color: "rgba(217,222,226,0.5)" }}>
          <ArrowLeft size={13} /> Back to login
        </a>

        {done ? (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
              <CheckCircle2 size={32} style={{ color: "#22C55E" }} />
            </div>
            <h2 className="text-2xl font-bold mb-2" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)" }}>Password updated</h2>
            <p className="text-sm" style={{ color: "rgba(217,222,226,0.6)" }}>Redirecting to login…</p>
          </div>
        ) : mode === "loading" ? (
          <div className="flex justify-center py-12">
            <span className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#b79832", borderTopColor: "transparent" }} />
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-1" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)", letterSpacing: "-0.01em" }}>
                {mode === "code" ? "Enter your code" : "New password"}
              </h2>
              <p className="text-sm" style={{ color: "rgba(217,222,226,0.5)" }}>
                {mode === "code"
                  ? "Paste the 6-digit code we emailed you and choose a new password."
                  : "Choose a strong password for your account."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {mode === "code" && (
                <>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>Email</p>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      autoComplete="email"
                      className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                      style={inputBaseStyle}
                      onFocus={focusFx}
                      onBlur={blurFx}
                    />
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>6-digit code</p>
                    <input
                      ref={codeInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="\d*"
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      maxLength={6}
                      className="w-full px-4 py-3 rounded-xl text-lg font-mono tracking-[0.4em] text-center outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                      style={inputBaseStyle}
                      onFocus={focusFx}
                      onBlur={blurFx}
                    />
                  </div>
                </>
              )}

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>New password</p>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full px-4 py-3 pr-11 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                    style={inputBaseStyle}
                    autoComplete="new-password"
                    minLength={6}
                    autoFocus={mode === "session"}
                    onFocus={focusFx}
                    onBlur={blurFx}
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-100" style={{ color: "#b79832", zIndex: 10 }}>
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
                  style={inputBaseStyle}
                  autoComplete="new-password"
                  minLength={6}
                  onFocus={focusFx}
                  onBlur={blurFx}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ backgroundColor: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)" }}>
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "#DC2626" }} />
                  <p className="text-xs" style={{ color: "#FCA5A5" }}>{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading || !password || !confirm || (mode === "code" && (!email || code.length < 6))}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-40"
                style={{ backgroundColor: "#b79832", color: "#04070d" }}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    Saving…
                  </span>
                ) : (
                  <>Update password<ChevronRight size={15} /></>
                )}
              </button>

              {mode === "code" && (
                <p className="text-xs text-center pt-2" style={{ color: "rgba(217,222,226,0.4)" }}>
                  Didn&apos;t get the code? <a href="/forgot-password" className="hover:underline" style={{ color: "#b79832" }}>Send another</a>
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: "#04070d" }} />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
