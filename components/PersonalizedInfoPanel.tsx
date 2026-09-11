import { C, N } from "@/lib/design";
import { Sparkles, TrendingUp, Building2, Info, Sun, FileText, Zap, CalendarClock, MapPin, Users, Maximize2, ArrowRight } from "lucide-react";
import Link from "next/link";
import RooftopMapThumb from "@/components/RooftopMapThumb";
import { useLocale } from "@/lib/i18n";

// Generic lead-enrichment panel. Renders whatever is in `lead.enrichment` jsonb.
// Grouped by key prefix so each client can extend their own vocabulary without code changes.
// Priority fields (for Pathway: credit signals) are pulled to the top as stat cards.

type Props = { enrichment: Record<string, unknown> | null | undefined; leadId?: string; companyName?: string | null };

// Two maps, because the labels here are two different kinds of thing.
//
// LABEL_KEYS holds field names that mean the same in any language — an
// address, a department, a net worth — so they are translated.
//
// LABELS_VERBATIM holds names owned by whoever supplies the data: RFA's
// ratings, Companies House charge vocabulary, ZoomInfo's ids, UK statutory
// acronyms (CCJ, VAT, SIC, EBITDA) and the Italian GSE incentive scheme.
// An operator looks these up against the provider's own report, so a
// translated "CCJ Value" would be worse than useless. They stay as they are
// in every locale.
const LABEL_KEYS: Record<string, string> = {
  vertical: "pip.vertical",
  rfa_credit_score: "pip.creditScore",
  rfa_credit_limit: "pip.creditLimit",
  rfa_turnover_est: "pip.turnoverEst",
  rfa_trade_debtors: "pip.tradeDebtors",
  rfa_working_capital: "pip.workingCapital",
  rfa_net_worth: "pip.netWorth",
  rfa_total_assets: "pip.totalAssets",
  rfa_tangible_assets: "pip.tangibleAssets",
  rfa_shareholders_funds: "pip.shareholders",
  rfa_cash: "pip.cash",
  rfa_employees: "pip.employees",
  rfa_directors: "pip.directors",
  rfa_special_events: "pip.recentEvents",
  rfa_total_current_assets: "pip.currentAssets",
  rfa_creditors_falling: "pip.creditorsFalling",
  rfa_long_term_liabilities: "pip.longTermLiab",
  rfa_insolvent_debtors: "pip.insolventDebtors",
  date_of_creation: "pip.companyIncorp",
  company_number: "pip.companyNumber",
  address_line_1: "pip.address",
  locality: "pip.city",
  region: "pip.region",
  postcode: "pip.postcode",
  country: "pip.country",
  rfa_website: "pip.website",
  rfa_email: "pip.email",
  Reason: "pip.qualReason",
  Notes: "pip.notes",
  "Outreach Intelligence": "pip.outreachIntel",
  "Employment History (summary)": "pip.employmentHist",
  "Position Start": "pip.positionStart",
  "Valid Date": "pip.validDate",
  "Last Updated": "pip.lastUpdated",
  "Management Level": "pip.mgmtLevel",
  "Department / Function": "pip.department",
  "Direct Phone": "pip.directPhone",
  "Mobile Phone": "pip.mobilePhone",
  ICP: "pip.icpTier",
  Vertical: "pip.vertical",
  Score: "pip.contactScore",
  "In Role Since": "pip.inRoleSince",
  EU: "pip.euContact",
  company_name: "pip.companyCh",
  // Rooftop intelligence (Gruppo Everest — solar / industrial energy)
  rooftop_photo_url: "pip.rooftopPhoto",
  has_solar_panels: "pip.solarInstalled",
  rooftop_area_m2: "pip.rooftopArea",
  annual_electricity_kwh: "pip.annualElec",
  estimated_bill_eur_year: "pip.estBill",
  proposed_system_kwp: "pip.proposedSystem",
  estimated_savings_pct_year1: "pip.year1Savings",
  co2_offset_tons_year: "pip.co2Offset",
  payback_months: "pip.payback",
  ai_outreach_angle: "pip.aiAngle",
};

