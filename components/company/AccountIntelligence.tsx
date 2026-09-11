"use client";

// Account Intelligence — real, account-specific signal only. "What they do" is
// a genuine company description; the actionable intelligence is the AI Call
// Hooks (viewer-locale, grounded in enrichment). Single-column adaptive layout:
// nothing reserves a permanent half-column, so an account with thin data reads
// compact instead of half-empty (Fran 2026-09-11).

import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Sparkles } from "lucide-react";
import CompanyHooksPanel from "@/components/CompanyHooksPanel";

const gold = "var(--brand, #c9a83a)";

type Fact = { label: string; text: string | null };

export default function AccountIntelligence({
  facts, signals, hookLeadId, companyName,
}: {
  facts: Fact[];
  signals: string[];
  hookLeadId: string | null;
  companyName: string;
}) {
  const { t } = useLocale();
  const shownFacts = facts.filter(f => f.text && f.text.trim());

  return (
    <div className="rounded-2xl overflow-hidden mb-5 reveal"
      style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${gold} 5%, ${C.card}) 0%, ${C.card} 40%)`, border: `1px solid color-mix(in srgb, ${gold} 22%, ${C.border})`, boxShadow: C.shadow }}>
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-2">
        <div className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 65%, white))`, color: "#fff" }}>
          <Sparkles size={16} />
        </div>
        <span className="text-[13px] font-extrabold uppercase tracking-[0.1em]" style={{ color: C.textPrimary }}>{t("co.accountIntel")}</span>
        <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: gold, color: "#fff" }}>AI</span>
      </div>

      <div className="px-5 pb-4 space-y-3">
        {/* What they do + any other real facts */}
        {shownFacts.map((f, i) => (
          <div key={i}>
            <p className="text-[9.5px] font-bold uppercase tracking-[0.1em] mb-0.5" style={{ color: gold }}>{f.label}</p>
            <p className="text-[13px] leading-relaxed" style={{ color: C.textPrimary }}>{f.text}</p>
          </div>
        ))}

        {/* Buying signals — real facts only */}
        {signals.length > 0 && (
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-[0.1em] mb-1.5" style={{ color: C.textMuted }}>{t("co.buyingSignals")}</p>
            <ul className="grid sm:grid-cols-2 gap-x-5 gap-y-1">
              {signals.map((s, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-snug" style={{ color: C.textBody }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: C.green }} /> {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AI Call Hooks — full width; renders its own compact generate state
            when empty (no reserved half-column). Returns null without a leadId. */}
        <CompanyHooksPanel leadId={hookLeadId} companyName={companyName} />

        {/* Nothing real to show at all — compact line, never a half-empty panel. */}
        {shownFacts.length === 0 && signals.length === 0 && !hookLeadId && (
          <p className="text-[12.5px]" style={{ color: C.textDim }}>{t("co.intelEmpty")}</p>
        )}
      </div>
    </div>
  );
}
