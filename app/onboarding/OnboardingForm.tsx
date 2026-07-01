"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Sparkles, Target, Loader2, ChevronRight, ChevronLeft, CheckCircle2 } from "lucide-react";
import { useLocale } from "@/lib/i18n";

type Step = 1 | 2 | 3;

export default function OnboardingForm({ displayName, email }: { displayName: string; email: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — basics
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [linkedin, setLinkedin] = useState("");

  // Step 2 — what you do
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [services, setServices] = useState("");
  const [differentiators, setDifferentiators] = useState("");

  // Step 3 — target
  const [targetMarket, setTargetMarket] = useState("");

  const canGoStep2 = companyName.trim().length > 0;
  const canSubmit = canGoStep2 && description.trim().length > 0;

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          website: website.trim() || null,
          tagline: tagline.trim() || null,
          industry: industry.trim() || null,
          description: description.trim(),
          value_proposition: valueProp.trim() || null,
          main_services: services.split(",").map(s => s.trim()).filter(Boolean),
          target_market: targetMarket.trim() || null,
          differentiators: differentiators.trim() || null,
          team_size: teamSize.trim() || null,
          location: location.trim() || null,
          linkedin_url: linkedin.trim() || null,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? t("onboarding.saveFailed"));
      }
      router.push("/");
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? t("onboarding.saveFailed"));
      setLoading(false);
    }
  }

  const StepHeader = ({ n, label, icon: Icon }: { n: number; label: string; icon: typeof Building2 }) => {
    const active = step === n;
    const done = step > n;
    return (
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-[opacity,transform,box-shadow,background-color,border-color]"
          style={{
            backgroundColor: done ? "#22C55E" : active ? "var(--brand-dark, #b79832)" : "rgba(255,255,255,0.08)",
            border: active ? "2px solid color-mix(in srgb, var(--brand-dark, #b79832) 40%, transparent)" : "none",
          }}>
          {done ? <CheckCircle2 size={14} color="#fff" /> : <Icon size={13} color={active ? "#04070d" : "rgba(255,255,255,0.4)"} />}
        </div>
        <div className="hidden sm:block">
          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: active ? "var(--brand-dark, #b79832)" : done ? "#22C55E" : "rgba(255,255,255,0.35)" }}>
            {t("onboarding.step", { n })}
          </p>
          <p className="text-xs font-semibold" style={{ color: active || done ? "#f8fafc" : "rgba(255,255,255,0.45)" }}>{label}</p>
        </div>
      </div>
    );
  };

  const inputStyle = {
    backgroundColor: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#f8fafc",
  };
  const inputCls = "w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-[opacity,transform,box-shadow,background-color,border-color]";

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ backgroundColor: "#04070d", fontFamily: "var(--font-inter)" }}>
      {/* Background grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px),
                          linear-gradient(90deg, color-mix(in srgb, var(--brand-dark, #b79832) 4%, transparent) 1px, transparent 1px)`,
        backgroundSize: "56px 56px",
      }} />
      <div className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full pointer-events-none" style={{
        background: "radial-gradient(circle, color-mix(in srgb, var(--brand-dark, #b79832) 8%, transparent) 0%, transparent 65%)",
      }} />

      <div className="relative z-10 w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <img src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
            alt="SWL" className="h-7 mx-auto mb-5" style={{ filter: "brightness(0) invert(1)" }} />
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] mb-2" style={{ color: "var(--brand-dark, #b79832)" }}>{t("onboarding.formWelcome", { name: displayName || email })}</p>
          <h1 className="text-3xl font-bold" style={{ color: "#f8fafc", fontFamily: "var(--font-outfit)" }}>
            {t("onboarding.setupTitle")}
          </h1>
          <p className="text-sm mt-2" style={{ color: "rgba(217,222,226,0.55)" }}>
            {t("onboarding.setupSubtitle")}
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-between mb-6 px-2">
          <StepHeader n={1} label={t("onboarding.formStep1")} icon={Building2} />
          <div className="flex-1 h-px mx-2" style={{ backgroundColor: step > 1 ? "#22C55E" : "rgba(255,255,255,0.1)" }} />
          <StepHeader n={2} label={t("onboarding.formStep2")} icon={Sparkles} />
          <div className="flex-1 h-px mx-2" style={{ backgroundColor: step > 2 ? "#22C55E" : "rgba(255,255,255,0.1)" }} />
          <StepHeader n={3} label={t("onboarding.formStep3")} icon={Target} />
        </div>

        {/* Card */}
        <div className="rounded-2xl p-5 space-y-4" style={{
          backgroundColor: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}>
          {step === 1 && (
            <>
              <Field label={t("onboarding.companyName")}>
                <input className={inputCls} style={inputStyle} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="SWL Consulting" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("onboarding.website")}>
                  <input className={inputCls} style={inputStyle} value={website} onChange={e => setWebsite(e.target.value)} placeholder="swlconsulting.com" />
                </Field>
                <Field label={t("onboarding.industry")}>
                  <input className={inputCls} style={inputStyle} value={industry} onChange={e => setIndustry(e.target.value)} placeholder="Business Consulting" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("onboarding.teamSize")}>
                  <input className={inputCls} style={inputStyle} value={teamSize} onChange={e => setTeamSize(e.target.value)} placeholder={t("onboarding.teamSizePh")} />
                </Field>
                <Field label={t("onboarding.location")}>
                  <input className={inputCls} style={inputStyle} value={location} onChange={e => setLocation(e.target.value)} placeholder="Buenos Aires, AR" />
                </Field>
              </div>
              <Field label={t("onboarding.linkedin")}>
                <input className={inputCls} style={inputStyle} value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="linkedin.com/company/swl-consulting" />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label={t("onboarding.tagline")}>
                <input className={inputCls} style={inputStyle} value={tagline} onChange={e => setTagline(e.target.value)} placeholder={t("onboarding.taglinePh")} />
              </Field>
              <Field label={t("onboarding.whatYouDo")}>
                <textarea className={inputCls} style={inputStyle} rows={3} value={description} onChange={e => setDescription(e.target.value)}
                  placeholder={t("onboarding.whatYouDoPh")} />
              </Field>
              <Field label={t("onboarding.valueProp")}>
                <textarea className={inputCls} style={inputStyle} rows={2} value={valueProp} onChange={e => setValueProp(e.target.value)}
                  placeholder={t("onboarding.valuePropPh")} />
              </Field>
              <Field label={t("onboarding.services")}>
                <input className={inputCls} style={inputStyle} value={services} onChange={e => setServices(e.target.value)}
                  placeholder={t("onboarding.servicesPh")} />
              </Field>
              <Field label={t("onboarding.differentiators")}>
                <textarea className={inputCls} style={inputStyle} rows={2} value={differentiators} onChange={e => setDifferentiators(e.target.value)}
                  placeholder={t("onboarding.differentiatorsPh")} />
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <Field label={t("onboarding.targetMarket")}>
                <textarea className={inputCls} style={inputStyle} rows={4} value={targetMarket} onChange={e => setTargetMarket(e.target.value)}
                  placeholder={t("onboarding.targetMarketPh")} />
              </Field>
              <div className="rounded-xl px-4 py-3 mt-4 text-[11px] leading-relaxed"
                style={{ backgroundColor: "color-mix(in srgb, var(--brand-dark, #b79832) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--brand-dark, #b79832) 15%, transparent)", color: "rgba(217,222,226,0.7)" }}>
                {t("onboarding.refineHint")}
              </div>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 mt-3"
              style={{ backgroundColor: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)" }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "#DC2626" }} />
              <p className="text-xs" style={{ color: "color-mix(in srgb, #DC2626 34%, transparent)" }}>{error}</p>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between mt-6">
          {step > 1 ? (
            <button onClick={() => setStep((step - 1) as Step)} disabled={loading}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg transition-opacity hover:opacity-80"
              style={{ color: "rgba(217,222,226,0.6)" }}>
              <ChevronLeft size={14} /> {t("onboarding.back")}
            </button>
          ) : <div />}

          {step < 3 ? (
            <button onClick={() => setStep((step + 1) as Step)} disabled={step === 1 ? !canGoStep2 : !description.trim()}
              className="flex items-center gap-1.5 text-sm font-semibold px-5 py-2.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: "var(--brand-dark, #b79832)", color: "#04070d" }}>
              {t("onboarding.continue")} <ChevronRight size={14} />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={!canSubmit || loading}
              className="flex items-center gap-1.5 text-sm font-semibold px-5 py-2.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: "var(--brand-dark, #b79832)", color: "#04070d" }}>
              {loading
                ? <><Loader2 size={14} className="animate-spin" /> {t("onboarding.saving")}</>
                : <>{t("onboarding.finish")} <CheckCircle2 size={14} /></>}
            </button>
          )}
        </div>

        <p className="text-center text-[10px] mt-6" style={{ color: "rgba(217,222,226,0.25)" }}>
          {t("onboarding.footer")}
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: "rgba(217,222,226,0.45)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