const LABELS_VERBATIM: Record<string, string> = {
  rfa_rating: "RFA Rating",
  rfa_previous_rating: "Previous Rating",
  rfa_ebitda: "EBITDA",
  rfa_growth_score: "Growth Score",
  rfa_ccj_value: "CCJ Value",
  rfa_vat_number: "VAT Number",
  rfa_liquidity_ratio: "Liquidity Ratio",
  rfa_current_ratio: "Current Ratio",
  rfa_beneficial_owners: "Beneficial Owners",
  rfa_last_rating_change: "Last Rating Change",
  rfa_pl_reserve: "P&L Reserve",
  rfa_asset_increase_events: "Asset Increase Events",
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
  sic_codes: "SIC Codes",
  "ZI Person ID": "ZoomInfo ID",
  "ZoomInfo ID": "ZoomInfo ID",
  cer_eligible: "CER Eligible",
  transizione_5_0_eligible: "Transizione 5.0",
};

// Rooftop intelligence keys (Gruppo Everest). When `rooftop_photo_url` is present
// we render them inside a dedicated section above the generic groups, so they
// must NOT also render as part of the "other" bucket.
const ROOFTOP_KEYS = new Set([
  "rooftop_photo_url", "has_solar_panels",
  "rooftop_area_m2", "annual_electricity_kwh", "estimated_bill_eur_year",
  "proposed_system_kwp", "estimated_savings_pct_year1", "co2_offset_tons_year",
  "payback_months", "cer_eligible", "transizione_5_0_eligible",
  "ai_outreach_angle",
  // Structural / consumed-elsewhere keys — kept out of the generic "Additional"
  // bucket so they don't render as raw text. lat/lng drive the map; the
  // nearby-companies array is the cross-sell list (rendered by its own section).
  "rooftop_lat", "rooftop_lng", "nearby_companies", "meeting_notes", "plant_intel",
]);

// Internal / raw keys that should never appear in the generic "Additional" bucket.
// The cacer_* fields are the raw CACER import — already surfaced, cleanly, by the
// Plant Intelligence section, so showing them again as raw text is just noise.
const HIDE_KEYS = new Set(["segment", "icp", "import_seq", "imported_at", "nearby_scraped_at", "source"]);
const isHiddenKey = (k: string) => HIDE_KEYS.has(k) || k.startsWith("cacer_");

