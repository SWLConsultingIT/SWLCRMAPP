"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ChevronRight, Mail } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const REMEMBER_KEY = "crm_last_email";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  // Restore last email on mount
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(REMEMBER_KEY) : null;
    if (saved) setEmail(saved);
  }, []);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError("Incorrect credentials. Try again.");
        return;
      }
      // Clear legacy localStorage keys (older builds wrote here; cookie is the
      // SSR cache today). DO NOT touch document.documentElement.data-theme —
      // ThemeProvider's useEffect re-applies the attribute from the user's DB
      // theme on SIGNED_IN, but stripping it eagerly here leaves a visible
      // light-flash window between router.push("/") and that async fetch.
      try {
        localStorage.removeItem("swl-theme");
        localStorage.removeItem("swl-locale");
      } catch {}
      if (remember) localStorage.setItem(REMEMBER_KEY, email);
      else localStorage.removeItem(REMEMBER_KEY);
      router.push("/");
      router.refresh();
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "#04070d", fontFamily: "var(--font-inter)" }}>

      {/* ═══ LEFT PANEL — Brand ═══ */}
      <div className="hidden lg:flex flex-col w-[58%] relative overflow-hidden" style={{ backgroundColor: "#04070d" }}>

        {/* Subtle grid */}
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(color-mix(in srgb, #b79832 4%, transparent) 1px, transparent 1px),
                            linear-gradient(90deg, color-mix(in srgb, #b79832 4%, transparent) 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
        }} />

        {/* Radial glow top-left */}
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full pointer-events-none" style={{
          background: "radial-gradient(circle, color-mix(in srgb, #b79832 10%, transparent) 0%, transparent 65%)",
        }} />

        {/* Radial glow bottom-right */}
        <div className="absolute -bottom-48 right-0 w-[500px] h-[500px] rounded-full pointer-events-none" style={{
          background: "radial-gradient(circle, rgba(26,127,116,0.08) 0%, transparent 65%)",
        }} />

        <div className="relative z-10 flex flex-col h-full px-14 py-12">

          {/* Logo */}
          <div className="flex items-center gap-3">
            <img
              src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
              alt="SWL Consulting"
              className="h-8 w-auto object-contain"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </div>

          {/* Hero text */}
          <div className="flex-1 flex flex-col justify-center max-w-2xl">
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full border w-fit"
              style={{ borderColor: "color-mix(in srgb, #b79832 30%, transparent)", backgroundColor: "color-mix(in srgb, #b79832 7%, transparent)" }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#b79832" }} />
              <span className="text-xs font-medium tracking-widest uppercase" style={{ color: "#b79832" }}>
                GrowthAI Sales Engine
              </span>
            </div>

            <h1 className="text-6xl font-bold leading-[1.1] mb-6" style={{
              color: "#f8fafc",
              fontFamily: "var(--font-outfit)",
              letterSpacing: "-0.02em",
            }}>
              Bigger deals.{" "}
              <span style={{ color: "#b79832" }}>Stronger teams.</span>
            </h1>

            <p className="text-lg leading-relaxed mb-10" style={{ color: "#d9dee2", opacity: 0.7 }}>
              Human ideas. AI-powered systems.
            </p>

            {/* Stats */}
            <div className="flex items-center gap-8">
              {[
                { value: "360°", label: "Full consulting" },
                { value: "AI", label: "Automation" },
                { value: "SWL", label: "Consulting" },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-2xl font-bold" style={{ color: "#b79832", fontFamily: "var(--font-outfit)" }}>{s.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#d9dee2", opacity: 0.5 }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-1 text-xs" style={{ color: "rgba(217,222,226,0.3)" }}>
            <span>© 2026 SWL Consulting</span>
            <span className="mx-1">·</span>
            <span>swlconsulting.com</span>
          </div>
        </div>

        {/* Vertical separator with fade */}
        <div className="absolute right-0 top-0 bottom-0 w-px" style={{
          background: "linear-gradient(to bottom, transparent, color-mix(in srgb, #b79832 15%, transparent) 30%, color-mix(in srgb, #b79832 15%, transparent) 70%, transparent)",
        }} />
      </div>

      {/* ═══ RIGHT PANEL — Login form ═══ */}
      <div className="flex-1 flex items-center justify-center p-8 relative" style={{ backgroundColor: "#06090f" }}>

        {/* Subtle glow behind card */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 pointer-events-none" style={{
          background: "radial-gradient(circle, color-mix(in srgb, #b79832 4%, transparent) 0%, transparent 70%)",
        }} />

        <div className="w-full max-w-md relative z-10">

          {/* Mobile logo */}
          <div className="flex lg:hidden justify-center mb-8">
            <img
              src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
              alt="SWL Consulting"
              className="h-7 w-auto object-contain"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </div>

          {/* Header */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-1" style={{
              color: "#f8fafc",
              fontFamily: "var(--font-outfit)",
              letterSpacing: "-0.01em",
            }}>
              Welcome back
            </h2>
            <p className="text-sm" style={{ color: "rgba(217,222,226,0.5)" }}>
              Sign in to your GrowthAI dashboard
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Email */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>
                Email
              </p>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(217,222,226,0.3)" }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#f8fafc",
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = "color-mix(in srgb, #b79832 50%, transparent)";
                    e.currentTarget.style.backgroundColor = "color-mix(in srgb, #b79832 4%, transparent)";
                    e.currentTarget.style.boxShadow = "0 0 0 4px color-mix(in srgb, #b79832 12%, transparent)";
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>
                Password
              </p>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-11 rounded-xl text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#f8fafc",
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = "color-mix(in srgb, #b79832 50%, transparent)";
                    e.currentTarget.style.backgroundColor = "color-mix(in srgb, #b79832 4%, transparent)";
                    e.currentTarget.style.boxShadow = "0 0 0 4px color-mix(in srgb, #b79832 12%, transparent)";
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-100"
                  style={{ color: "#b79832", zIndex: 10 }}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
              <div className="relative flex items-center">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className="w-4 h-4 rounded flex items-center justify-center transition-[opacity,transform,box-shadow,background-color,border-color]"
                  style={{
                    backgroundColor: remember ? "#b79832" : "rgba(255,255,255,0.06)",
                    border: remember ? "1px solid #b79832" : "1px solid rgba(255,255,255,0.15)",
                  }}
                >
                  {remember && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1" stroke="#04070d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-xs" style={{ color: "rgba(217,222,226,0.5)" }}>Remember me</span>
            </label>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-xl px-4 py-3"
                style={{ backgroundColor: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)" }}>
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "#DC2626" }} />
                <p className="text-xs" style={{ color: "#FCA5A5" }}>{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !password || !email}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-40"
              style={{
                backgroundColor: "#b79832",
                color: "#04070d",
              }}
              onMouseEnter={e => !loading && password && email && (e.currentTarget.style.backgroundColor = "#c9aa38")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#b79832")}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Signing in…
                </span>
              ) : (
                <>
                  Sign in
                  <ChevronRight size={15} />
                </>
              )}
            </button>
          </form>

          {/* Bottom links */}
          <div className="flex items-center justify-between text-xs mt-6" style={{ color: "rgba(217,222,226,0.4)" }}>
            <a href="/forgot-password" className="hover:underline" style={{ color: "rgba(217,222,226,0.5)" }}>
              Forgot password
            </a>
            <a href="/signup" className="hover:underline font-semibold" style={{ color: "#b79832" }}>
              Create account →
            </a>
          </div>

          <p className="text-center text-xs mt-8" style={{ color: "rgba(217,222,226,0.2)" }}>
            Internal platform · SWL Consulting
          </p>
        </div>
      </div>
    </div>
  );
}
