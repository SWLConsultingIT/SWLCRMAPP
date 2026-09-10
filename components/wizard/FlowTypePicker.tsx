"use client";

// Wizard pre-step: ask the seller whether this campaign uses the legacy
// "Generic" path (one AI-written template per step, mechanical
// {{first_name}} substitution, $0 extra per lead) or the new "Tailored"
// path (per-lead Haiku-generated hook + fit using publications / news /
// tech stack, ~$0.001/lead). The picker fronts the wizard — every other
// step branches off this choice.
//
// Generic stays exactly as the wizard works today. Tailored unlocks the
// new Step 3 review (signal coverage banner + samples + tag grid).

import { Sparkles, Zap, ArrowLeft, Users, Clock } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { C } from "@/lib/design";

const gold = C.gold;

type Props = {
  profileName?: string | null;
  leadsCount: number;
  onChoose: (flowType: "generic" | "tailored") => void;
  onBack?: () => void;
};

export default function FlowTypePicker({ profileName, leadsCount, onChoose, onBack }: Props) {
  const { t } = useLocale();
  return (
    <div className="max-w-5xl mx-auto">
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold mb-6 hover:opacity-70 transition-opacity"
          style={{ color: C.textMuted }}
        >
          <ArrowLeft size={12} />
          {t("ftp.back")}
        </button>
      )}

      <div className="text-center mb-10">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: gold }}>
          {t("ftp.newFlow")}{profileName ? ` · ${profileName}` : ""}
        </p>
        <h1 className="text-3xl font-bold mb-3" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
          {t("ftp.howWrite")}
        </h1>
        <p className="text-sm max-w-2xl mx-auto" style={{ color: C.textBody }}>
          {t("ftp.intro")} {`{{first_name}}`} {t("ftp.introTail")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {/* GENERIC */}
        <button
          onClick={() => onChoose("generic")}
          className="text-left rounded-2xl border p-6 transition-all hover:shadow-lg group"
          style={{
            backgroundColor: C.card,
            borderColor: C.border,
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `color-mix(in srgb, ${C.textMuted} 12%, transparent)` }}>
              <Zap size={16} style={{ color: C.textBody }} />
            </div>
            <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>{t("ftp.generic")}</h2>
            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ml-auto"
              style={{ backgroundColor: `color-mix(in srgb, ${C.textMuted} 12%, transparent)`, color: C.textMuted }}>
              {t("ftp.standard")}
            </span>
          </div>

          <p className="text-[13px] leading-relaxed mb-5" style={{ color: C.textBody }}>
            {t("ftp.genericBody")} ({`{{first_name}}`}, {`{{company_name}}`}{t("ftp.genericBodyTail")}
          </p>

          <div className="space-y-2.5 mb-6">
            <Feature icon={<Clock size={12} />} label={t("ftp.reviewTime")} value={t("ftp.instant")} />
            <Feature icon={<Users size={12} />} label={t("ftp.bestFor")} value={t("ftp.bestForGeneric")} />
          </div>

          <div className="text-xs font-bold py-2.5 rounded-lg text-center transition-opacity group-hover:opacity-90"
            style={{ backgroundColor: C.surface, color: C.textPrimary, border: `1px solid ${C.border}` }}>
            {t("ftp.useGeneric")}
          </div>
        </button>

        {/* TAILORED */}
        <button
          onClick={() => onChoose("tailored")}
          className="text-left rounded-2xl border p-6 transition-all hover:shadow-lg group relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 4%, ${C.card}) 100%)`,
            borderColor: `color-mix(in srgb, ${gold} 35%, ${C.border})`,
            boxShadow: `0 4px 16px -8px color-mix(in srgb, ${gold} 20%, transparent)`,
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))` }}>
              <Sparkles size={16} style={{ color: "#1A1A2E" }} />
            </div>
            <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>{t("ftp.tailored")}</h2>
            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ml-auto"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E" }}>
              {t("ftp.newBadge")}
            </span>
          </div>

          <p className="text-[13px] leading-relaxed mb-5" style={{ color: C.textBody }}>
            {t("ftp.tailoredBody")}
          </p>

          <div className="space-y-2.5 mb-6">
            <Feature icon={<Clock size={12} />} label={t("ftp.generationTime")} value={t("ftp.thirtySeconds")} />
            <Feature icon={<Users size={12} />} label={t("ftp.bestFor")} value={t("ftp.bestForTailored")} />
          </div>

          <div className="text-xs font-bold py-2.5 rounded-lg text-center transition-opacity group-hover:opacity-90"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E" }}>
            {t("ftp.useTailored")}
          </div>
        </button>
      </div>

      <p className="text-center text-[11px]" style={{ color: C.textMuted }}>
        {t("ftp.switchNote")}
      </p>
    </div>
  );
}

function Feature({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span style={{ color: C.textMuted }}>{icon}</span>
      <span style={{ color: C.textMuted }}>{label}:</span>
      <span className="font-semibold" style={{ color: C.textPrimary }}>{value}</span>
    </div>
  );
}
