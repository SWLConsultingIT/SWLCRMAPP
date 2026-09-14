import { redirect } from "next/navigation";
import { getUserScope, canViewAllTenantData } from "@/shared/auth/scope";

// ICP management (Lead Miner) is tenant configuration — owner / manager /
// super_admin only. This SERVER gate covers /icp and /icp/[id] on every request
// (direct URL included) and redirects anyone whose EFFECTIVE tier can't view all
// tenant data, including an admin previewing as a seller (effective tier =
// 'seller'). So the surface — and its direct browser writes to icp_profiles —
// is unreachable from any seller/effective-seller session.
export default async function IcpLayout({ children }: { children: React.ReactNode }) {
  const scope = await getUserScope();
  if (!scope.userId) redirect("/login");
  if (!canViewAllTenantData(scope.tier)) redirect("/");
  return <>{children}</>;
}
