import { C } from "@/lib/design";
import { Sparkles, TrendingUp, Building2, Info } from "lucide-react";

// Generic lead-enrichment panel. Renders whatever is in `lead.enrichment` jsonb.
// Grouped by key prefix so each client can extend their own vocabulary without code changes.
// Priority fields (for Pathway: credit signals) are pulled to the top as stat cards.

type Props = { enrichment: Record<string, unknown> | null | undefined };

// Pretty labels for known keys. Unknown keys fall back to auto-titled snake_case.
const LABELS: Record<string, string> = {
  vertical: "Vertical",
  rfa_rating: "RFA Rating",
  rfa_previous_rating: "Previous Rating",
  rfa_credit_score: "Credit Score",
  rfa_credit_limit: "Credit Limit",
  rfa_turnover_est: "Turnover (est.)",
  rfa_trade_debtors: "Trade Debtors",
  rfa_working_capital: "Working Capital",
  rfa_net_worth: "Net Worth",
  rfa_total_assets: "Total Assets",
  rfa_tangible_assets: "Tangible Assets",
  rfa_shareholders_funds: "Shareholders' Funds",
  rfa_cash: "Cash",
  rfa_ebitda: "EBITDA",
  rfa_growth_score: "Growth Score",
  rfa_employees: "Employees",
  rfa_ccj_value: "CCJ Value",
  rfa_vat_number: "VAT Number",
  rfa_liquidity_ratio: "Liquidity Ratio",
  rfa_current_ratio: "Current Ratio",
  rfa_beneficial_owners: "Beneficial Owners",
  rfa_directors: "Directors",
  rfa_special_events: "Recent Events",
  rfa_last_rating_change: "Last Rating Change",
  rfa_pl_reserve: "P&L Reserve",
  rfa_total_current_assets: "Current Assets",
  rfa_creditors_falling: "Creditors (falling due)",
  rfa_long_term_liabilities: "Long-term Liabilities",
  rfa_asset_increase_events: "Asset Increase Events",
  rfa_insolvent_debtors: "Insolvent Debtors",
  ch_total_charges: "Total Charges",
  ch_outstanding_charges: "Outstanding Charges",
  ch_charge_lenders: "Charge Lenders",
  ch_charge_dates: "Charge Dates",
  ch_charge_status: "Charge Status",
  ch_newest_charge_age_months: "Newest Charge Age",
  ch_if_signal: "Invoice Finance Signal",
  ch_if_lender_name: "Current IF Lender",
  ch_director_names: "Director Names (CH)",
  ch_accounts_overdue: "Accounts Overdue",
  ch_confirmation_overdue: "Confirmation Overdue",
  date_of_creation: "Company Incorporated",
  company_number: "Company Number",
  sic_codes: "SIC Codes",
  address_line_1: "Address",
  locality: "City",
  region: "Region",
  postcode: "Postcode",
  country: "Country",
  rfa_website: "Website (RFA)",
  rfa_email: "Email (RFA)",
  Reason: "Qualification Reason",
  Notes: "Notes",
  "Outreach Intelligence": "Outreach Intelligence",
  "Employment History (summary)": "Employment History",
  "Position Start": "Position Start",
  "Valid Date": "Valid Date",
  "Last Updated": "Last Updated",
  "Management Level": "Management Level",
  "Department / Function": "Department",
  "Direct Phone": "Direct Phone",
  "Mobile Phone": "Mobile Phone",
  ICP: "ICP Tier",
  Vertical: "Vertical",
  Score: "Contact Score",
  "In Role Since": "In Role Since",
  EU: "EU Contact",
  "ZI Person ID": "ZoomInfo ID",
  "ZoomInfo ID": "ZoomInfo ID",
  company_name: "Company (CH)",
};

// The 15 fields the client (Pathway) filters on — pulled to the top as stat cards.
const PRIORITY_KEYS = [
  "rfa_rating",
  "rfa_credit_score",
  "rfa_trade_debtors",
  "rfa_working_capital",
  "rfa_net_worth",
  "rfa_growth_score",
  "rfa_turnover_est",
  "rfa_ccj_value",
  "ch_if_signal",
  "ch_if_lender_name",
  "ch_newest_charge_age_months",
  "ch_accounts_overdue",
  "date_of_creation",
  "rfa_previous_rating",
  "vertical",
];

