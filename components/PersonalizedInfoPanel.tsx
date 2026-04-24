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

// Title-case a kebab/snake/lowercase phrase: "fully-satisfied" → "Fully Satisfied"
function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// Clean up date-ish strings: "2002-08-12 0:00:00" or "2002-08-12T00:00:00" → "Aug 2002".
function formatDateLabel(s: string, includeDay = false): string | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", ...(includeDay ? { day: "numeric" } : {}) });
}

function formatValue(key: string, value: unknown): React.ReactNode {
  if (value == null || value === "") return <span style={{ color: C.textDim }}>—</span>;
  const s = String(value).trim();
  if (!s || s === ".") return <span style={{ color: C.textDim }}>—</span>;

  if (key === "rfa_rating" || key === "rfa_previous_rating") return <RatingBadge value={s} />;

  if (key === "ICP" || key === "icp_status") return <RatingBadge value={s} />;

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

  if (key === "ch_charge_status") {
    // Pipe-separated statuses like "outstanding | fully-satisfied" — render as pills.
    return (
      <div className="flex flex-wrap gap-1 justify-end">
        {s.split("|").map((chunk, i) => {
          const t = chunk.trim();
          const isOut = t.toLowerCase() === "outstanding";
          return (
            <span key={i} className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: isOut ? "#FEF3C7" : C.greenLight, color: isOut ? "#B45309" : C.green }}>
              {titleCase(t)}
            </span>
          );
        })}
      </div>
    );
  }

  if (key === "date_of_creation") {
    const label = formatDateLabel(s);
    if (label) {
      const m = s.match(/^(\d{4})/);
      const years = m ? new Date().getFullYear() - Number(m[1]) : null;
      return years != null ? `${label} · ${years} yrs old` : label;
    }
  }

  if (key === "Position Start" || key === "position_start_date" || key === "Valid Date" || key === "valid_date" || key === "Last Updated" || key === "last_updated") {
    const label = formatDateLabel(s);
    if (label) return <span style={{ fontVariantNumeric: "tabular-nums" }}>{label}</span>;
  }

  // Money-like values get tabular numerals
  if (/^-?£/.test(s) || /^-?\d+([.,]\d+)?%?$/.test(s.replace(/\s/g, ""))) {
    return <span style={{ fontVariantNumeric: "tabular-nums" }}>{s}</span>;
  }

  // Long pipe-separated lists — render as pill row
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

  // Long multi-line text (Recent Events, etc.) — render as preformatted block
  if (s.includes("\n") || s.length > 120) {
    return <span className="block whitespace-pre-line leading-relaxed" style={{ color: C.textBody }}>{s}</span>;
  }

  // Short lowercase statuses like "outstanding" / "fully-satisfied" → title-case
  if (/^[a-z][a-z -]+$/.test(s) && s.length < 40) return titleCase(s);

  return s;
}