function formatRooftopValue(key: string, value: unknown, t: (k: string, vars?: Record<string, string | number>) => string): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (key === "rooftop_area_m2" && Number.isFinite(n)) return `${n.toLocaleString()} m²`;
  if (key === "annual_electricity_kwh" && Number.isFinite(n)) {
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} GWh/yr` : `${Math.round(n / 1000).toLocaleString()} MWh/yr`;
  }
  if (key === "estimated_bill_eur_year" && Number.isFinite(n)) return `€${Math.round(n).toLocaleString()}/yr`;
  if (key === "proposed_system_kwp" && Number.isFinite(n)) return `${n.toLocaleString()} kWp`;
  if (key === "estimated_savings_pct_year1" && Number.isFinite(n)) return `${n}%`;
  if (key === "co2_offset_tons_year" && Number.isFinite(n)) return t("pip.tPerYr", { n: n.toLocaleString() });
  if (key === "payback_months" && Number.isFinite(n)) return t("pip.months", { n });
  if (key === "cer_eligible" || key === "transizione_5_0_eligible") return value ? t("pip.yes") : t("pip.no");
  return String(value);
}

function RooftopSection({ data, leadId, companyName }: { data: Record<string, unknown>; leadId?: string; companyName?: string | null }) {
  const { t } = useLocale();
  const photoUrl = data.rooftop_photo_url as string | undefined;
  const hasSolar = String(data.has_solar_panels ?? "").toLowerCase() === "yes";
  const angle = data.ai_outreach_angle as string | undefined;
  const lat = typeof data.rooftop_lat === "number" ? data.rooftop_lat : null;
  const lng = typeof data.rooftop_lng === "number" ? data.rooftop_lng : null;

  const stats: Array<{ key: string; label: string }> = [
    { key: "rooftop_area_m2", label: t("pv.rooftopArea") },
    { key: "annual_electricity_kwh", label: t("pv.annualUse") },
    { key: "estimated_bill_eur_year", label: t("pv.energyBill") },
    { key: "proposed_system_kwp", label: t("pv.proposedKwp") },
    { key: "estimated_savings_pct_year1", label: t("pv.year1Savings") },
    { key: "payback_months", label: t("pip.payback") },
    { key: "co2_offset_tons_year", label: t("pv.co2Offset") },
  ];
  const visibleStats = stats.filter(s => data[s.key] != null && data[s.key] !== "");

  const badgeColor = hasSolar
    ? { bg: C.greenLight, fg: C.green, label: t("pv.hasPanels") }
    : { bg: C.redLight,   fg: C.red,   label: t("pv.noPanels") };

  return (
    <SectionBlock icon={Sun} title={t("pv.rooftopIntel")} accent={C.gold} bg={C.goldSoft}>
      {/* Photo (floats left, expands in place) + outreach text wrapping beside it */}
      <div style={{ overflow: "hidden" }}>
        {photoUrl ? (
          <RooftopMapThumb
            photoUrl={photoUrl}
            lat={lat}
            lng={lng}
            alt={hasSolar ? t("pip.rooftopWith") : t("pip.rooftopWithout")}
          />
        ) : null}
        <div style={{ overflow: "hidden" }} className="flex flex-col gap-3">
          {(data.cer_eligible === true || data.transizione_5_0_eligible === true) && (
            <div className="flex flex-wrap gap-1.5">
              {data.cer_eligible === true && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: C.blueLight, color: C.blue }}>
                  {t("pip.cerEligible")}
                </span>
              )}
              {data.transizione_5_0_eligible === true && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: "color-mix(in srgb, #7C3AED 10%, transparent)", color: "#7C3AED" }}>
                  Transizione 5.0
                </span>
              )}
            </div>
          )}
          {angle && (
            <div className="text-[12px] leading-relaxed rounded-md p-3 border"
              style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textBody }}>
              <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: C.gold }}>
                {t("pip.outreachAngle")}
              </div>
              {angle}
            </div>
          )}
        </div>
      </div>

      {/* Sizing stats */}
      {visibleStats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4">
          {visibleStats.map(s => (
            <div key={s.key} className="p-2.5 rounded-lg border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
              <p className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>
                {s.label}
              </p>
              <div className="text-sm font-semibold" style={{ color: C.textPrimary, fontVariantNumeric: "tabular-nums" }}>
                {formatRooftopValue(s.key, data[s.key], t)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cross-sell: link to the dedicated nearby-companies page (Everest demo). */}
      {leadId && Array.isArray(data.nearby_companies) && data.nearby_companies.length > 0 && (
        <Link href={`/leads/${leadId}/nearby`}
          className="group mt-4 w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl font-semibold transition-all hover:-translate-y-px relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${N.ink2}, ${N.ink})`, border: `1px solid ${N.hairline}`, boxShadow: "0 10px 26px -10px rgba(0,0,0,0.55)" }}>
          {/* faint gold sheen on the right edge */}
          <span aria-hidden className="absolute inset-y-0 right-0 w-1/2 pointer-events-none"
            style={{ background: `linear-gradient(90deg, transparent, ${C.goldGlow})` }} />
          <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 relative" style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.goldDim})`, color: N.ink, boxShadow: `0 4px 12px ${C.goldGlow}` }}>
            <Building2 size={18} />
          </span>
          <span className="flex-1 text-left leading-tight relative">
            <span className="text-[14px]" style={{ color: "#fff" }}>{t("pv.crossSell")}</span>
            <span className="block text-[11.5px] font-medium mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>
              {t("pip.nearbyBlurb", { n: (data.nearby_companies as unknown[]).length })}
            </span>
          </span>
          <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-transform group-hover:translate-x-0.5 relative" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: N.goldOnDark }}>
            <ArrowRight size={16} />
          </span>
        </Link>
      )}
    </SectionBlock>
  );
}

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
  GOLD:            { color: "#B45309", bg: "color-mix(in srgb, #D97706 16%, transparent)" },
  SILVER:          { color: "#4B5563", bg: C.border },
  BRONZE:          { color: "#9A3412", bg: "color-mix(in srgb, #EA580C 30%, transparent)" },
  "ONE RED FLAG":  { color: C.red,     bg: C.redLight },
  "TWO RED FLAGS": { color: C.red,     bg: C.redLight },
};

