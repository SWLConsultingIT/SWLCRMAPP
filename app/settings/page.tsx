import { Settings } from "lucide-react";
import PageHero from "@/components/PageHero";
import SettingsLayout from "./SettingsLayout";
import { getSupabaseServer } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="p-6 w-full fade-in">
      <PageHero
        icon={Settings}
        section="Operations"
        title="Settings"
        description="Configure your account, preferences, integrations and automation rules."
        accentColor="#64748B"
      />

      <SettingsLayout />
    </div>
  );
}
