"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { Sparkles, Check, ChevronDown } from "lucide-react";

// Picker driven by company_bios.enrichment_schema (per-tenant).
// When schema is provided, fields visible in the picker (with their labels and grouping)
// are determined by the tenant's schema. When schema is absent, falls back to walking
// enrichment keys directly (legacy Pathway-flavoured behaviour).

type Enrichment = Record<string, unknown> | null | undefined;
type LeadRow = Record<string, unknown> | null | undefined;

export type SchemaEntry = {
  key: string;
  /** Optional: maps this signal to a top-level leads.<column> instead of leads.enrichment[key] */
  column?: string;
  label?: string;
  type?: string;
  category?: string;
  priority?: number;
  show_in_signals?: boolean;
  show_in_panel?: boolean;
  aliases?: string[];
  options?: string[];
};

// Legacy fallback labels (used when no schema is set on the tenant)
const LEGACY_LABELS: Record<string, string> = {
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

// Legacy preferred order (used when no schema is set)
const LEGACY_PREFERRED = [
  "rfa_rating", "rfa_credit_score", "rfa_trade_debtors", "rfa_working_capital",
  "rfa_net_worth", "rfa_turnover_est", "rfa_growth_score", "rfa_ccj_value",
  "ch_if_signal", "ch_if_lender_name", "ch_newest_charge_age_months", "vertical",
];

const META_KEYS = new Set([
  "source_file", "ZI Person ID", "ZoomInfo ID", "Valid Date", "Last Updated",
  "Position Start", "In Role Since", "EU",
]);

function prettyLabel(key: string): string {
  if (LEGACY_LABELS[key]) return LEGACY_LABELS[key];
  return key.replace(/^rfa_|^ch_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function shortValue(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length > 30 ? s.slice(0, 28) + "…" : s;
}

function categoryLabel(cat: string | undefined): string {
  if (!cat) return "Other";
  return cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function SignalPicker({
  enrichment, lead, selected, onChange, schema,
}: {
  enrichment?: Enrichment;
  /** Full lead row — needed when schema entries map to top-level columns (entry.column). */
  lead?: LeadRow;
  selected: string[];
  onChange: (next: string[]) => void;
  /** Per-tenant enrichment schema. When present, drives visibility + labels + grouping. */
  schema?: SchemaEntry[] | null;
}) {
  const enr = (enrichment && typeof enrichment === "object") ? (enrichment as Record<string, unknown>) : null;
  const leadRow = (lead && typeof lead === "object") ? (lead as Record<string, unknown>) : null;
  if (!enr && !leadRow) return null;

  // Resolve a value for a schema entry: prefer entry.column from lead, else enrichment[key].
  const valueFor = (entry: { key: string; column?: string }) => {
    if (entry.column && leadRow) {
      const v = leadRow[entry.column];
      if (v != null && String(v).trim() !== "") return v;
    }
    if (enr) {
      const v = enr[entry.key];
      if (v != null && String(v).trim() !== "") return v;
    }
    return null;
  };

  const dataForLegacy = enr ?? {};
  const present = (k: string) => {
    if (META_KEYS.has(k)) return false;
    const v = dataForLegacy[k];
    if (v == null) return false;
    const s = String(v).trim();
    return s.length > 0 && s !== "—" && s !== ".";
  };

  // ── Schema-driven path ───────────────────────────────────────────────────
  // Build entries from schema (only those marked show_in_signals AND present in enrichment)
  type Entry = { key: string; column?: string; label: string; category: string; priority: number };
  let entries: Entry[];

  if (Array.isArray(schema) && schema.length > 0) {
    entries = schema
      .filter(s => s && s.show_in_signals !== false && valueFor(s) != null)
      .map(s => ({
        key: s.key,
        column: s.column,
        label: s.label || prettyLabel(s.key),
        category: s.category || "other",
        priority: typeof s.priority === "number" ? s.priority : 999,
      }))
      .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  } else {
    // ── Legacy fallback ────────────────────────────────────────────────────
    const preferredVisible = LEGACY_PREFERRED.filter(present);
    const extras = Object.keys(dataForLegacy)
      .filter(k => !LEGACY_PREFERRED.includes(k) && present(k))
      .sort();
    entries = [...preferredVisible, ...extras].map((k, i) => ({
      key: k,
      label: prettyLabel(k),
      category: "other",
      priority: i,
    }));
  }

  if (entries.length === 0) return null;

  // Group by category for the schema-driven path. Legacy goes flat.
  const useCategories = Array.isArray(schema) && schema.length > 0;
  const groups: Record<string, Entry[]> = {};
  for (const e of entries) {
    const cat = useCategories ? e.category : "all";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(e);
  }
  const groupOrder = Object.keys(groups).sort((a, b) => {
    const pa = Math.min(...groups[a].map(e => e.priority));
    const pb = Math.min(...groups[b].map(e => e.priority));
    return pa - pb;
  });

  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]);
  };

  const gold = "var(--brand, #c9a83a)";

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
            The AI writes the copy with placeholders like {"{{rfa_rating}}"} that the orchestrator replaces per lead at send time — same as {"{{first_name}}"}.
          </p>

          {groupOrder.map(cat => (
            <div key={cat} className={useCategories ? "mb-3" : ""}>
              {useCategories && (
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>
                  {categoryLabel(cat)}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {groups[cat].map(e => {
                  const isSelected = selected.includes(e.key);
                  const v = valueFor(e);
                  return (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => toggle(e.key)}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-[opacity,transform,box-shadow,background-color,border-color]"
                      style={{
                        backgroundColor: isSelected ? `color-mix(in srgb, ${gold} 14%, transparent)` : C.bg,
                        color: isSelected ? gold : C.textBody,
                        border: `1px solid ${isSelected ? gold : C.border}`,
                      }}
                    >
                      {isSelected && <Check size={10} />}
                      <span className="font-semibold">{e.label}</span>
                      {v != null && (
                        <span className="font-normal" style={{ color: isSelected ? gold : C.textDim, opacity: 0.85 }}>
                          {shortValue(v)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
