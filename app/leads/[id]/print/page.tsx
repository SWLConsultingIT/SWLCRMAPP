import { notFound } from "next/navigation";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import PrintTrigger from "../../../reports/print/PrintTrigger";
import PrintActions from "../../../reports/print/PrintActions";

// Branded, print-optimized single-lead sheet ("Opportunity Sheet"). Opened in a
// new tab from the "Export" button on the lead detail; auto-fires window.print()
// so the user lands in the browser's Save-as-PDF dialog. Renders EVERY field the
// lead actually has (contact, company, plant intelligence, rooftop photo, nearby
// C&I cluster, enrichment) — nothing invented, blanks are simply omitted.
// Mirrors the /reports/print + /icp/[id]/print convention (zero PDF deps,
// tenant-scoped, GrowthAI header + "Prepared for <tenant>").

export const dynamic = "force-dynamic";

type Branding = { companyName: string; logoUrl: string | null; brandColor: string };

async function getBranding(companyBioId: string | null): Promise<Branding> {
  const fallback: Branding = { companyName: "SWL Consulting", logoUrl: null, brandColor: "#c9a83a" };
  if (!companyBioId) return fallback;
  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("company_name, logo_url, primary_color, use_brand_colors")
    .eq("id", companyBioId)
    .maybeSingle();
  if (!bio) return fallback;
  return {
    companyName: bio.company_name ?? fallback.companyName,
    logoUrl: bio.logo_url ?? null,
    brandColor: bio.use_brand_colors && bio.primary_color ? bio.primary_color : fallback.brandColor,
  };
}

const val = (v: unknown) => v != null && String(v).trim() !== "" && String(v).trim() !== "—";
const it = (n: number) => n.toLocaleString("it-IT");
const yr = (s: unknown) => { const m = String(s ?? "").match(/\d{4}/); return m ? Number(m[0]) : null; };
const titleCase = (s: string) => s.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());

// ── layout helpers ──────────────────────────────────────────────────────────
function Section({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px", borderTop: `3px solid ${accent}`, breakInside: "avoid" }}>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6B7280", margin: "0 0 10px" }}>{label}</p>
      {children}
    </div>
  );
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (!val(value)) return null;
  return (
    <div>
      <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9CA3AF", margin: "0 0 2px" }}>{label}</p>
      <p style={{ fontSize: 12.5, fontWeight: 600, color: "#111827", margin: 0, wordBreak: "break-word" }}>{value}</p>
    </div>
  );
}
function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: "12px 20px" }}>{children}</div>;
}
function KpiCard({ label, value, accent }: { label: string; value: React.ReactNode; accent: string }) {
  return (
    <div style={{ border: "1px solid #E5E7EB", borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: "8px 12px" }}>
      <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B7280", margin: "0 0 3px" }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 800, color: "#111827", margin: 0 }}>{value}</p>
    </div>
  );
}

// Structural / already-rendered enrichment keys → excluded from the generic bucket.
const CONSUMED = new Set([
  "plant_intel", "meeting_notes", "nearby_companies",
  "rooftop_photo_url", "has_solar_panels", "rooftop_area_m2", "annual_electricity_kwh",
  "estimated_bill_eur_year", "proposed_system_kwp", "estimated_savings_pct_year1",
  "co2_offset_tons_year", "payback_months", "cer_eligible", "transizione_5_0_eligible",
  "ai_outreach_angle", "rooftop_lat", "rooftop_lng",
  "source", "imported_at", "icp", "import_seq", "segment", "nearby_scraped_at",
  "cacer_potenza_kw", "cacer_comune", "cacer_provincia",
]);

