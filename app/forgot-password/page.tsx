"use client";

import { useState } from "react";
import { Mail, CheckCircle2, ChevronRight, ArrowLeft } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (authError) setError(authError.message);
      else setDone(true);
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
        <a href="/login" className="flex items-center gap-1.5 text-xs mb-8 hover:opacity-80 transition-opacity" style={{ color: "rgba(217,222,226,0.5)" }}>
          <ArrowLeft size={13} /> Back to login
        </a>

        {done ? (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
              <CheckCircle2 size={32} style={{ color: "#22C55E" }} />
            </div>
            <h2 className="text-2xl font-bold mb-2" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)" }}>Check your email</h2>
            <p className="text-sm leading-relaxed mb-6" style={{ color: "rgba(217,222,226,0.6)" }}>
              If an account exists for <strong style={{ color: "#f8fafc" }}>{email}</strong>, we sent a link to reset your password.
            </p>
            <a href="/login" className="text-xs font-semibold hover:underline" style={{ color: "var(--brand-dark, #b79832)" }}>
              Back to login
            </a>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-1" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)", letterSpacing: "-0.01em" }}>
                Forgot your password?
              </h2>
              <p className="text-sm" style={{ color: "rgba(217,222,226,0.5)" }}>
                Enter your email and we&apos;ll send you a reset link.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>Email</p>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(217,222,226,0.3)" }} />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email"
                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none"
                    style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#f8fafc" }} />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ backgroundColor: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)" }}>
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "#DC2626" }} />
                  <p className="text-xs" style={{ color: "#FCA5A5" }}>{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading || !email}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-40"
                style={{ backgroundColor: "var(--brand-dark, #b79832)", color: "#04070d" }}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    Sending…
                  </span>
                ) : (
                  <>Send link<ChevronRight size={15} /></>
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
