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
  // SWL admin can choose to encrypt or not per import (defaults to plain so
  // they read everything in the UI without decryption). Non-SWL roles always
  // encrypt — that's the privacy contract for client-tenant data.
  const isSwlAdmin = scope.tier === "super_admin";

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={Upload}
        section="Operations"
        title="Import Leads"
        description={
          isSwlAdmin
            ? "SWL admin import. By default leads stay plaintext (you read them directly). Toggle encryption on for sensitive tenants."
            : "Upload a CSV or Excel file. Your leads will be encrypted at rest — only your team and the AI agent can read them."
        }
        accentColor={C.gold}
        status={{ label: isSwlAdmin ? "Plain by default" : "Encrypted", active: true }}
      />

      {!canImport ? (
        <div className="rounded-2xl border p-8 text-center" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <p className="text-sm" style={{ color: C.textMuted }}>
            You don&apos;t have permission to import leads. Ask an owner or manager on your team.
          </p>
        </div>
      ) : (
        <ImportWizardClient isSwlAdmin={isSwlAdmin} />
      )}
    </div>
  );
}