export default async function LeadPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId) notFound();

  const svc = getSupabaseService();
  let query = svc.from("leads").select("*").eq("id", id);
  if (scope.isScoped && scope.companyBioId) query = query.eq("company_bio_id", scope.companyBioId);
  const { data: raw } = await query.maybeSingle();
  if (!raw) notFound();
  const [L] = await hydrateClientLeads([raw as any]);
  const lead = L as any;

  const brand = await getBranding(lead.company_bio_id ?? scope.companyBioId);
  const accent = brand.brandColor;

  // ICP name
  let icpName: string | null = null;
  if (lead.icp_profile_id) {
    const { data: icp } = await svc.from("icp_profiles").select("profile_name").eq("id", lead.icp_profile_id).maybeSingle();
    icpName = icp?.profile_name ?? null;
  }

  const enr: Record<string, any> = (lead.enrichment && typeof lead.enrichment === "object") ? lead.enrichment : {};
  const intel: Record<string, any> | null = (enr.plant_intel && typeof enr.plant_intel === "object") ? enr.plant_intel : null;
  const nearby: any[] = Array.isArray(enr.nearby_companies) ? enr.nearby_companies : [];

  const contactName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim();
  const generatedAt = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const location = [lead.company_city, lead.company_state, lead.company_country].filter(val).join(", ");

  // Top KPI strip — plant leads mirror the opportunity sheet; else lead vitals.
  const kpis: { label: string; value: React.ReactNode; accent: string }[] = [];
  if (intel) {
    if (val(intel.province)) kpis.push({ label: "Province", value: intel.province, accent: "#2563EB" });
    if (val(intel.city)) kpis.push({ label: "Municipality", value: intel.city, accent: "#0D9488" });
    if (typeof intel.installed_power_kw === "number") kpis.push({ label: "Installed capacity", value: `${it(intel.installed_power_kw)} kW`, accent });
    if (val(intel.segment)) kpis.push({ label: "Segment", value: intel.segment, accent: "#7C3AED" });
    const gY = yr(intel.incentive_granted), vY = yr(intel.incentive_valid_until);
    if (gY && vY && vY > gY) kpis.push({ label: "Incentive term", value: `${vY - gY} yrs`, accent: "#EA580C" });
  } else {
    if (val(lead.status)) kpis.push({ label: "Status", value: titleCase(String(lead.status)), accent: "#2563EB" });
    if (val(icpName)) kpis.push({ label: "ICP / Ticket", value: icpName, accent: "#7C3AED" });
    if (typeof lead.lead_score === "number" && lead.lead_score > 0) kpis.push({ label: "Lead score", value: lead.lead_score, accent: "#0D9488" });
    if (val(lead.current_channel)) kpis.push({ label: "Channel", value: titleCase(String(lead.current_channel)), accent });
  }

  const ownerFields: [string, any][] = intel ? ([
    ["Incentive holder", intel.incentive_holder],
    ["Beneficiary", intel.beneficiary],
    ["Installation owner", intel.installation_owner],
    ["Building owner", intel.building_owner],
  ] as [string, any][]).filter(([, v]) => val(v)) : [];
  const singleOwner = intel ? (intel.ownership_type ? intel.ownership_type === "single" : new Set(ownerFields.map(([, v]) => v)).size <= 1) : false;

  const rooftopStats: { label: string; value: React.ReactNode }[] = [];
  if (val(enr.rooftop_area_m2)) rooftopStats.push({ label: "Roof area", value: `${it(Number(enr.rooftop_area_m2))} m²` });
  if (val(intel?.roof_available_m2)) rooftopStats.push({ label: "Available roof", value: `${it(Number(intel!.roof_available_m2))} m²` });
  if (val(intel?.expansion_potential_kwp)) rooftopStats.push({ label: "Expansion potential", value: `+${it(Number(intel!.expansion_potential_kwp))} kWp` });
  if (val(enr.proposed_system_kwp)) rooftopStats.push({ label: "Proposed system", value: `${it(Number(enr.proposed_system_kwp))} kWp` });
  if (val(enr.annual_electricity_kwh)) rooftopStats.push({ label: "Annual electricity", value: `${it(Number(enr.annual_electricity_kwh))} kWh/yr` });
  if (val(enr.estimated_bill_eur_year)) rooftopStats.push({ label: "Estimated bill", value: `€${it(Number(enr.estimated_bill_eur_year))}/yr` });
  if (val(enr.payback_months)) rooftopStats.push({ label: "Payback", value: `${enr.payback_months} months` });
  if (val(enr.co2_offset_tons_year)) rooftopStats.push({ label: "CO₂ reduction", value: `${enr.co2_offset_tons_year} t/yr` });

  // Generic leftover enrichment (primitives only) so nothing is dropped.
  const extra = Object.entries(enr).filter(([k, v]) =>
    !CONSUMED.has(k) && !k.startsWith("cacer_") && v != null && (typeof v !== "object") && String(v).trim() !== "");

  return (
    <>
      <PrintTrigger />
      <PrintActions />
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm 13mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        body { font-family: 'Inter', system-ui, sans-serif; background: #fff; color: #111827; }
        * { box-sizing: border-box; }
        table { border-collapse: collapse; width: 100%; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px", fontSize: 13 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, paddingBottom: 16, borderBottom: `2px solid ${accent}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 72%, white))`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: 20 }}>⚡</span>
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: 18, color: "#111827", margin: 0, letterSpacing: "-0.01em" }}>
                GrowthAI <span style={{ color: accent }}>— Lead Sheet</span>
              </p>
              <p style={{ fontSize: 11, color: "#6B7280", margin: "2px 0 0" }}>by SWL Consulting · Executive Opportunity Sheet</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 10, color: "#6B7280", margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Prepared for</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: "2px 0 0" }}>{brand.companyName}</p>
              <p style={{ fontSize: 10, color: "#9CA3AF", margin: "2px 0 0" }}>{generatedAt}</p>
            </div>
            {brand.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt={brand.companyName} style={{ width: 40, height: 40, borderRadius: 8, objectFit: "contain", background: "#fff", border: "1px solid #E5E7EB" }} />
            )}
          </div>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#111827", margin: 0, letterSpacing: "-0.01em" }}>
            {val(lead.company_name) ? lead.company_name : (contactName || "Lead")}
          </h1>
          <p style={{ fontSize: 13, color: "#6B7280", margin: "6px 0 0" }}>
            {[contactName, lead.primary_title_role].filter(val).join(" · ")}
            {location && <>{(contactName || lead.primary_title_role) ? " — " : ""}{location}</>}
          </p>
        </div>

        {/* KPI strip */}
        {kpis.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(kpis.length, 5)}, minmax(0,1fr))`, gap: 8, marginBottom: 18 }}>
            {kpis.map(k => <KpiCard key={k.label} label={k.label} value={k.value} accent={k.accent} />)}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Photo (rooftop satellite and/or person) */}
          {(val(enr.rooftop_photo_url) || val(lead.primary_photo_url)) && (
            <Section label="Imagery" accent={accent}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {val(enr.rooftop_photo_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={enr.rooftop_photo_url} alt="Site / rooftop" style={{ width: "100%", maxWidth: 520, borderRadius: 8, border: "1px solid #E5E7EB", objectFit: "cover" }} />
                )}
                {val(lead.primary_photo_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lead.primary_photo_url} alt={contactName} style={{ width: 96, height: 96, borderRadius: 8, border: "1px solid #E5E7EB", objectFit: "cover" }} />
                )}
              </div>
              {val(enr.has_solar_panels) && (
                <p style={{ fontSize: 11, margin: "8px 0 0", fontWeight: 700, color: String(enr.has_solar_panels).toLowerCase() === "yes" ? "#16A34A" : "#DC2626" }}>
                  {String(enr.has_solar_panels).toLowerCase() === "yes" ? "● Existing solar array on site" : "● No solar panels on site"}
                </p>
              )}
            </Section>
          )}

          {/* Opportunity summary / outreach angle */}
          {(val(enr.ai_outreach_angle) || val(lead.ai_summary)) && (
            <Section label="Opportunity Summary" accent={accent}>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: "#374151", whiteSpace: "pre-line" }}>
                {val(enr.ai_outreach_angle) ? enr.ai_outreach_angle : lead.ai_summary}
              </p>
            </Section>
          )}

          {/* Plant profile + Conto Energia (plant leads) */}
          {intel && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Section label="Plant Profile" accent="#0D9488">
                <Grid>
                  <Field label="Installed capacity" value={typeof intel.installed_power_kw === "number" ? `${it(intel.installed_power_kw)} kW` : null} />
                  <Field label="Installation type" value={intel.installation_type} />
                  <Field label="Segment" value={intel.segment} />
                  <Field label="Coordinates" value={typeof intel.geo_lat === "number" && typeof intel.geo_lng === "number" ? `${intel.geo_lat}, ${intel.geo_lng}` : null} />
                  <Field label="Municipality" value={intel.city} />
                  <Field label="Province" value={intel.province} />
                  <Field label="Address" value={lead.company_address_1} />
                </Grid>
              </Section>
              <Section label={intel.conto_energia_scheme ? "Conto Energia" : "State Incentive (GSE)"} accent="#EA580C">
                <Grid>
                  {intel.conto_energia_scheme && <div style={{ gridColumn: "1 / -1" }}><Field label="Scheme" value={intel.conto_energia_scheme} /></div>}
                  <Field label="Feed-in tariff" value={typeof intel.feed_in_tariff_eur_kwh === "number" ? `€${intel.feed_in_tariff_eur_kwh.toFixed(3)}/kWh` : null} />
                  <Field label="Granted" value={intel.incentive_granted} />
                  <Field label="Valid until" value={intel.incentive_valid_until} />
                  <Field label="Contributo" value={typeof intel.contributo_eur === "number" ? `€${it(intel.contributo_eur)}` : null} />
                  <Field label="Convenzione" value={intel.convenzione} />
                  <Field label="Atto di concessione" value={intel.atto_concessione} />
                  <Field label="CUP" value={intel.cup} />
                  <Field label="COR" value={intel.cor} />
                </Grid>
              </Section>
            </div>
          )}

          {/* Ownership */}
          {intel && ownerFields.length > 0 && (
            <Section label="Beneficiary & Ownership" accent="#7C3AED">
              <span style={{ display: "inline-block", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 5, marginBottom: 10, color: singleOwner ? "#B45309" : "#DC2626", backgroundColor: singleOwner ? "#FEF3C7" : "#FEE2E2" }}>
                {singleOwner ? "Single owner" : "Split ownership"}
              </span>
              <Grid cols={4}>
                {ownerFields.map(([label, v]) => <Field key={label} label={label} value={v} />)}
              </Grid>
              {val(intel.ownership_note) && <p style={{ fontSize: 11.5, fontStyle: "italic", color: "#6B7280", margin: "10px 0 0", lineHeight: 1.55, borderTop: "1px solid #E5E7EB", paddingTop: 8 }}>{intel.ownership_note}</p>}
            </Section>
          )}

          {/* Technical / rooftop stats */}
          {rooftopStats.length > 0 && (
            <Section label="Technical Assessment" accent="#16A34A">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
                {rooftopStats.map(s => (
                  <div key={s.label}>
                    <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9CA3AF", margin: "0 0 2px" }}>{s.label}</p>
                    <p style={{ fontSize: 13.5, fontWeight: 800, color: "#111827", margin: 0 }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Contact + Company */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Section label="Contact" accent="#2563EB">
              <Grid>
                <Field label="Name" value={contactName} />
                <Field label="Role / title" value={lead.primary_title_role} />
                <Field label="Seniority" value={val(lead.primary_seniority) ? titleCase(String(lead.primary_seniority)) : null} />
                <Field label="Work email" value={lead.primary_work_email} />
                <Field label="Personal email" value={lead.primary_personal_email} />
                <Field label="Phone" value={lead.primary_phone} />
                <Field label="LinkedIn" value={lead.primary_linkedin_url} />
                <Field label="Headline" value={lead.primary_headline} />
              </Grid>
            </Section>
            <Section label="Company" accent="#0D9488">
              <Grid>
                <Field label="Company" value={lead.company_name} />
                <Field label="Website" value={lead.company_website} />
                <Field label="Industry" value={lead.company_industry} />
                <Field label="Employees" value={lead.employees} />
                <Field label="Annual revenue" value={lead.annual_revenue} />
                <Field label="Address" value={lead.company_address_1} />
                <Field label="City" value={lead.company_city} />
                <Field label="Country" value={lead.company_country} />
              </Grid>
              {val(lead.organization_description) && <p style={{ fontSize: 11.5, color: "#6B7280", margin: "10px 0 0", lineHeight: 1.55 }}>{lead.organization_description}</p>}
            </Section>
          </div>

          {/* Nearby C&I targets */}
          {nearby.length > 0 && (
            <Section label={`Nearby Commercial & Industrial Targets (${nearby.length})`} accent={accent}>
              <table style={{ fontSize: 11 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#6B7280", borderBottom: "1px solid #E5E7EB" }}>
                    <th style={{ padding: "5px 8px 5px 0", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>Company</th>
                    <th style={{ padding: "5px 8px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>Address</th>
                    <th style={{ padding: "5px 8px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>Dist.</th>
                    <th style={{ padding: "5px 8px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>Phone</th>
                    <th style={{ padding: "5px 0 5px 8px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Est. use</th>
                  </tr>
                </thead>
                <tbody>
                  {nearby.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #F3F4F6", breakInside: "avoid" }}>
                      <td style={{ padding: "6px 8px 6px 0", fontWeight: 700, color: "#111827" }}>{c.name}{val(c.web) && <div style={{ fontWeight: 400, color: accent, fontSize: 10 }}>{String(c.web).replace(/^https?:\/\//, "").replace(/\/$/, "")}</div>}</td>
                      <td style={{ padding: "6px 8px", color: "#374151" }}>{c.address ?? "—"}</td>
                      <td style={{ padding: "6px 8px", color: "#374151", whiteSpace: "nowrap" }}>{val(c.distance_km) ? `${c.distance_km} km` : "—"}</td>
                      <td style={{ padding: "6px 8px", color: "#374151", whiteSpace: "nowrap" }}>{c.phone ?? "—"}</td>
                      <td style={{ padding: "6px 0 6px 8px", color: "#111827", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{val(c.estimated_demand_mwh_year) ? `${c.estimated_demand_mwh_year} MWh/yr` : (val(c.mwh) ? `${c.mwh} MWh/yr` : "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* Any remaining enrichment (nothing dropped) */}
          {extra.length > 0 && (
            <Section label="Additional Intelligence" accent="#6B7280">
              <Grid>
                {extra.map(([k, v]) => <Field key={k} label={titleCase(k)} value={String(v)} />)}
              </Grid>
            </Section>
          )}

          {/* Notes */}
          {(val(lead.seller_notes) || val(lead.opportunity_notes)) && (
            <Section label="Notes" accent="#D97706">
              {val(lead.seller_notes) && <p style={{ fontSize: 12, color: "#374151", margin: "0 0 6px", lineHeight: 1.55, whiteSpace: "pre-line" }}>{lead.seller_notes}</p>}
              {val(lead.opportunity_notes) && <p style={{ fontSize: 12, color: "#374151", margin: 0, lineHeight: 1.55, whiteSpace: "pre-line" }}>{lead.opportunity_notes}</p>}
            </Section>
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF" }}>
          <span>Generated by GrowthAI · SWL Consulting</span>
          <span>{brand.companyName} · {generatedAt}</span>
        </div>
      </div>
    </>
  );
}
