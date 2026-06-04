import { notFound } from "next/navigation";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import PrintTrigger from "../../../reports/print/PrintTrigger";
import PrintActions from "../../../reports/print/PrintActions";

// Branded, print-optimized view of a single ICP. Opened in a new tab from the
// "Download" button on /icp; auto-fires window.print() so the user lands in the
// browser's Save-as-PDF dialog. Mirrors the /reports/print convention (zero
// PDF deps, tenant-scoped, GrowthAI header + "Prepared for <tenant>").

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

const STATUS: Record<string, { label: string; color: string }> = {
  pending:  { label: "Pending",  color: "#D97706" },
  reviewed: { label: "Reviewed", color: "#2563EB" },
  approved: { label: "Approved", color: "#16A34A" },
  rejected: { label: "Rejected", color: "#DC2626" },
};

// Split notes/rubric text and wrap tier keywords in colored badges (print-safe).
const TIER_COLORS: Record<string, { color: string; bg: string }> = {
  HOT:     { color: "#DC2626", bg: "#FEE2E2" },
  WARM:    { color: "#D97706", bg: "#FEF3C7" },
  NURTURE: { color: "#2563EB", bg: "#DBEAFE" },
  DISCARD: { color: "#6B7280", bg: "#F3F4F6" },
};
function renderRubric(text: string) {
  const parts = text.split(/\b(HOT|WARM|NURTURE|DISCARD)\b/g);
  return parts.map((p, i) => {
    const tier = TIER_COLORS[p];
    if (tier) {
      return (
        <span key={i} style={{ display: "inline-block", padding: "1px 6px", borderRadius: 5, fontWeight: 700, fontSize: 11, color: tier.color, backgroundColor: tier.bg }}>
          {p}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function Chips({ items, color }: { items: string[]; color: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map(it => (
        <span key={it} style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 6, color, backgroundColor: `color-mix(in srgb, ${color} 12%, white)`, border: `1px solid color-mix(in srgb, ${color} 28%, white)` }}>
          {it}
        </span>
      ))}
    </div>
  );
}

function Section({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px", borderTop: `3px solid ${accent}` }}>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6B7280", margin: "0 0 8px" }}>{label}</p>
      {children}
    </div>
  );
}

export default async function IcpPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId) notFound();

  const svc = getSupabaseService();
  let query = svc.from("icp_profiles").select("*").eq("id", id);
  // Tenant isolation: a scoped (non-super-admin) caller can only print ICPs in
  // their own tenant. super_admin (no companyBioId) can print any.
  if (scope.isScoped && scope.companyBioId) query = query.eq("company_bio_id", scope.companyBioId);
  const { data: icp } = await query.maybeSingle();
  if (!icp) notFound();

  const brand = await getBranding(icp.company_bio_id ?? scope.companyBioId);
  const st = STATUS[icp.status as string] ?? STATUS.pending;
  const generatedAt = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const createdAt = icp.created_at ? new Date(icp.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;

  return (
    <>
      <PrintTrigger />
      <PrintActions />
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm 14mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        body { font-family: 'Inter', system-ui, sans-serif; background: #fff; color: #111827; }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px", fontSize: 13 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, paddingBottom: 16, borderBottom: `2px solid ${brand.brandColor}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${brand.brandColor}, color-mix(in srgb, ${brand.brandColor} 72%, white))`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 2px 8px color-mix(in srgb, ${brand.brandColor} 30%, transparent)` }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: 20 }}>⚡</span>
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: 18, color: "#111827", margin: 0, letterSpacing: "-0.01em" }}>
                GrowthAI <span style={{ color: brand.brandColor }}>— Lead Miner™</span>
              </p>
              <p style={{ fontSize: 11, color: "#6B7280", margin: "2px 0 0" }}>by SWL Consulting · Ideal Customer Profile</p>
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
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827", margin: 0, letterSpacing: "-0.01em" }}>{icp.profile_name}</h1>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6, color: st.color, backgroundColor: `color-mix(in srgb, ${st.color} 12%, white)` }}>{st.label}</span>
          </div>
          {(createdAt || icp.created_by_email) && (
            <p style={{ fontSize: 11, color: "#9CA3AF", margin: "6px 0 0" }}>
              {createdAt && <>Created {createdAt}</>}
              {icp.created_by_email && <> · by {icp.created_by_email}</>}
            </p>
          )}
        </div>

        {/* Overview grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          {Array.isArray(icp.target_industries) && icp.target_industries.length > 0 && (
            <Section label="Industries" accent="#2563EB"><Chips items={icp.target_industries} color="#2563EB" /></Section>
          )}
          {Array.isArray(icp.target_roles) && icp.target_roles.length > 0 && (
            <Section label="Target Roles" accent="#0D9488"><Chips items={icp.target_roles} color="#0D9488" /></Section>
          )}
          {(() => {
            const sizeLabel = Array.isArray(icp.company_size_buckets) && icp.company_size_buckets.length > 0
              ? icp.company_size_buckets.map((b: string) => `${b} employees`).join(", ")
              : (icp.company_size || "").trim() || null;
            return sizeLabel && (
              <Section label="Company Size" accent="#7C3AED"><p style={{ margin: 0, fontSize: 13, color: "#374151" }}>{sizeLabel}</p></Section>
            );
          })()}
          {Array.isArray(icp.geography) && icp.geography.length > 0 && (
            <Section label="Geography" accent="#EA580C"><Chips items={icp.geography} color="#EA580C" /></Section>
          )}
        </div>

        {/* Pain points + solutions */}
        {(icp.pain_points || icp.solutions_offered) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {icp.pain_points && (
              <Section label="Pain Points" accent="#DC2626">
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "#374151", whiteSpace: "pre-line" }}>{icp.pain_points}</p>
              </Section>
            )}
            {icp.solutions_offered && (
              <Section label="Solutions Offered" accent="#16A34A">
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "#374151", whiteSpace: "pre-line" }}>{icp.solutions_offered}</p>
              </Section>
            )}
          </div>
        )}

        {/* Classification rubric */}
        {icp.notes && (
          <div style={{ marginBottom: 16 }}>
            <Section label="Classification Rubric" accent="#7C3AED">
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: "#374151", whiteSpace: "pre-line" }}>{renderRubric(icp.notes)}</p>
            </Section>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 28, paddingTop: 14, borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF" }}>
          <span>Generated by GrowthAI · SWL Consulting</span>
          <span>{generatedAt}</span>
        </div>
      </div>
    </>
  );
}
