"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ChevronRight } from "lucide-react";

const USERS = [
  { id: "admin",     label: "Admin",            initials: "AD", color: "#b79832" },
  { id: "francisco", label: "Francisco Fontana", initials: "FF", color: "#1A7F74" },
  { id: "sales",     label: "Sales Team",        initials: "ST", color: "#2563EB" },
];

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser]       = useState("Admin");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!res.ok) {
        setError("Incorrect password. Try again.");
      } else {
        router.push("/");
        router.refresh();
      }
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
          backgroundImage: `linear-gradient(rgba(183,152,50,0.04) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(183,152,50,0.04) 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
        }} />

        {/* Radial glow top-left */}
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full pointer-events-none" style={{
          background: "radial-gradient(circle, rgba(183,152,50,0.10) 0%, transparent 65%)",
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
          <div className="flex-1 flex flex-col justify-center max-w-md">
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full border w-fit"
              style={{ borderColor: "rgba(183,152,50,0.3)", backgroundColor: "rgba(183,152,50,0.07)" }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#b79832" }} />
              <span className="text-xs font-medium tracking-widest uppercase" style={{ color: "#b79832" }}>
                GrowthAI Sales Engine
              </span>
            </div>

            <h1 className="text-5xl font-bold leading-tight mb-6" style={{
              color: "#f8fafc",
              fontFamily: "var(--font-outfit)",
              letterSpacing: "-0.02em",
            }}>
              Negocios<br />
              más grandes.<br />
              <span style={{ color: "#b79832" }}>Equipos más<br />fuertes.</span>
            </h1>

            <p className="text-base leading-relaxed mb-10" style={{ color: "#d9dee2", opacity: 0.7 }}>
              Ideas creadas por personas.<br />Sistemas potenciados por IA.
            </p>

            {/* Stats */}
            <div className="flex items-center gap-8">
              {[
                { value: "360°", label: "Consultoría integral" },
                { value: "AI", label: "Automatización" },
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
            <span>© 2025 SWL Consulting</span>
            <span className="mx-1">·</span>
            <span>swlconsulting.com</span>
          </div>
        </div>

        {/* Vertical separator with fade */}
        <div className="absolute right-0 top-0 bottom-0 w-px" style={{
          background: "linear-gradient(to bottom, transparent, rgba(183,152,50,0.15) 30%, rgba(183,152,50,0.15) 70%, transparent)",
        }} />
      </div>

      {/* ═══ RIGHT PANEL — Login form ═══ */}
      <div className="flex-1 flex items-center justify-center p-8 relative" style={{ backgroundColor: "#06090f" }}>

        {/* Subtle glow behind card */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 pointer-events-none" style={{
          background: "radial-gradient(circle, rgba(183,152,50,0.04) 0%, transparent 70%)",
        }} />

        <div className="w-full max-w-sm relative z-10">

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
              Bienvenido de vuelta
            </h2>
            <p className="text-sm" style={{ color: "rgba(217,222,226,0.5)" }}>
              Ingresá a tu panel de GrowthAI
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* User selector */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "rgba(217,222,226,0.4)" }}>
                Usuario
              </p>
              <div className="space-y-2">
                {USERS.map((u) => {
                  const isActive = user === u.label;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setUser(u.label)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left"
                      style={{
                        backgroundColor: isActive ? "rgba(183,152,50,0.08)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${isActive ? "rgba(183,152,50,0.4)" : "rgba(255,255,255,0.07)"}`,
                      }}
                    >
                      {/* Avatar */}
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 transition-all"
                        style={{
                          backgroundColor: isActive ? u.color : "rgba(255,255,255,0.06)",
                          color: isActive ? "#04070d" : "rgba(217,222,226,0.5)",
                        }}>
                        {u.initials}
                      </div>
                      <span className="text-sm font-medium transition-colors" style={{
                        color: isActive ? "#f8fafc" : "rgba(217,222,226,0.5)",
                      }}>
                        {u.label}
                      </span>
                      {isActive && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#b79832" }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Password */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(217,222,226,0.4)" }}>
                Contraseña
              </p>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-11 rounded-xl text-sm outline-none transition-all"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#f8fafc",
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = "rgba(183,152,50,0.5)";
                    e.currentTarget.style.backgroundColor = "rgba(183,152,50,0.04)";
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                  }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: "rgba(217,222,226,0.3)" }}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

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
              disabled={loading || !password}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
              style={{
                backgroundColor: "#b79832",
                color: "#04070d",
              }}
              onMouseEnter={e => !loading && password && (e.currentTarget.style.backgroundColor = "#c9aa38")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#b79832")}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Ingresando…
                </span>
              ) : (
                <>
                  Ingresar
                  <ChevronRight size={15} />
                </>
              )}
            </button>
          </form>

          {/* Bottom */}
          <p className="text-center text-xs mt-8" style={{ color: "rgba(217,222,226,0.2)" }}>
            Plataforma interna · SWL Consulting
          </p>
        </div>
      </div>
    </div>
  );
}
