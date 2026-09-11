import { Settings } from "lucide-react";
import { getT } from "@/lib/i18n-server";
import PageHero from "@/components/PageHero";
import SettingsLayout from "./SettingsLayout";
import { getSupabaseServer } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const t = await getT();
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="p-6 w-full fade-in">
      <PageHero
        icon={Settings}
        section={t("nav.section.operations")}
        title={t("set.pageTitle")}
        description={t("set.pageLede")}
        accentColor="#64748B"
      />

      <SettingsLayout />
    </div>
  );
}
