"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ChevronRight, Mail, CheckCircle2, User, Lock } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const inputStyle = {
  backgroundColor: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#f8fafc",
};
const inputFocus = {
  borderColor: "color-mix(in srgb, #b79832 50%, transparent)",
  backgroundColor: "color-mix(in srgb, #b79832 4%, transparent)",
  boxShadow: "0 0 0 4px color-mix(in srgb, #b79832 12%, transparent)",
};
const inputBlur = {
  borderColor: "rgba(255,255,255,0.08)",
  backgroundColor: "rgba(255,255,255,0.04)",
  boxShadow: "none",
};

export default function SignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const passwordMismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = displayName.trim() && email && password.length >= 6 && confirm && !passwordMismatch;

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      // Check email uniqueness before creating
      const check = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const { exists } = await check.json();
      if (exists) {
        setError("An account with this email already exists.");
        setLoading(false);
        return;
      }

      const supabase = getSupabaseBrowser();
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName.trim(), role: "client" },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      // Supabase returns identities:[] when email already exists but confirmation is enabled
      if (data.user && data.user.identities?.length === 0) {
        setError("An account with this email already exists.");
        return;
      }

      if (data.user) {
        const signupRes = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: data.user.id, email, role: "client" }),
        }).then(r => r.json()).catch(() => ({}));

        if (!data.session) {
          setDone(true);
        } else {
          // If domain matched an existing workspace, go straight to dashboard.
          // Otherwise, onboarding wizard for new companies.
          if (signupRes?.companyBioId) router.push("/");
          else router.push("/onboarding");
          router.refresh();
        }
      }
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "#04070d", fontFamily: "var(--font-inter)" }}>

      {/* LEFT PANEL */}
      <div className="hidden lg:flex flex-col w-[58%] relative overflow-hidden" style={{ backgroundColor: "#04070d" }}>
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(color-mix(in srgb, #b79832 4%, transparent) 1px, transparent 1px),
                            linear-gradient(90deg, color-mix(in srgb, #b79832 4%, transparent) 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
        }} />
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full pointer-events-none" style={{
          background: "radial-gradient(circle, color-mix(in srgb, #b79832 10%, transparent) 0%, transparent 65%)",
        }} />
        <div className="absolute -bottom-48 right-0 w-[500px] h-[500px] rounded-full pointer-events-none" style={{
          background: "radial-gradient(circle, rgba(26,127,116,0.08) 0%, transparent 65%)",
        }} />
        <div className="relative z-10 flex flex-col h-full px-14 py-12">
          <div className="flex items-center gap-3">
            <img src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png" alt="SWL Consulting" className="h-8 w-auto object-contain" style={{ filter: "brightness(0) invert(1)" }} />
          </div>
          <div className="flex-1 flex flex-col justify-center max-w-2xl">
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full border w-fit"
              style={{ borderColor: "color-mix(in srgb, #b79832 30%, transparent)", backgroundColor: "color-mix(in srgb, #b79832 7%, transparent)" }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#b79832" }} />
              <span className="text-xs font-medium tracking-widest uppercase" style={{ color: "#b79832" }}>Empezar ahora</span>
            </div>
            <h1 className="text-6xl font-bold leading-[1.1] mb-6" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)", letterSpacing: "-0.02em" }}>
              Automatizá tu equipo{" "}
              <span style={{ color: "#b79832" }}>de ventas.</span>
            </h1>
            <p className="text-lg leading-relaxed mb-10" style={{ color: "#d9dee2", opacity: 0.7 }}>
              Lead generation, outreach multicanal y gestión de campañas. Todo en un lugar, potenciado por IA.
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs" style={{ color: "rgba(217,222,226,0.3)" }}>
            <span>© 2026 SWL Consulting</span>
            <span className="mx-1">·</span>
            <span>swlconsulting.com</span>
          </div>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-px" style={{
          background: "linear-gradient(to bottom, transparent, color-mix(in srgb, #b79832 15%, transparent) 30%, color-mix(in srgb, #b79832 15%, transparent) 70%, transparent)",
        }} />
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 flex items-center justify-center p-8 relative" style={{ backgroundColor: "#06090f" }}>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 pointer-events-none" style={{
          background: "radial-gradient(circle, color-mix(in srgb, #b79832 4%, transparent) 0%, transparent 70%)",
        }} />

        <div className="w-full max-w-md relative z-10">
          {done ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
                style={{ backgroundColor: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
                <CheckCircle2 size={32} style={{ color: "#22C55E" }} />
              </div>
              <h2 className="text-2xl font-bold mb-2" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)" }}>Check your email</h2>
              <p className="text-sm leading-relaxed mb-6" style={{ color: "rgba(217,222,226,0.6)" }}>
                We sent a confirmation link to <strong style={{ color: "#f8fafc" }}>{email}</strong>. Click it to activate your account.
              </p>
              <a href="/login" className="text-xs font-semibold hover:underline" style={{ color: "#b79832" }}>
                Back to login →
              </a>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold mb-1" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)", letterSpacing: "-0.01em" }}>
                  Create account
                </h2>
                <p className="text-sm" style={{ color: "rgba(217,222,226,0.5)" }}>
                  Start using GrowthAI in minutes
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">

                {/* Name */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>Name</p>
                  <div className="relative">
                    <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(217,222,226,0.3)" }} />
                    <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                      placeholder="Your name" required
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                      style={inputStyle}
                      onFocus={e => Object.assign(e.currentTarget.style, inputFocus)}
                      onBlur={e => Object.assign(e.currentTarget.style, inputBlur)} />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>Email</p>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(217,222,226,0.3)" }} />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com" autoComplete="email" required
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                      style={inputStyle}
                      onFocus={e => Object.assign(e.currentTarget.style, inputFocus)}
                      onBlur={e => Object.assign(e.currentTarget.style, inputBlur)} />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>Password</p>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(217,222,226,0.3)" }} />
                    <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="At least 6 characters" autoComplete="new-password" minLength={6} required
                      className="w-full pl-10 pr-4 py-3 pr-11 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                      style={inputStyle}
                      onFocus={e => Object.assign(e.currentTarget.style, inputFocus)}
                      onBlur={e => Object.assign(e.currentTarget.style, inputBlur)} />
                    <button type="button" onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: "rgba(217,222,226,0.3)" }}>
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {/* Confirm password */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>Confirm password</p>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(217,222,226,0.3)" }} />
                    <input type={showConfirm ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)}
                      placeholder="Repeat your password" autoComplete="new-password" minLength={6} required
                      className="w-full pl-10 pr-11 py-3 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                      style={{
                        ...inputStyle,
                        borderColor: passwordMismatch ? "rgba(220,38,38,0.5)" : inputStyle.border?.toString(),
                      }}
                      onFocus={e => !passwordMismatch && Object.assign(e.currentTarget.style, inputFocus)}
                      onBlur={e => !passwordMismatch && Object.assign(e.currentTarget.style, inputBlur)} />
                    <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: "rgba(217,222,226,0.3)" }}>
                      {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {passwordMismatch && (
                    <p className="text-[11px] mt-1.5" style={{ color: "#FCA5A5" }}>Passwords don&apos;t match</p>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 rounded-xl px-4 py-3"
                    style={{ backgroundColor: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)" }}>
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "#DC2626" }} />
                    <p className="text-xs" style={{ color: "#FCA5A5" }}>{error}</p>
                  </div>
                )}

                <button type="submit" disabled={loading || !canSubmit}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-40"
                  style={{ backgroundColor: "#b79832", color: "#04070d" }}>
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      Creating account…
                    </span>
                  ) : (
                    <>Create account <ChevronRight size={15} /></>
                  )}
                </button>
              </form>

              <p className="text-center text-xs mt-6" style={{ color: "rgba(217,222,226,0.4)" }}>
                Already have an account?{" "}
                <a href="/login" className="font-semibold hover:underline" style={{ color: "#b79832" }}>Sign in</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
