import { Settings } from "lucide-react";
import PageHero from "@/components/PageHero";
import SettingsLayout from "./SettingsLayout";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { redirect } from "next/navigation";

async function getCallMode(): Promise<"manual" | "auto"> {
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return "manual";

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.company_bio_id) return "manual";

  const { data: bio } = await svc
    .from("company_bios")
    .select("call_classification_mode")
    .eq("id", profile.company_bio_id)
    .maybeSingle();

  return (bio?.call_classification_mode as "manual" | "auto") ?? "manual";
}

export default async function SettingsPage() {
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const callMode = await getCallMode();

  return (
    <div className="p-6 w-full fade-in">
      <PageHero
        icon={Settings}
        section="Operations"
        title="Settings"
        description="Configure your account, preferences, integrations and automation rules."
        accentColor="#64748B"
      />

      <SettingsLayout callMode={callMode} />
    </div>
  );
}
