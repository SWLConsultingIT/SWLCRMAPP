import { notFound } from "next/navigation";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import PrintTrigger from "../../../../reports/print/PrintTrigger";
import PrintActions from "../../../../reports/print/PrintActions";

// Branded, print-optimized view of a single outreach template. Opened in a
// hidden iframe from the "Download" button on the template detail page + the
// templates list, then auto-printed (Save-as-PDF). Mirrors the /icp/[id]/print
// convention — zero PDF deps, tenant-scoped, GrowthAI header + "Prepared for".

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

const CHANNEL: Record<string, { label: string; color: string }> = {
  linkedin: { label: "LinkedIn", color: "#0A66C2" },
  email:    { label: "Email",    color: "#7C3AED" },
  call:     { label: "Call",     color: "#F97316" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
};
const TONE_LABEL: Record<string, string> = { conservative: "Conservative", balanced: "Balanced", direct: "Direct", spicy: "Spicy", custom: "Custom" };
const REWRITE_LABEL: Record<string, string> = { verbatim: "Verbatim", personalize: "Personalize per lead", rewrite_with_source: "Rewrite from source PDF" };

type StepMsg = { step: number; channel: string; subject?: string | null; body: string };
type Template = {
  id: string; name: string; description: string | null;
  sequence_steps: Array<{ channel: string; daysAfter: number }> | null;
  step_messages: { connectionRequest?: string; steps?: StepMsg[]; autoReplies?: { positive?: string; negative?: string; question?: string } } | null;
  channels: string[] | null; tone_preset: string | null; rewrite_mode: string | null;
  icp_profile_id: string | null; created_at: string | null;
};

// Coerce any value to a printable string — guards against a step body/subject
// stored as an object (would otherwise throw "Objects are not valid as a React
// child" and blow up the whole print page).
function txt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function Chip({ label, color }: { label: string; color: string }) {
  return <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, color, backgroundColor: `color-mix(in srgb, ${color} 12%, white)` }}>{label}</span>;
}

export default async function TemplatePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId) notFound();

  // Mirror /icp/[id]/print: scope to the user's tenant, but a super_admin
  // (no companyBioId) can print any tenant's template.
  const svc = getSupabaseService();
  let q = svc
    .from("campaign_templates")
    .select("id, name, description, sequence_steps, step_messages, channels, tone_preset, rewrite_mode, icp_profile_id, created_at")
    .eq("id", id);
  if (scope.isScoped && scope.companyBioId) q = q.eq("company_bio_id", scope.companyBioId);
  const { data: tpl } = await q.maybeSingle();
  if (!tpl) notFound();
  const t = tpl as Template;

  let icpName: string | null = null;
  if (t.icp_profile_id) {
    const { data: icp } = await svc.from("icp_profiles").select("profile_name").eq("id", t.icp_profile_id).maybeSingle();
    icpName = icp?.profile_name ?? null;
  }

  const brand = await getBranding(scope.companyBioId);
  const sm = t.step_messages ?? {};
  const seq = Array.isArray(t.sequence_steps) ? t.sequence_steps : [];
  const steps = Array.isArray(sm.steps) ? sm.steps : [];
  const cr = txt(sm.connectionRequest).trim();
  const generatedAt = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <>
      <PrintTrigger />
      <PrintActions />
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm 14mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .step-block { break-inside: avoid; }
        }
        body { font-family: 'Inter', system-ui, sans-serif; background: #fff; color: #111827; }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px", fontSize: 13 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, paddingBottom: 16, borderBottom: `2px solid ${brand.brandColor}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${brand.brandColor}, color-mix(in srgb, ${brand.brandColor} 72%, white))`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: 20 }}>⚡</span>
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: 18, color: "#111827", margin: 0, letterSpacing: "-0.01em" }}>
                GrowthAI <span style={{ color: brand.brandColor }}>— Outreach Flow™</span>
              </p>
              <p style={{ fontSize: 11, color: "#6B7280", margin: "2px 0 0" }}>by SWL Consulting · Outreach Template</p>
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

        {/* Title + meta */}
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827", margin: 0, letterSpacing: "-0.01em" }}>{t.name}</h1>
          {t.description && <p style={{ fontSize: 12.5, color: "#6B7280", margin: "6px 0 0", lineHeight: 1.5 }}>{t.description}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {icpName && <Chip label={`ICP · ${icpName}`} color={brand.brandColor} />}
            {t.tone_preset && <Chip label={`Tone · ${TONE_LABEL[t.tone_preset] ?? t.tone_preset}`} color="#0D9488" />}
            {t.rewrite_mode && <Chip label={REWRITE_LABEL[t.rewrite_mode] ?? t.rewrite_mode} color="#2563EB" />}
            {(t.channels ?? []).map(ch => <Chip key={ch} label={CHANNEL[ch]?.label ?? ch} color={CHANNEL[ch]?.color ?? "#6B7280"} />)}
          </div>
        </div>

        {/* Connection Request */}
        {cr && (
          <div className="step-block" style={{ marginBottom: 18, border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", backgroundColor: "color-mix(in srgb, #0A66C2 8%, white)", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#0A66C2", textTransform: "uppercase", letterSpacing: "0.05em" }}>Connection Request</span>
              <span style={{ fontSize: 10, color: "#9CA3AF" }}>· LinkedIn invite · sent before the sequence</span>
            </div>
            <p style={{ margin: 0, padding: "14px", fontSize: 13, lineHeight: 1.6, color: "#374151", whiteSpace: "pre-wrap" }}>{cr}</p>
          </div>
        )}

        {/* Sequence */}
        {steps.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: "#111827", margin: "0 0 4px" }}>Sequence</p>
            <p style={{ fontSize: 11, color: "#9CA3AF", margin: "0 0 14px" }}>{steps.length} step{steps.length > 1 ? "s" : ""}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {steps.map((s, i) => {
                const ch = CHANNEL[s.channel] ?? CHANNEL[seq[i]?.channel] ?? { label: s.channel, color: "#6B7280" };
                const day = seq[i]?.daysAfter;
                return (
                  <div key={i} className="step-block" style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", borderLeft: `3px solid ${ch.color}` }}>
                    <div style={{ padding: "8px 14px", backgroundColor: "#FAFAFA", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: ch.color, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: ch.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{ch.label}</span>
                      {typeof day === "number" && <span style={{ fontSize: 10, color: "#9CA3AF" }}>· {day === 0 ? "Same day" : `Day ${day}`}</span>}
                    </div>
                    <div style={{ padding: 14 }}>
                      {s.subject && <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#111827" }}>Subject: <span style={{ fontWeight: 500, color: "#374151" }}>{txt(s.subject)}</span></p>}
                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "#374151", whiteSpace: "pre-wrap" }}>{txt(s.body)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
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
