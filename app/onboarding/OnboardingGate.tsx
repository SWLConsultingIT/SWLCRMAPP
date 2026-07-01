"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, ArrowRight, LogOut, Loader2 } from "lucide-react";
import OnboardingForm from "./OnboardingForm";
import { useLocale } from "@/lib/i18n";

// Gate shown to a logged-in user who has NO company assigned yet.
// Default = a friendly "pending assignment" waiting screen (most people here
// were invited and are waiting for an admin to assign them). An optional
// "Create my own company" path reveals the self-serve onboarding wizard for
// genuine new customers who signed up on their own.
export default function OnboardingGate({ displayName, email }: { displayName: string; email: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [creating, setCreating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (creating) return <OnboardingForm displayName={displayName} email={email} />;

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      try { localStorage.removeItem("swl-theme"); localStorage.removeItem("swl-locale"); } catch {}
    } catch { /* ignore */ }
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 relative" style={{ backgroundColor: "#04070d", fontFamily: "var(--font-inter)" }}>
      {/* Background grid + glow — same treatment as the onboarding wizard */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px),
                          linear-gradient(90deg, color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px)`,
        backgroundSize: "56px 56px",
      }} />
      <div className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full pointer-events-none" style={{
        background: "radial-gradient(circle, color-mix(in srgb, var(--brand-dark, #b79832) 8%, transparent) 0%, transparent 65%)",
      }} />

      <div className="relative z-10 w-full max-w-lg text-center">
        <img src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
          alt="SWL" className="h-7 mx-auto mb-8" style={{ filter: "brightness(0) invert(1)" }} />

        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ backgroundColor: "color-mix(in srgb, var(--brand-dark, #b79832) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--brand-dark, #b79832) 30%, transparent)" }}>
          <Clock size={24} style={{ color: "var(--brand-dark, #b79832)" }} />
        </div>

        <p className="text-[11px] font-bold uppercase tracking-[0.2em] mb-2" style={{ color: "var(--brand-dark, #b79832)" }}>
          {t("onboarding.accountPending")}
        </p>
        <h1 className="text-3xl font-bold" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)" }}>
          {t("onboarding.almostIn")}
        </h1>
        <p className="text-sm mt-3 leading-relaxed" style={{ color: "rgba(217,222,226,0.65)" }}>
          {t("onboarding.pendingDesc")}
        </p>
        <p className="text-xs mt-4" style={{ color: "rgba(217,222,226,0.4)" }}>
          {t("onboarding.signedInAs")} <span style={{ color: "rgba(217,222,226,0.7)" }}>{email}</span>
        </p>

        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={signOut}
            disabled={signingOut}
            className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-[opacity,background-color]"
            style={{ backgroundColor: "var(--brand-dark, #b79832)", color: "#04070d" }}
          >
            {signingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            {t("onboarding.signOut")}
          </button>

          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ color: "rgba(217,222,226,0.55)" }}
          >
            {t("onboarding.createOwn")} <ArrowRight size={12} />
          </button>
        </div>

        <p className="text-[11px] mt-8 max-w-sm mx-auto" style={{ color: "rgba(217,222,226,0.3)" }}>
          {t("onboarding.invitedHint")}
        </p>
      </div>
    </div>
  );
}
