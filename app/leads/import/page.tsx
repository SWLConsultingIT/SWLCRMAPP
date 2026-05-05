import { redirect } from "next/navigation";
import { Upload } from "lucide-react";
import PageHero from "@/components/PageHero";
import { C } from "@/lib/design";
import { getUserScope, canEditTenantSettings } from "@/lib/scope";
import ImportWizardClient from "./ImportWizardClient";

export default async function LeadsImportPage() {
  const scope = await getUserScope();
  if (!scope.userId) redirect("/login");

  const canImport = canEditTenantSettings(scope.tier) || scope.tier === "manager";
  const isSwlInternal = scope.tier === "super_admin" && !scope.companyBioId;
  const willEncrypt = !isSwlInternal;

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={Upload}
        section="Operations"
        title="Import Leads"
        description={
          willEncrypt
            ? "Upload a CSV or Excel file. Your leads will be encrypted at rest — only your team and the AI agent can read them."
            : "SWL admin import — leads will be stored unencrypted (legacy flow). Use this only for SWL-managed campaigns."
        }
        accentColor={C.gold}
        status={{ label: willEncrypt ? "Encrypted" : "Plain", active: true }}
      />

      {!canImport ? (
        <div className="rounded-2xl border p-8 text-center" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <p className="text-sm" style={{ color: C.textMuted }}>
            You don&apos;t have permission to import leads. Ask an owner or manager on your team.
          </p>
        </div>
      ) : (
        <ImportWizardClient willEncrypt={willEncrypt} />
      )}
    </div>
  );
}
