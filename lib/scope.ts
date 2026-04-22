import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

export type UserScope = {
  userId: string | null;
  role: "admin" | "client" | null;
  companyBioId: string | null;
  /** True when queries must be filtered to a specific company. False = admin / no user (see everything). */
  isScoped: boolean;
};

/**
 * Resolves the current user's tenancy scope.
 * - Admins see everything across all clients.
 * - Clients see only data for their company_bio_id.
 * - Unauthenticated requests behave like admins (server components called with no user context).
 */
export async function getUserScope(): Promise<UserScope> {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { userId: null, role: null, companyBioId: null, isScoped: false };

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("role, company_bio_id")
    .eq("user_id", user.id)
    .single();

  const role = (profile?.role ?? "client") as "admin" | "client";
  const companyBioId = profile?.company_bio_id ?? null;
  const isScoped = role !== "admin" && !!companyBioId;
  return { userId: user.id, role, companyBioId, isScoped };
}