// ── Section block with colored accent + tinted header ──────────────────────
function SectionBlock({
  icon: Icon, title, accent, bg, children,
}: {
  icon: typeof Info; title: string; accent: string; bg: string; children: React.ReactNode;
}) {
  return (
    <div className="border-t" style={{ borderColor: C.border, borderLeft: `3px solid ${accent}`, backgroundColor: bg }}>
      <div className="px-5 py-2.5 flex items-center gap-2 border-b"
        style={{ borderColor: `color-mix(in srgb, ${accent} 15%, transparent)` }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)` }}>
          <Icon size={11} style={{ color: accent }} />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>
          {title}
        </p>
      </div>
      <div className="px-5 py-4" style={{ backgroundColor: C.card }}>
        {children}
      </div>
    </div>
  );
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

// Preferred field order within each secondary group.
const RFA_ORDER = [
  "rfa_credit_limit", "rfa_total_assets", "rfa_tangible_assets", "rfa_shareholders_funds",
  "rfa_cash", "rfa_ebitda", "rfa_pl_reserve",
  "rfa_total_current_assets", "rfa_creditors_falling", "rfa_long_term_liabilities",
  "rfa_liquidity_ratio", "rfa_current_ratio",
  "rfa_employees", "rfa_vat_number",
  "rfa_asset_increase_events", "rfa_insolvent_debtors",
  "rfa_last_rating_change",
  "rfa_directors", "rfa_beneficial_owners", "rfa_special_events",
];

const CH_ORDER = [
  "ch_total_charges", "ch_outstanding_charges",
  "ch_charge_lenders", "ch_charge_dates", "ch_charge_status",
  "ch_director_names", "ch_confirmation_overdue",
];

const OTHER_ORDER = [
  "company_number", "date_of_creation", "sic_codes",
  "vertical", "ICP", "Reason",
  "Management Level", "Department / Function", "Position Start",
  "Valid Date", "Last Updated",
  "address_line_1", "locality", "region", "postcode", "country",
  "rfa_website", "rfa_email",
  "Direct Phone", "Mobile Phone",
  "Notes", "Outreach Intelligence", "Employment History (summary)",
];

// Keys whose values are inherently multi-line / long — render as full-width rows.
const LONG_VALUE_KEYS = new Set([
  "rfa_special_events", "rfa_beneficial_owners", "rfa_directors", "rfa_last_rating_change",
  "ch_charge_lenders", "ch_charge_dates", "ch_charge_status", "ch_director_names",
  "Reason", "Notes", "Outreach Intelligence", "Employment History (summary)",
]);

// Strip noisy/duplicate keys before rendering:
// - Deduplicate suffixed cols ("__1", "__2") from the CSV merge
// - Collapse synonyms: icp_status/ICP, industry/vertical, company_name (dup)
// - Drop empty strings and placeholder "."
function normalizeEnrichment(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "source_file") continue;
    if (/__\d+$/.test(k)) continue; // drop __1, __2 dupes
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || s === "." || s === "—") continue;
    out[k] = v;
  }
  // Synonym collapse: prefer one canonical key per concept.
  if (out.icp_status && !out.ICP) { out.ICP = out.icp_status; delete out.icp_status; }
  else if (out.icp_status && out.ICP) { delete out.icp_status; }
  if (out.industry && !out.vertical) { out.vertical = out.industry; delete out.industry; }
  else if (out.industry && out.vertical) { delete out.industry; }
  delete out.company_name; // duplicate of lead's company_name on the main page
  return out;
}

function sortKeys(keys: string[], order: string[]): string[] {
  const idx = new Map(order.map((k, i) => [k, i]));
  return [...keys].sort((a, b) => {
    const ai = idx.has(a) ? idx.get(a)! : 999 + a.localeCompare(b);
    const bi = idx.has(b) ? idx.get(b)! : 999;
    return (ai as number) - (bi as number);
  });
}

export default function PersonalizedInfoPanel({ enrichment }: Props) {
  if (!enrichment || typeof enrichment !== "object" || Object.keys(enrichment).length === 0) return null;

  const data = normalizeEnrichment(enrichment as Record<string, unknown>);

  const present = (k: string) => data[k] != null && data[k] !== "";
  const priorityVisible = PRIORITY_KEYS.filter(present);
  const rfaExtra = sortKeys(Object.keys(data).filter(k => k.startsWith("rfa_") && !PRIORITY_KEYS.includes(k) && present(k)), RFA_ORDER);
  const chExtra  = sortKeys(Object.keys(data).filter(k => k.startsWith("ch_")  && !PRIORITY_KEYS.includes(k) && present(k)), CH_ORDER);
  const other    = sortKeys(Object.keys(data).filter(k => !k.startsWith("rfa_") && !k.startsWith("ch_") && !PRIORITY_KEYS.includes(k) && present(k)), OTHER_ORDER);

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
        <SectionBlock icon={TrendingUp} title="Key Signals" accent={gold} bg={`color-mix(in srgb, ${gold} 6%, transparent)`}>
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
        </SectionBlock>
      )}

      {/* Secondary groups — split short KV rows from long full-width rows so the grid stays aligned */}
      {[
        { title: "Credit Rating & Financials", icon: TrendingUp, keys: rfaExtra, accent: C.blue,  bg: C.blueLight },
        { title: "Companies House",             icon: Building2, keys: chExtra,  accent: "#7C3AED", bg: "#F5F3FF" },
        { title: "Additional",                  icon: Info,       keys: other,    accent: C.textMuted, bg: "#F9FAFB" },
      ].map(group => {
        if (group.keys.length === 0) return null;
        const shortKeys = group.keys.filter(k => !LONG_VALUE_KEYS.has(k));
        const longKeys  = group.keys.filter(k =>  LONG_VALUE_KEYS.has(k));
        return (
          <SectionBlock key={group.title} icon={group.icon} title={group.title} accent={group.accent} bg={group.bg}>
            {shortKeys.length > 0 && (
              <div className="grid grid-cols-2 gap-x-6">
                {shortKeys.map(key => (
                  <KVRow key={key} keyName={key} value={data[key]} />
                ))}
              </div>
            )}
            {longKeys.length > 0 && (
              <div className={`space-y-3 ${shortKeys.length > 0 ? "mt-3 pt-3 border-t" : ""}`} style={{ borderColor: C.border }}>
                {longKeys.map(key => (
                  <KVRow key={key} keyName={key} value={data[key]} fullwidth />
                ))}
              </div>
            )}
          </SectionBlock>
        );
      })}
    </div>
  );
}
