import { redirect } from "next/navigation";
import { Archive, RotateCcw } from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import PageHero from "@/components/PageHero";
import RecoveryClient from "./RecoveryClient";

export const dynamic = "force-dynamic";

type ArchivedBio = {
  id: string;
  company_name: string;
  archived_at: string;
  logo_url: string | null;
  industry: string | null;
  leads_count: number;
};

async function getArchivedBios(scope: { userId: string | null; tier: string | null; companyBioId: string | null }) {
  const svc = getSupabaseService();
  const isSuperAdmin = scope.tier === "super_admin";

  // Super admins see all archived bios. Owners only see archived bios where
  // they were owner before the archive.
  let bioQuery = svc
    .from("company_bios")
    .select("id, company_name, archived_at, logo_url, industry")
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });

  if (!isSuperAdmin) {
    if (!scope.userId) return [];
    const { data: ownerships } = await svc
      .from("user_company_memberships")
      .select("company_bio_id")
      .eq("user_id", scope.userId)
      .eq("tier", "owner");
    const ownedBioIds = (ownerships ?? []).map(o => o.company_bio_id);
    if (ownedBioIds.length === 0) return [];
    bioQuery = bioQuery.in("id", ownedBioIds);
  }

  const { data: bios } = await bioQuery;
  if (!bios || bios.length === 0) return [];

  // Fetch leads counts per bio in parallel.
  const counts = await Promise.all(
    bios.map(b =>
      svc.from("leads")
        .select("id", { count: "exact", head: true })
        .eq("company_bio_id", b.id)
        .then(r => ({ id: b.id, count: r.count ?? 0 })),
    ),
  );
  const countMap = new Map(counts.map(c => [c.id, c.count]));

  return bios.map(b => ({
    ...b,
    leads_count: countMap.get(b.id) ?? 0,
  })) as ArchivedBio[];
}

export default async function RecoveryPage() {
  const scope = await getUserScope();
  if (!scope.userId) redirect("/login");

  const isSuperAdmin = scope.tier === "super_admin";
  // Owners can also reach this page (to restore their own archived tenants).
  // We still block sellers/managers/viewers — only the entity that archived
  // can recover.
  if (!isSuperAdmin && scope.tier !== "owner") redirect("/");

  const archived = await getArchivedBios(scope);

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={Archive}
        section="Admin"
        title="Recovery"
        description="Archived tenants stay recoverable for 30 days. After that, they are permanently deleted by the daily cleanup."
        accentColor={C.gold}
        status={{ label: `${archived.length} archived`, active: archived.length > 0 }}
      />

      {archived.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <RotateCcw size={24} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm" style={{ color: C.textBody }}>Nothing archived right now.</p>
          <p className="text-[11px] mt-1" style={{ color: C.textMuted }}>
            When a tenant is archived, it appears here with a 30-day window to restore.
          </p>
        </div>
      ) : (
        <RecoveryClient bios={JSON.parse(JSON.stringify(archived))} />
      )}
    </div>
  );
}
