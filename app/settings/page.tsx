import { Settings } from "lucide-react";
import PageHero from "@/components/PageHero";
import SettingsLayout from "./SettingsLayout";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { redirect } from "next/navigation";

// Single FK-join query — was 2 sequential queries (user_profiles → company_bios).
async function getCallMode(userId: string): Promise<"manual" | "auto"> {
  const svc = getSupabaseService();
  const { data } = await svc
    .from("user_profiles")
    .select("company_bios(call_classification_mode)")
    .eq("user_id", userId)
    .maybeSingle();
  const bios = (data as unknown as { company_bios?: { call_classification_mode?: string } | { call_classification_mode?: string }[] | null })?.company_bios;
  const bio = Array.isArray(bios) ? bios[0] : bios;
  return (bio?.call_classification_mode as "manual" | "auto") ?? "manual";
}

export default async function SettingsPage() {
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // Was: getCallMode() did its own auth.getUser() (duplicate round-trip),
  // then 2 sequential queries. Now: pass user.id and use a single FK-join
  // query. Saves ~300-500ms on /settings page load.
  const callMode = await getCallMode(user.id);

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
