"use client";

// Account Intelligence — the account-level counterpart to the Pre-Call Brief.
// Synthesises what the account is / why it matters / pain / angle / buying
// signals, and folds the existing AI Call Hooks in (CompanyHooksPanel, keyed to
// the representative lead). Neutral surfaces + gold emphasis, high density — no
// rainbow, no six separate cards.

import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Sparkles } from "lucide-react";
import CompanyHooksPanel from "@/components/CompanyHooksPanel";

const gold = "var(--brand, #c9a83a)";

type Fact = { label: string; text: string | null };

export default function AccountIntelligence({
  facts, signals, hookLeadId, companyName,
}: {
  facts: Fact[];               // What they do / Why it matters / Pain / Angle
  signals: string[];           // buying signals / why now
  hookLeadId: string | null;
  companyName: string;
}) {
  const { t } = useLocale();
  const shown = facts.filter(f => f.text && f.text.trim());

  return (
    <div className="rounded-2xl overflow-hidden mb-5 reveal"
      style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${gold} 5%, ${C.card}) 0%, ${C.card} 34%)`, border: `1px solid color-mix(in srgb, ${gold} 22%, ${C.border})`, boxShadow: C.shadow }}>
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-2">
        <div className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 65%, white))`, color: "#fff" }}>
          <Sparkles size={16} />
        </div>
        <span className="text-[13px] font-extrabold uppercase tracking-[0.1em]" style={{ color: C.textPrimary }}>{t("co.accountIntel")}</span>
        <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: gold, color: "#fff" }}>AI</span>
      </div>

      <div className="grid md:grid-cols-[1.15fr_1fr]">
        {/* left — synthesis */}
        <div className="px-5 pb-4 space-y-2.5">
          {shown.length > 0 ? shown.map((f, i) => (
            <div key={i}>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.1em] mb-0.5" style={{ color: i === 0 ? gold : C.textMuted }}>{f.label}</p>
              <p className="text-[13px] leading-relaxed" style={{ color: i === 0 ? C.textPrimary : C.textBody }}>{f.text}</p>
            </div>
          )) : (
            <p className="text-[12.5px]" style={{ color: C.textDim }}>{t("co.intelEmpty")}</p>
          )}
        </div>

        {/* right — signals + hooks */}
        <div className="px-5 pb-4 md:border-l md:pl-5 border-t md:border-t-0 pt-3 md:pt-4" style={{ borderColor: C.border }}>
          {signals.length > 0 && (
            <div className="mb-3">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.1em] mb-1.5" style={{ color: C.textMuted }}>{t("co.buyingSignals")}</p>
              <ul className="space-y-1">
                {signals.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-snug" style={{ color: C.textBody }}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: C.green }} /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <CompanyHooksPanel leadId={hookLeadId} companyName={companyName} />
        </div>
      </div>
    </div>
  );
}