// Keys whose values are long text — render across a full row instead of 2-col grid.
const FULLWIDTH_KEYS = new Set([
  "rfa_special_events", "rfa_beneficial_owners", "rfa_directors",
  "ch_charge_lenders", "ch_charge_dates", "ch_charge_status", "ch_director_names",
  "Reason", "Notes", "Outreach Intelligence", "Employment History (summary)",
]);

const RATING_COLORS: Record<string, { color: string; bg: string }> = {
  GOLD:            { color: "#B45309", bg: "#FEF3C7" },
  SILVER:          { color: "#4B5563", bg: "#E5E7EB" },
  BRONZE:          { color: "#9A3412", bg: "#FED7AA" },
  "ONE RED FLAG":  { color: C.red,     bg: C.redLight },
  "TWO RED FLAGS": { color: C.red,     bg: C.redLight },
};

function prettyLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  return key.replace(/^rfa_|^ch_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function RatingBadge({ value }: { value: string }) {
  const colors = RATING_COLORS[value.toUpperCase()] ?? { color: C.textBody, bg: C.bg };
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded tracking-wider"
      style={{ backgroundColor: colors.bg, color: colors.color }}>
      {value.toUpperCase()}
    </span>
  );
}

function formatValue(key: string, value: unknown): React.ReactNode {
  if (value == null || value === "") return <span style={{ color: C.textDim }}>—</span>;
  const s = String(value);

  if (key === "rfa_rating" || key === "rfa_previous_rating") return <RatingBadge value={s} />;

  if (key === "ch_accounts_overdue" || key === "ch_confirmation_overdue") {
    const isYes = s.toLowerCase() === "yes";
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
        style={{ backgroundColor: isYes ? C.redLight : C.greenLight, color: isYes ? C.red : C.green }}>
        {isYes ? "YES" : "NO"}
      </span>
    );
  }

  if (key === "ch_newest_charge_age_months") {
    const months = Number(s);
    const color = months >= 10 && months <= 14 ? C.red : months >= 6 && months <= 9 ? "#D97706" : C.textBody;
    return <span style={{ color, fontVariantNumeric: "tabular-nums" }}>{s} months</span>;
  }

  if (key === "ch_if_signal") {
    const upper = s.toUpperCase();
    const isRef = upper.includes("REFINANCE");
    const isGreen = upper.includes("GREENFIELD");
    const bg = isRef ? "#FEF3C7" : isGreen ? C.greenLight : C.bg;
    const col = isRef ? "#B45309" : isGreen ? C.green : C.textBody;
    return (
      <span className="text-[11px] font-semibold px-2 py-0.5 rounded whitespace-normal break-words inline-block"
        style={{ backgroundColor: bg, color: col, maxWidth: "100%" }}>
        {s}
      </span>
    );
  }

  if (key === "date_of_creation") {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const years = Math.floor((Date.now() - d.getTime()) / (365.25 * 86400 * 1000));
      return `${d.toLocaleDateString("en-GB", { year: "numeric", month: "short" })} · ${years} yrs old`;
    }
  }

  // Money-like values get tabular numerals
  if (/^-?£/.test(s) || /^-?\d+([.,]\d+)?%?$/.test(s.replace(/\s/g, ""))) {
    return <span style={{ fontVariantNumeric: "tabular-nums" }}>{s}</span>;
  }

  // Long pipe-separated lists — render as pill row, one per line
  if (s.includes(" | ") && s.length > 60) {
    return (
      <div className="flex flex-wrap gap-1">
        {s.split(" | ").map((chunk, i) => (
          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: C.bg, color: C.textBody, border: `1px solid ${C.border}` }}>
            {chunk.trim()}
          </span>
        ))}
      </div>
    );
  }

  // Long multi-line text (Recent Events, Notes, etc.) — render as preformatted block
  if (s.includes("\n") || s.length > 120) {
    return <span className="block whitespace-pre-line leading-relaxed" style={{ color: C.textBody }}>{s}</span>;
  }

  return s;
}

// ── KPI card for priority fields ────────────────────────────────────────────
function StatCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="p-3 rounded-lg border" style={{ backgroundColor: C.bg, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: accent ?? C.border }}>
      <p className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>
        {label}
      </p>
      <div className="text-sm font-semibold break-words" style={{ color: C.textPrimary }}>
        {value}
      </div>
    </div>
  );
}

