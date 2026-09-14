import { redirect } from "next/navigation";
import { getUserScope, canViewAllTenantData } from "@/shared/auth/scope";

// Company Bio is tenant configuration — owner / manager / super_admin only.
// This SERVER gate runs on every request to /company-bios (direct URL included)
// and redirects anyone whose EFFECTIVE tier can't view all tenant data. That
// includes an admin previewing as a seller (effective tier = 'seller'), so the
// preview faithfully can't reach this surface — and its direct browser writes
// become unreachable from any seller/effective-seller session. Fixes a latent
// real-seller permission gap at the same time.
export default async function CompanyBiosLayout({ children }: { children: React.ReactNode }) {
  const scope = await getUserScope();
  if (!scope.userId) redirect("/login");
  if (!canViewAllTenantData(scope.tier)) redirect("/");
  return <>{children}</>;
}