function prettyLabel(key: string, t: (k: string) => string): string {
  if (LABEL_KEYS[key]) return t(LABEL_KEYS[key]);
  if (LABELS_VERBATIM[key]) return LABELS_VERBATIM[key];
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

function formatValue(key: string, value: unknown, t: (k: string, vars?: Record<string, string | number>) => string): React.ReactNode {
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
    return <span style={{ color, fontVariantNumeric: "tabular-nums" }}>{t("pip.nMonths", { n: s })}</span>;
  }

  if (key === "ch_if_signal") {
    const upper = s.toUpperCase();
    const isRef = upper.includes("REFINANCE");
    const isGreen = upper.includes("GREENFIELD");
    const bg = isRef ? "color-mix(in srgb, #D97706 16%, transparent)" : isGreen ? C.greenLight : C.bg;
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
              style={{ backgroundColor: isOut ? "color-mix(in srgb, #D97706 16%, transparent)" : C.greenLight, color: isOut ? "#B45309" : C.green }}>
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
  const { t } = useLocale();
  const formatted = formatValue(keyName, value, t);
  if (fullwidth) {
    return (
      <div className="col-span-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>
          {prettyLabel(keyName, t)}
        </p>
        <div className="text-xs leading-relaxed" style={{ color: C.textBody }}>
          {formatted}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5" style={{ borderBottom: `1px dashed ${C.border}` }}>
      <span className="text-[11px]" style={{ color: C.textMuted }}>{prettyLabel(keyName, t)}</span>
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

// Meeting / discovery notes (Gruppo Everest demo). Structured account notes
// rendered as a readable dossier inside Personalized Info.
function MeetingNotesSection({ notes }: { notes: any }) {
  const { t } = useLocale();
  const accent = "#6366F1";
  const sections: any[] = Array.isArray(notes?.sections) ? notes.sections : [];
  return (
    <SectionBlock icon={FileText} title={notes?.title || t("pip.meetingNotes")} accent={accent} bg={`color-mix(in srgb, ${accent} 9%, transparent)`}>
      {(notes?.subtitle || notes?.tag) && (
        <div className="flex items-center gap-2 mb-4">
          {notes.subtitle && <span className="text-[11px] font-semibold" style={{ color: C.textMuted }}>{notes.subtitle}</span>}
          {notes.tag && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: C.redLight, color: C.red }}>{notes.tag}</span>}
        </div>
      )}
      <div className="space-y-3">
        {sections.map((s, i) => (
          <div key={i} className="rounded-lg p-4" style={{ backgroundColor: C.bg, borderLeft: `3px solid color-mix(in srgb, ${accent} 50%, transparent)` }}>
            <p className="text-[13px] font-bold mb-2" style={{ color: C.textPrimary }}>{s.h}</p>
            {(Array.isArray(s.p) ? s.p : []).map((para: string, j: number) => (
              <p key={j} className="text-[12.5px] leading-relaxed mb-1.5" style={{ color: C.textBody }}>{para}</p>
            ))}
            {s.bulletsLabel && <p className="text-[10px] font-bold uppercase tracking-wider mt-2.5 mb-1.5" style={{ color: accent }}>{s.bulletsLabel}</p>}
            {Array.isArray(s.bullets) && s.bullets.length > 0 && (
              <ul className="space-y-1 mt-1">
                {s.bullets.map((b: string, k: number) => (
                  <li key={k} className="text-[12.5px] leading-snug flex gap-2" style={{ color: C.textBody }}><span style={{ color: accent }}>•</span><span>{b}</span></li>
                ))}
              </ul>
            )}
            {s.note && <p className="text-[12px] italic mt-3 pt-2.5 border-t" style={{ color: C.textMuted, borderColor: C.border }}>{s.note}</p>}
          </div>
        ))}
      </div>
    </SectionBlock>
  );
}

// ── Plant Intelligence (Gruppo Everest) — the Opportunity-1 dossier per PV plant ──
function PlantIntelSection({ intel }: { intel: any }) {
  const { t } = useLocale();
  const accent = C.gold;
  const it = (n: number) => n.toLocaleString("it-IT");
  const kw  = typeof intel.installed_power_kw === "number" ? `${it(intel.installed_power_kw)} kW` : null;
  const eur = typeof intel.contributo_eur === "number" ? `€${it(intel.contributo_eur)}` : null;
  const yr = (s: unknown) => { const m = String(s ?? "").match(/\d{4}/); return m ? Number(m[0]) : null; };
  const gY = yr(intel.incentive_granted), vY = yr(intel.incentive_valid_until);
  const term = gY != null && vY != null && vY > gY ? t("pip.yrs", { n: vY - gY }) : null;

  const kpis = ([
    { label: t("pv.installedPower"), value: kw },
    { label: t("pip.installation"), value: intel.installation_type },
    { label: t("pv.gseSegment"), value: intel.segment },
    { label: t("pv.incentiveTerm"), value: term },
  ] as { label: string; value: React.ReactNode }[]).filter(k => k.value);

  const owners: [string, string][] = ([
    [t("pip.incentiveHolder"), intel.incentive_holder],
    [t("pip.beneficiary"), intel.beneficiary],
    [t("pip.buildingOwner"), intel.building_owner],
    [t("pip.installOwner"), intel.installation_owner],
  ] as [string, string][]).filter(([, v]) => !!v);
  const distinctOwners = new Set(owners.map(([, v]) => v));
  // Honor an explicit ownership_type when the source states it (e.g. the sheet
  // says "no split ownership on record"); otherwise infer from distinct names.
  const singleOwner = intel.ownership_type ? intel.ownership_type === "single" : distinctOwners.size === 1;

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) =>
    value == null || value === "" ? null : (
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: C.textMuted }}>{label}</p>
        <p className="text-[12.5px] font-semibold break-words" style={{ color: C.textPrimary }}>{value}</p>
      </div>
    );

  const SubCard = ({ icon: Icon, title, children }: { icon: typeof Info; title: string; children: React.ReactNode }) => (
    <div className="rounded-lg p-3.5 border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
      <div className="flex items-center gap-1.5 mb-3">
        <Icon size={12} style={{ color: accent }} />
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>{title}</p>
      </div>
      {children}
    </div>
  );

  return (
    <SectionBlock icon={Zap} title={t("pv.plantIntel")} accent={accent} bg={`color-mix(in srgb, ${accent} 9%, transparent)`}>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] font-medium" style={{ color: C.textMuted }}>{t("pv.plantDossier")}</span>
      </div>

      {/* Top KPIs */}
      <div className="grid gap-2.5 mb-2.5" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0, 1fr))` }}>
        {kpis.map(k => <StatCard key={k.label} label={k.label} value={k.value} accent={accent} />)}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 items-start">
        {/* State incentive — GSE grant (CACER) or Conto Energia feed-in tariff */}
        <SubCard icon={CalendarClock} title={intel.conto_energia_scheme ? "State incentive (Conto Energia)" : t("pip.stateIncentive")}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            {intel.conto_energia_scheme && (
              <div className="col-span-2"><Field label={t("pv.scheme")} value={intel.conto_energia_scheme} /></div>
            )}
            <Field label={t("pv.feedInTariff")} value={typeof intel.feed_in_tariff_eur_kwh === "number" ? `€${intel.feed_in_tariff_eur_kwh.toFixed(3)}/kWh` : null} />
            <Field label={t("pv.granted")} value={intel.incentive_granted} />
            <Field label={t("pv.validUntil")} value={intel.incentive_valid_until} />
            <Field label="Contributo" value={eur} />
            <Field label="Convenzione" value={intel.convenzione} />
            <Field label="Atto di concessione" value={intel.atto_concessione} />
            <Field label="CUP" value={intel.cup} />
            <Field label="COR" value={intel.cor} />
          </div>
        </SubCard>

        {/* Site & roof (location + roof merged so the space is used well) */}
        <SubCard icon={MapPin} title={t("pv.siteRoof")}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <Field label={t("pv.city")} value={intel.city} />
            <Field label={t("pv.province")} value={intel.province} />
            <Field label={t("pv.coordinates")} value={typeof intel.geo_lat === "number" && typeof intel.geo_lng === "number" ? `${intel.geo_lat.toFixed(4)}, ${intel.geo_lng.toFixed(4)}` : null} />
            <Field label={t("pv.roofArea")} value={typeof intel.roof_area_m2 === "number" ? `${it(intel.roof_area_m2)} m²` : null} />
            <Field label={t("acc.cap.available")} value={typeof intel.roof_available_m2 === "number" ? `${it(intel.roof_available_m2)} m²` : null} />
            <Field label={t("pv.expansion")} value={typeof intel.expansion_potential_kwp === "number" ? `+${it(intel.expansion_potential_kwp)} kWp` : null} />
          </div>
        </SubCard>

        {/* Ownership structure — full width, owners laid out across the row */}
        <div className="md:col-span-2">
          <SubCard icon={Users} title={t("pv.ownership")}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={singleOwner
                  ? { backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 16%, transparent)", color: C.goldDim }
                  : { backgroundColor: C.redLight, color: C.red }}>
                {singleOwner ? t("pip.singleOwner") : t("pip.splitOwnership")}
              </span>
              {!singleOwner && (
                <span className="text-[10.5px] font-medium" style={{ color: C.textMuted }}>
                  {t("pip.landlordNeeded")}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3.5">
              {owners.map(([label, value]) => <Field key={label} label={label} value={value} />)}
            </div>
            {intel.ownership_note && (
              <p className="text-[12px] italic mt-3.5 pt-3 border-t leading-relaxed" style={{ color: C.textMuted, borderColor: C.border }}>{intel.ownership_note}</p>
            )}
          </SubCard>
        </div>
      </div>
    </SectionBlock>
  );
}

export default function PersonalizedInfoPanel({ enrichment, leadId, companyName }: Props) {
  const { t } = useLocale();
  if (!enrichment || typeof enrichment !== "object" || Object.keys(enrichment).length === 0) return null;

  const data = normalizeEnrichment(enrichment as Record<string, unknown>);

  const present = (k: string) => data[k] != null && data[k] !== "";
  const priorityVisible = PRIORITY_KEYS.filter(present);
  const rfaExtra = sortKeys(Object.keys(data).filter(k => k.startsWith("rfa_") && !PRIORITY_KEYS.includes(k) && present(k)), RFA_ORDER);
  const chExtra  = sortKeys(Object.keys(data).filter(k => k.startsWith("ch_")  && !PRIORITY_KEYS.includes(k) && present(k)), CH_ORDER);
  const other    = sortKeys(Object.keys(data).filter(k => !k.startsWith("rfa_") && !k.startsWith("ch_") && !PRIORITY_KEYS.includes(k) && !ROOFTOP_KEYS.has(k) && !isHiddenKey(k) && present(k)), OTHER_ORDER);

  const showRooftop = present("rooftop_photo_url") || present("has_solar_panels");

  if (!showRooftop && priorityVisible.length === 0 && rfaExtra.length === 0 && chExtra.length === 0 && other.length === 0) return null;

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
            <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("pv.personalizedInfo")}</h3>
            <p className="text-[10px]" style={{ color: C.textMuted }}>
              {t("pip.signalsHint")}
            </p>
          </div>
        </div>
        {priorityVisible.length > 0 && (
          <span className="text-[9px] font-bold px-2 py-1 rounded-full uppercase tracking-wider"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 25%, transparent)` }}>
            {t("pip.nSignals", { n: priorityVisible.length })}
          </span>
        )}
      </div>

      {/* Rooftop intelligence (Gruppo Everest) — renders only if present */}
      {showRooftop && <RooftopSection data={data} leadId={leadId} companyName={companyName} />}
      {data.plant_intel && typeof data.plant_intel === "object" && <PlantIntelSection intel={data.plant_intel} />}
      {data.meeting_notes && typeof data.meeting_notes === "object" && <MeetingNotesSection notes={data.meeting_notes} />}

      {/* Priority KPI cards */}
      {priorityVisible.length > 0 && (
        <SectionBlock icon={TrendingUp} title={t("pv.keySignals")} accent={gold} bg={`color-mix(in srgb, ${gold} 6%, transparent)`}>
          <div className="grid grid-cols-3 gap-2.5">
            {priorityVisible.map(key => (
              <StatCard
                key={key}
                label={prettyLabel(key, t)}
                value={formatValue(key, data[key], t)}
                accent={accentFor(key)}
              />
            ))}
          </div>
        </SectionBlock>
      )}

      {/* Secondary groups — split short KV rows from long full-width rows so the grid stays aligned */}
      {[
        { title: t("pv.creditRating"), icon: TrendingUp, keys: rfaExtra, accent: C.blue,  bg: C.blueLight },
        { title: "Companies House",             icon: Building2, keys: chExtra,  accent: "#7C3AED", bg: "color-mix(in srgb, #7C3AED 10%, transparent)" },
        { title: t("pip.additional"),           icon: Info,       keys: other,    accent: C.textMuted, bg: "#F9FAFB" },
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

// redeploy trigger 1782754735