// ── KV row for secondary fields ─────────────────────────────────────────────
function KVRow({ keyName, value, fullwidth }: { keyName: string; value: unknown; fullwidth?: boolean }) {
  const formatted = formatValue(keyName, value);
  if (fullwidth) {
    return (
      <div className="col-span-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>
          {prettyLabel(keyName)}
        </p>
        <div className="text-xs leading-relaxed" style={{ color: C.textBody }}>
          {formatted}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5" style={{ borderBottom: `1px dashed ${C.border}` }}>
      <span className="text-[11px]" style={{ color: C.textMuted }}>{prettyLabel(keyName)}</span>
      <div className="text-[12px] font-medium text-right" style={{ color: C.textBody }}>
        {formatted}
      </div>
    </div>
  );
}

// ── Accent color for priority stat cards ────────────────────────────────────
function accentFor(key: string): string {
  if (key === "rfa_rating" || key === "rfa_previous_rating") return "#B45309";
  if (key === "rfa_credit_score" || key === "rfa_growth_score") return C.blue;
  if (key.includes("debtors") || key.includes("working_capital") || key.includes("net_worth") || key.includes("turnover")) return C.green;
  if (key === "ch_if_signal" || key === "ch_if_lender_name") return "#7C3AED";
  if (key === "ch_newest_charge_age_months") return "#D97706";
  if (key === "ch_accounts_overdue" || key === "rfa_ccj_value") return C.red;
  return "var(--brand, #c9a83a)";
}

export default function PersonalizedInfoPanel({ enrichment }: Props) {
  if (!enrichment || typeof enrichment !== "object" || Object.keys(enrichment).length === 0) return null;

  const data = { ...enrichment } as Record<string, unknown>;
  delete data.source_file;

  const present = (k: string) => data[k] != null && data[k] !== "";
  const priorityVisible = PRIORITY_KEYS.filter(present);
  const rfaExtra = Object.keys(data).filter(k => k.startsWith("rfa_") && !PRIORITY_KEYS.includes(k) && present(k));
  const chExtra  = Object.keys(data).filter(k => k.startsWith("ch_")  && !PRIORITY_KEYS.includes(k) && present(k));
  const other    = Object.keys(data).filter(k => !k.startsWith("rfa_") && !k.startsWith("ch_") && !PRIORITY_KEYS.includes(k) && present(k));

  if (priorityVisible.length === 0 && rfaExtra.length === 0 && chExtra.length === 0 && other.length === 0) return null;

  const gold = "var(--brand, #c9a83a)";

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between border-b"
        style={{ borderColor: C.border, background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 4%, transparent), transparent)` }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }}>
            <Sparkles size={14} style={{ color: "#fff" }} />
          </div>
          <div>
            <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Personalized Info</h3>
            <p className="text-[10px]" style={{ color: C.textMuted }}>
              Client-specific signals used by AI to personalize outreach
            </p>
          </div>
        </div>
        {priorityVisible.length > 0 && (
          <span className="text-[9px] font-bold px-2 py-1 rounded-full uppercase tracking-wider"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 25%, transparent)` }}>
            {priorityVisible.length} signals
          </span>
        )}
      </div>

      {/* Priority KPI cards */}
      {priorityVisible.length > 0 && (
        <div className="p-5 pb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: C.textMuted }}>
            <TrendingUp size={11} /> Key Signals
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {priorityVisible.map(key => (
              <StatCard
                key={key}
                label={prettyLabel(key)}
                value={formatValue(key, data[key])}
                accent={accentFor(key)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Secondary groups */}
      {[
        { title: "Credit Rating & Financials", icon: TrendingUp, keys: rfaExtra },
        { title: "Companies House",             icon: Building2, keys: chExtra },
        { title: "Additional",                  icon: Info,       keys: other },
      ].map(group => group.keys.length > 0 && (
        <div key={group.title} className="px-5 py-4 border-t" style={{ borderColor: C.border }}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: C.textMuted }}>
            <group.icon size={11} /> {group.title}
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-0">
            {group.keys.map(key => (
              <KVRow key={key} keyName={key} value={data[key]} fullwidth={FULLWIDTH_KEYS.has(key)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
