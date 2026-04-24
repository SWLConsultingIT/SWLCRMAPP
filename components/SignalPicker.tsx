"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { Sparkles, Check, ChevronDown } from "lucide-react";

// Small picker: click enrichment signals you want the AI to emphasize in the messages
// (e.g. Pathway's rfa_rating, rfa_trade_debtors, ch_if_signal). Selection is passed through
// to /api/campaigns/generate-field and injected into the prompt as "EMPHASIZE these signals".

type Enrichment = Record<string, unknown> | null | undefined;

const LABELS: Record<string, string> = {
  vertical: "Vertical",
  rfa_rating: "Credit Rating",
  rfa_credit_score: "Credit Score",
  rfa_trade_debtors: "Trade Debtors",
  rfa_working_capital: "Working Capital",
  rfa_net_worth: "Net Worth",
  rfa_turnover_est: "Turnover",
  rfa_growth_score: "Growth Score",
  rfa_tangible_assets: "Tangible Assets",
  rfa_ccj_value: "CCJ Value",
  rfa_previous_rating: "Previous Rating",
  rfa_credit_limit: "Credit Limit",
  rfa_liquidity_ratio: "Liquidity Ratio",
  rfa_employees: "Employees (RFA)",
  ch_if_signal: "IF Signal",
  ch_if_lender_name: "Current Lender",
  ch_newest_charge_age_months: "Charge Age (mo)",
  ch_accounts_overdue: "Accounts Overdue",
  ch_total_charges: "Total Charges",
  date_of_creation: "Incorporated",
  Reason: "Qualification Reason",
};

// Preferred order — the 12-or-so fields Pathway uses most.
const PREFERRED = [
  "rfa_rating", "rfa_credit_score", "rfa_trade_debtors", "rfa_working_capital",
  "rfa_net_worth", "rfa_turnover_est", "rfa_growth_score", "rfa_ccj_value",
  "ch_if_signal", "ch_if_lender_name", "ch_newest_charge_age_months", "vertical",
];

function prettyLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  return key.replace(/^rfa_|^ch_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function shortValue(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length > 30 ? s.slice(0, 28) + "…" : s;
}

// Keys that are internal / not useful as AI signals.
const META_KEYS = new Set([
  "source_file", "ZI Person ID", "ZoomInfo ID", "Valid Date", "Last Updated",
  "Position Start", "In Role Since", "EU",
]);

export default function SignalPicker({
  enrichment, selected, onChange,
}: {
  enrichment?: Enrichment;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const data = (enrichment && typeof enrichment === "object") ? (enrichment as Record<string, unknown>) : null;
  if (!data) return null;

  const present = (k: string) => {
    if (META_KEYS.has(k)) return false;
    const v = data[k];
    if (v == null) return false;
    const s = String(v).trim();
    return s.length > 0 && s !== "—" && s !== ".";
  };

  // Preferred keys that are present go first; then any other non-meta key.
  const preferredVisible = PREFERRED.filter(present);
  const extras = Object.keys(data)
    .filter(k => !PREFERRED.includes(k) && present(k))
    .sort();
  const keys = [...preferredVisible, ...extras];
  if (keys.length === 0) return null;

  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]);
  };

  const gold = "var(--brand, #c9a83a)";

  // Start collapsed by default — signals are optional, most users skip them.
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50"
      >
        <Sparkles size={13} style={{ color: gold }} />
        <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: C.textPrimary }}>
          Personalized Signals
        </h4>
        <span className="text-[10px]" style={{ color: C.textMuted }}>
          (optional — tick signals to reference in the copy)
        </span>
        {selected.length > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
            {selected.length} selected
          </span>
        )}
        <div className="flex-1" />
        <ChevronDown
          size={14}
          style={{ color: C.textDim, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: C.border }}>
          <p className="text-[11px] mb-3 mt-3" style={{ color: C.textMuted }}>
            The AI will write the copy with placeholders like {"{{rfa_rating}}"} that the orchestrator replaces per lead at send time — same as {"{{first_name}}"}.
          </p>
          <div className="flex flex-wrap gap-1.5">
        {keys.map(key => {
          const isSelected = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all"
              style={{
                backgroundColor: isSelected ? `color-mix(in srgb, ${gold} 14%, transparent)` : C.bg,
                color: isSelected ? gold : C.textBody,
                border: `1px solid ${isSelected ? gold : C.border}`,
              }}
            >
              {isSelected && <Check size={10} />}
              <span className="font-semibold">{prettyLabel(key)}</span>
              {data && (
                <span className="font-normal" style={{ color: isSelected ? gold : C.textDim, opacity: 0.85 }}>
                  {shortValue(data[key])}
                </span>
              )}
            </button>
          );
        })}
          </div>
        </div>
      )}
    </div>
  );
}
