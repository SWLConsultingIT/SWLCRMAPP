import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // If this user already has a company_bio assigned, skip onboarding.
  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.company_bio_id) redirect("/");

  return <OnboardingForm displayName={(user.user_metadata as any)?.display_name ?? ""} email={user.email ?? ""} />;
}
