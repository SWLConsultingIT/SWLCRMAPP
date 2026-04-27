import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminPage } from "@/lib/auth-admin";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Target, Clock, MapPin, Users, Briefcase } from "lucide-react";
import AdminActions from "../../../AdminActions";
import ExecutionActions from "./ExecutionActions";
import CopyableId from "@/components/CopyableId";

const gold = "var(--brand, #c9a83a)";
const supabase = getSupabaseService();

const statusStyles: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "Pending Review", color: "#D97706", bg: "#FFFBEB" },
  reviewed: { label: "Reviewed",       color: C.blue,    bg: C.blueLight },
  approved: { label: "Approved",       color: C.green,   bg: C.greenLight },
  rejected: { label: "Rejected",       color: C.red,     bg: C.redLight },
};


export default async function AdminProfileDetailPage({ params }: { params: Promise<{ id: string; profileId: string }> }) {
  await requireAdminPage();
  const { id, profileId } = await params;

  const [{ data: profile }, { data: client }] = await Promise.all([
    supabase.from("icp_profiles").select("*").eq("id", profileId).single(),
    supabase.from("company_bios").select("company_name, logo_url").eq("id", id).single(),
  ]);

  if (!profile) notFound();

  const st = statusStyles[profile.status] ?? statusStyles.pending;

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        <Link href="/admin" className="hover:underline">Admin</Link>
        <span>/</span>
        <Link href={`/admin/${id}`} className="hover:underline">{client?.company_name ?? "Client"}</Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{profile.profile_name}</span>
      </div>

      {/* ═══ HEADER CARD ═══ */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6 flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 13%, transparent), color-mix(in srgb, ${gold} 3%, transparent))`, border: `1px solid color-mix(in srgb, ${gold} 15%, transparent)` }}>
              <Target size={24} style={{ color: gold }} />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{profile.profile_name}</h1>
                <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
                  style={{ backgroundColor: st.bg, color: st.color }}>
                  <Clock size={11} /> {st.label}
                </span>
              </div>
              <p className="text-xs" style={{ color: C.textMuted }}>
                Created {new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                {client?.company_name && <> · <span style={{ color: gold }}>{client.company_name}</span></>}
              </p>
            </div>
          </div>

          {profile.status === "pending" && (
            <AdminActions id={profile.id} table="icp_profiles" />
          )}
        </div>

        <div className="border-t" style={{ borderColor: C.border }} />

        {/* Metrics */}
        <div className="px-6 py-4 grid grid-cols-4 gap-6">
          {profile.target_industries?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>
                <Briefcase size={10} className="inline mr-1" /> Industries
              </p>
              <div className="flex flex-wrap gap-1">
                {profile.target_industries.map((i: string) => (
                  <span key={i} className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: C.blueLight, color: C.blue }}>{i}</span>
                ))}
              </div>
            </div>
          )}
          {profile.target_roles?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>
                <Users size={10} className="inline mr-1" /> Target Roles
              </p>
              <div className="flex flex-wrap gap-1">
                {profile.target_roles.map((r: string) => (
                  <span key={r} className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: C.accentLight, color: C.accent }}>{r}</span>
                ))}
              </div>
            </div>
          )}
          {profile.company_size && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>Company Size</p>
              <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{profile.company_size} employees</p>
            </div>
          )}
          {profile.geography?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>
                <MapPin size={10} className="inline mr-1" /> Geography
              </p>
              <div className="flex flex-wrap gap-1">
                {profile.geography.map((g: string) => (
                  <span key={g} className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: C.orangeLight, color: C.orange }}>{g}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {profile.pain_points && (
          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: gold }}>Pain Points</h3>
            <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{profile.pain_points}</p>
          </div>
        )}
        {profile.solutions_offered && (
          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: gold }}>Solutions Offered</h3>
            <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{profile.solutions_offered}</p>
          </div>
        )}
      </div>

      {profile.notes && (
        <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Additional Notes</h3>
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{profile.notes}</p>
        </div>
      )}

      {/* ═══ EXECUTION TRACKER (only for approved profiles) ═══ */}
      {(profile.status === "approved" || profile.execution_status !== "not_started") && (
        <ExecutionActions
          id={profile.id}
          currentStatus={profile.execution_status ?? "not_started"}
          leadsUploaded={profile.leads_uploaded ?? 0}
        />
      )}

      {/* ═══ SHEET SYNC IDs (for uploading leads) ═══ */}
      <div className="rounded-xl border p-5 mt-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Sheet Sync IDs</h3>
        <p className="text-xs mb-3" style={{ color: C.textDim }}>Copy these IDs into your Google Sheet when uploading leads for this project.</p>
        <div className="grid grid-cols-2 gap-3">
          <CopyableId label="Company Bio ID" value={id} />
          <CopyableId label="ICP Profile ID" value={profileId} />
        </div>
      </div>
    </div>
  );
}
