"use client";

import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Trophy } from "lucide-react";
import PageHero from "@/components/PageHero";
import OpportunitiesTable, { type OpportunityLead } from "@/components/OpportunitiesTable";

type Props = { leads: OpportunityLead[] };

// /opportunities route — wraps the shared OpportunitiesTable with the page
// hero. The same table also renders inside /leads → Results → Won.
export default function OpportunitiesClient({ leads }: Props) {
  const { t } = useLocale();
  return (
    <div className="p-4 sm:p-6 w-full">
      <PageHero
        icon={Trophy}
        section={t("nav.section.operations")}
        title={t("opp.pageTitle")}
        description={t("opp.pageLede")}
        accentColor={C.green}
        status={{ label: `${leads.length} converted`, active: leads.length > 0 }}
      />
      <OpportunitiesTable leads={leads} />
    </div>
  );
}
