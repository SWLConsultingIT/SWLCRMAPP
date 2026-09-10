// /reports — now a download menu. Pre-2026-05-26 this was a full duplicate
// of the dashboard analytics with a hidden Print button. The new Dashboard
// IS the analytics; here you only pick what to include in the PDF + period
// + filters, then jump to /reports/print which renders the PDF (still tenant-
// scoped by getReportData()).

import Link from "next/link";
import { FileDown, ArrowLeft } from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import PageHero from "@/components/PageHero";
import ReportPicker from "./ReportPicker";
import { getT } from "@/lib/i18n-server";

const gold = "var(--brand, #c9a83a)";

async function loadFilterOptions() {
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;
  const svc = getSupabaseService();

  const campsQ = bioId
    ? svc.from("campaigns").select("name, leads!inner(company_bio_id)").eq("leads.company_bio_id", bioId)
    : svc.from("campaigns").select("name");
  const sellersQ = bioId
    ? svc.from("sellers").select("id, name").or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`).order("name")
    : svc.from("sellers").select("id, name").order("name");
  const icpsQ = bioId
    ? svc.from("icp_profiles").select("id, profile_name").eq("company_bio_id", bioId).eq("status", "approved").order("profile_name")
    : svc.from("icp_profiles").select("id, profile_name").eq("status", "approved").order("profile_name");

  const [{ data: camps }, { data: sellers }, { data: icps }] = await Promise.all([campsQ, sellersQ, icpsQ]);
  const uniqueCampaigns = Array.from(new Set((camps ?? []).map((c: any) => c.name).filter(Boolean))).sort();
  return {
    campaigns: uniqueCampaigns.map(n => ({ id: n, label: n })),
    sellers: (sellers ?? []).map((s: any) => ({ id: s.id, label: s.name })),
    icps: (icps ?? []).map((p: any) => ({ id: p.id, label: p.profile_name })),
  };
}

export default async function ReportsDownloadPage() {
  const scope = await getUserScope();
  if (!scope.userId) {
    return null;
  }
  const options = await loadFilterOptions();
  const t = await getT();

  return (
    <div className="p-4 sm:p-6 w-full space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> {t("rep.page.back")}
      </Link>

      <PageHero
        icon={FileDown}
        section={t("rep.page.section")}
        title={t("rep.page.title")}
        description={t("rep.page.lede")}
        accentColor={gold}
      />

      <ReportPicker options={options} />
    </div>
  );
}
